import { Storage } from '@google-cloud/storage';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const BUCKET_NAME = process.env.GCS_BUCKET || 'jcw-labor-timekeeper';
const DB_BACKUP_NAME = process.env.DB_BACKUP_NAME || 'app.db';
const ARCHIVE_FOLDER = 'archives';
const DAILY_SNAPSHOT_FOLDER = 'backups/daily';

let storage;

function getStorage() {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

function getBackupCandidates() {
  const names = [DB_BACKUP_NAME, 'app.db', 'restored_app.db', 'recovery_app.db'];
  const seen = new Set();
  const unique = [];
  for (const name of names) {
    const n = String(name || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  return unique;
}

function checkpointWal(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return;
    const db = new Database(dbPath);
    db.pragma('wal_checkpoint(TRUNCATE)');
 db.close();
  } catch (err) {
    console.warn('[storage] WAL checkpoint failed', err?.message || err);
  }
}

/**
 * Create a consistent backup copy of the database using SQLite .backup() API.
 * This ensures WAL data is included even if checkpoint fails.
 * @param {string} dbPath - Source database path
 * @returns {string|null} - Path to backup copy, or null on failure
 */
function createConsistentCopy(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return null;
    const tmpPath = dbPath + '.upload_tmp';
    // Remove stale temp file if present
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    // VACUUM INTO creates a complete, consistent copy including WAL data (synchronous)
    const src = new Database(dbPath, { readonly: true });
    src.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
    src.close();
    // Verify the copy has data
    const verify = new Database(tmpPath, { readonly: true });
    const count = verify.prepare('SELECT COUNT(*) as n FROM time_entries').get();
    verify.close();
    console.log(`[storage] consistent copy created: ${count?.n || 0} entries`);
    return tmpPath;
  } catch (err) {
    console.warn('[storage] consistent copy failed, falling back to checkpoint', err?.message || err);
    checkpointWal(dbPath);
    return null;
  }
}

/**
 * Archive reconciled payroll data to Cloud Storage before clearing
 * @param {object} db - Database instance
 * @param {string} month - Month being reconciled (YYYY-MM)
 * @returns {Promise<object>} - Archive summary
 */
export async function archiveAndClearPayroll(db, month) {
  const archiveData = {
    month,
    reconciledAt: new Date().toISOString(),
    timeEntries: [],
    summary: {}
  };

  // Get all time entries for the month
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    LEFT JOIN rate_overrides ro ON ro.employee_id = te.employee_id AND ro.customer_id = te.customer_id
    -- expose per-entry bill_rate (override or employee default)
    
    WHERE te.work_date LIKE ?
    ORDER BY te.work_date ASC
  `).all(`${month}%`);

  archiveData.timeEntries = entries;
  
  // Calculate summary
  let totalHours = 0;
  let totalBilled = 0;
  for (const e of entries) {
    totalHours += e.hours || 0;
    const rate = (e.bill_rate != null) ? e.bill_rate : (e.default_bill_rate != null ? e.default_bill_rate : 0);
    totalBilled += (e.hours || 0) * (rate || 0);
  }
  archiveData.summary = {
    entryCount: entries.length,
    totalHours,
    totalBilled: Math.round(totalBilled * 100) / 100
  };

  // Upload archive to cloud storage (production only)
  if (process.env.NODE_ENV === 'production') {
    try {
      const bucket = getStorage().bucket(BUCKET_NAME);
      const archiveName = `${ARCHIVE_FOLDER}/payroll-${month}.json`;
      const file = bucket.file(archiveName);
      
      await file.save(JSON.stringify(archiveData, null, 2), {
        contentType: 'application/json',
        metadata: { cacheControl: 'no-cache' }
      });
      
      console.log(`[storage] Archived ${entries.length} entries to gs://${BUCKET_NAME}/${archiveName}`);
    } catch (err) {
      console.error('[storage] Failed to archive to cloud:', err.message);
      // Continue with local clear even if cloud archive fails
    }
  } else {
    // In dev, save archive locally
    const archiveDir = './data/archives';
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(archiveDir, `payroll-${month}.json`),
      JSON.stringify(archiveData, null, 2)
    );
    console.log(`[storage] Archived ${entries.length} entries locally`);
  }

  // Delete time entries for the reconciled month
  const deleteResult = db.prepare(`
    DELETE FROM time_entries WHERE work_date LIKE ?
  `).run(`${month}%`);

  console.log(`[storage] Cleared ${deleteResult.changes} time entries for ${month}`);

  return {
    month,
    archived: archiveData.summary.entryCount,
    cleared: deleteResult.changes,
    summary: archiveData.summary
  };
}

/**
 * Get list of archived payroll months
 */
export async function listArchives() {
  if (process.env.NODE_ENV === 'production') {
    try {
      const bucket = getStorage().bucket(BUCKET_NAME);
      const [files] = await bucket.getFiles({ prefix: `${ARCHIVE_FOLDER}/` });
      return files.map(f => ({
        name: f.name.replace(`${ARCHIVE_FOLDER}/payroll-`, '').replace('.json', ''),
        created: f.metadata.timeCreated
      }));
    } catch (err) {
      console.error('[storage] Failed to list archives:', err.message);
      return [];
    }
  } else {
    const archiveDir = './data/archives';
    if (!fs.existsSync(archiveDir)) return [];
    return fs.readdirSync(archiveDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f.replace('payroll-', '').replace('.json', '') }));
  }
}

/**
 * Restore database from Cloud Storage on startup
 * @param {string} dbPath - Local path to restore to
 * @returns {Promise<boolean>} - true if restored, false if no backup exists
 */
export async function restoreFromCloud(dbPath) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[storage] Skipping cloud restore in non-production');
    return false;
  }

  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const candidates = getBackupCandidates();
    let file = null;
    let chosenName = null;
    for (const name of candidates) {
      const f = bucket.file(name);
      const [exists] = await f.exists();
      if (!exists) continue;
      file = f;
      chosenName = name;
      break;
    }
    if (!file) {
      console.log('[storage] No cloud backup found, starting fresh');
      return false;
    }

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Download backup
    await file.download({ destination: dbPath });
    console.log(`[storage] Restored database from gs://${BUCKET_NAME}/${chosenName}`);
    return true;
  } catch (err) {
    console.error('[storage] Failed to restore from cloud:', err.message);
    return false;
  }
}

/**
 * Backup database to Cloud Storage
 * @param {string} dbPath - Local path to backup from
 * @returns {Promise<boolean>} - true if successful
 */
export async function backupToCloud(dbPath) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[storage] Skipping cloud backup in non-production');
    return false;
  }

  // Allow disabling scheduled/backups during recovery/deploy by setting DISABLE_SCHEDULED_BACKUPS=1
  if (process.env.DISABLE_SCHEDULED_BACKUPS === '1') {
    console.log('[storage] Cloud backups disabled by DISABLE_SCHEDULED_BACKUPS=1');
    return false;
  }

  try {
    if (!fs.existsSync(dbPath)) {
      console.log('[storage] No database file to backup');
      return false;
    }
    
    // Use consistent copy (includes WAL data) to prevent data loss
    const uploadPath = createConsistentCopy(dbPath) || dbPath;

    const bucket = getStorage().bucket(BUCKET_NAME);
    await bucket.upload(uploadPath, {
      destination: DB_BACKUP_NAME,
      metadata: {
        cacheControl: 'no-cache',
      },
    });

    // Optional transition safety: mirror backup to alias object names.
    const aliases = String(process.env.DB_BACKUP_ALIASES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(name => name !== DB_BACKUP_NAME);
    for (const alias of aliases) {
      await bucket.upload(uploadPath, {
        destination: alias,
        metadata: {
          cacheControl: 'no-cache',
        },
      });
      console.log(`[storage] Mirrored backup to gs://${BUCKET_NAME}/${alias}`);
    }

    // Clean up temp file
    if (uploadPath !== dbPath && fs.existsSync(uploadPath)) {
      try { fs.unlinkSync(uploadPath); } catch (_) {}
    }

    console.log(`[storage] Backed up database to gs://${BUCKET_NAME}/${DB_BACKUP_NAME}`);
    return true;
  } catch (err) {
    console.error('[storage] Failed to backup to cloud:', err.message);
    return false;
  }
}

/**
 * Download latest cloud backup to a specific path
 * @param {string} destPath - Destination path
 * @returns {Promise<boolean>}
 */
export async function downloadBackupTo(destPath) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[storage] Skipping cloud download in non-production');
    return false;
  }
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const file = bucket.file(DB_BACKUP_NAME);
    const [exists] = await file.exists();
    if (!exists) {
      console.log('[storage] No cloud backup found');
      return false;
    }
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await file.download({ destination: destPath });
    console.log(`[storage] Downloaded cloud backup to ${destPath}`);
    return true;
  } catch (err) {
    console.error('[storage] Failed to download backup:', err.message);
    return false;
  }
}

/**
 * Create a daily snapshot in Cloud Storage (YYYY-MM-DD filename)
 * @param {string} dbPath - Local path to backup from
 * @returns {Promise<boolean>} - true if successful
 */
export async function snapshotDailyToCloud(dbPath) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[storage] Skipping daily snapshot in non-production');
    return false;
  }

  try {
    if (!fs.existsSync(dbPath)) {
      console.log('[storage] No database file to snapshot');
      return false;
    }
    // Use consistent copy (includes WAL data) to prevent data loss
    const uploadPath = createConsistentCopy(dbPath) || dbPath;
    const bucket = getStorage().bucket(BUCKET_NAME);
    const ymd = new Date().toISOString().slice(0, 10);
    const dest = `${DAILY_SNAPSHOT_FOLDER}/app.db.${ymd}`;
    await bucket.upload(uploadPath, {
      destination: dest,
      metadata: { cacheControl: 'no-cache' },
    });
    // Clean up temp file
    if (uploadPath !== dbPath && fs.existsSync(uploadPath)) {
      try { fs.unlinkSync(uploadPath); } catch (_) {}
    }
    console.log(`[storage] Daily snapshot saved to gs://${BUCKET_NAME}/${dest}`);
    return true;
  } catch (err) {
    console.error('[storage] Failed to write daily snapshot:', err.message);
    return false;
  }
}

/**
 * Schedule periodic backups
 * @param {string} dbPath - Database path
 * @param {number} intervalMs - Backup interval in milliseconds (default 5 minutes)
 */
export function scheduleBackups(dbPath, intervalMs = 5 * 60 * 1000) {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (process.env.DISABLE_SCHEDULED_BACKUPS === '1') {
    console.log('[storage] Scheduled backups disabled by DISABLE_SCHEDULED_BACKUPS=1');
    return;
  }
  
  setInterval(async () => {
    await backupToCloud(dbPath);
  }, intervalMs);
  
  console.log(`[storage] Scheduled backups every ${intervalMs / 1000}s`);
}

/**
 * Schedule daily snapshot backups (default 24h)
 * @param {string} dbPath - Database path
 * @param {number} intervalMs - Snapshot interval in milliseconds (default 24h)
 */
export function scheduleDailySnapshots(dbPath, intervalMs = 24 * 60 * 60 * 1000) {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  setInterval(async () => {
    await snapshotDailyToCloud(dbPath);
  }, intervalMs);

  console.log(`[storage] Scheduled daily snapshots every ${intervalMs / 1000}s`);
}

import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

const BUCKET_NAME = process.env.GCS_BUCKET || 'jcw-labor-timekeeper';
const DB_BACKUP_NAME = 'app.db';
const ARCHIVE_FOLDER = 'archives';

let storage;

function getStorage() {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
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
    const file = bucket.file(DB_BACKUP_NAME);
    
    const [exists] = await file.exists();
    if (!exists) {
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
    console.log(`[storage] Restored database from gs://${BUCKET_NAME}/${DB_BACKUP_NAME}`);
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

  try {
    if (!fs.existsSync(dbPath)) {
      console.log('[storage] No database file to backup');
      return false;
    }

    const bucket = getStorage().bucket(BUCKET_NAME);
    await bucket.upload(dbPath, {
      destination: DB_BACKUP_NAME,
      metadata: {
        cacheControl: 'no-cache',
      },
    });
    
    console.log(`[storage] Backed up database to gs://${BUCKET_NAME}/${DB_BACKUP_NAME}`);
    return true;
  } catch (err) {
    console.error('[storage] Failed to backup to cloud:', err.message);
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
  
  setInterval(async () => {
    await backupToCloud(dbPath);
  }, intervalMs);
  
  console.log(`[storage] Scheduled backups every ${intervalMs / 1000}s`);
}

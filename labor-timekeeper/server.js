import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { openDb, id } from "./lib/db.js";
import Database from "better-sqlite3";
import { weekStartYMD, weekDates, todayYMD, ymdToDate, payrollMonthRange, payrollWeeksForMonth } from "./lib/time.js";
import { transcribeAudio, parseVoiceCommand } from "./lib/voice.js";
import { getOpenAI } from "./lib/openai.js";
import { buildMonthlyWorkbook } from "./lib/export_excel.js";
import { generateWeeklyExports } from "./lib/export/generateWeekly.js";
import { generateMonthlyExport } from "./lib/export/generateMonthly.js";
import { generatePrintableReport } from "./lib/export/generatePrintable.js";
import { getHolidaysForYear, getHolidaysInRange } from "./lib/holidays.js";
import { getBillRate, buildBillingRatesMap } from "./lib/billing.js";
import { sendMonthlyReport, sendEmail } from "./lib/email.js";
import { archiveAndClearPayroll, listArchives, restoreFromCloud, restoreFromDailySnapshot, verifyDbEntries, downloadBackupTo, scheduleBackups, scheduleDailySnapshots, snapshotDailyToCloud, backupToCloud } from "./lib/storage.js";
import { loadSecrets } from "./lib/secrets.js";
import { migrate } from "./lib/migrate.js";
import { ensureEmployees, getEmployeesDBOrDefault } from "./lib/bootstrap.js";

// Resolve directories relative to this module so the server works
// even when started from a different current working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORT_DIR = process.env.NODE_ENV === 'production' ? '/tmp/exports' : path.join(__dirname, 'exports');
const SEED_DIR = path.join(__dirname, 'seed');

// Load secrets from Google Secret Manager in production
await loadSecrets();

const app = express();

// Ensure persistent DB is restored from Cloud Storage in production
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'app.db');
process.env.DATABASE_PATH = DB_PATH;

function shiftYmd(ymd, days) {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDefaultAdminWeekStart(db) {
  const currentWeekStart = weekStartYMD(new Date());
  const prevWeekStart = shiftYmd(currentWeekStart, -7);
  const currentRange = weekDates(currentWeekStart);
  const prevRange = weekDates(prevWeekStart);
  const currentStart = currentRange.ordered[0]?.ymd || currentWeekStart;
  const currentEnd = currentRange.ordered[6]?.ymd || currentWeekStart;
  const prevStart = prevRange.ordered[0]?.ymd || prevWeekStart;
  const prevEnd = prevRange.ordered[6]?.ymd || prevWeekStart;
  const currentCount = db.prepare(`
    SELECT COUNT(*) as c FROM time_entries
    WHERE work_date >= ? AND work_date <= ? AND status = 'SUBMITTED' AND archived = 0
  `).get(currentStart, currentEnd)?.c || 0;
  if (currentCount > 0) return currentWeekStart;
  const prevCount = db.prepare(`
    SELECT COUNT(*) as c FROM time_entries
    WHERE work_date >= ? AND work_date <= ? AND status = 'SUBMITTED' AND archived = 0
  `).get(prevStart, prevEnd)?.c || 0;
  if (prevCount > 0) return prevWeekStart;
  return currentWeekStart;
}

function monthRange(ym) {
  const payroll = payrollMonthRange(ym);
  if (payroll) return payroll;
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return null;
  const [y, m] = ym.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(y, m, 1, 12, 0, 0));
  next.setUTCDate(next.getUTCDate() - 1);
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return { start, end };
}

if (process.env.NODE_ENV !== 'production') {
  const sidecars = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`];
  for (const file of sidecars) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn('[startup] failed to remove local db file', file, err?.message || err);
    }
  }
}

// ── Hardened cold-start restore: retry + snapshot fallback + verification ──
let _restoreOk = false;
if (process.env.NODE_ENV === 'production') {
  // VM persistent storage: skip cloud restore if local DB already has data.
  // On App Engine /tmp is ephemeral so localEntries will always be 0 → restore runs.
  // On a VM with persistent disk, the DB survives restarts → no re-download needed.
  const localEntries = verifyDbEntries(DB_PATH);
  if (localEntries > 0 || process.env.SKIP_CLOUD_RESTORE === '1') {
    console.log(`[startup] Local DB has ${localEntries} entries — skipping cloud restore`);
    _restoreOk = true;
  }

  // Layer 1: Try main backup with retries
  for (let attempt = 1; attempt <= 3 && !_restoreOk; attempt++) {
    try {
      console.log(`[startup] Restore attempt ${attempt}/3 from main backup…`);
      const restored = await restoreFromCloud(DB_PATH);
      if (restored) {
        const n = verifyDbEntries(DB_PATH);
        console.log(`[startup] Attempt ${attempt}: restored=${restored}, entries=${n}`);
        if (n > 0) { _restoreOk = true; break; }
        console.warn(`[startup] Attempt ${attempt}: file downloaded but 0 entries`);
      } else {
        console.warn(`[startup] Attempt ${attempt}: restoreFromCloud returned false`);
      }
    } catch (err) {
      console.warn(`[startup] Attempt ${attempt} failed:`, err?.message || err);
    }
    if (!_restoreOk && attempt < 3) {
      console.log(`[startup] Waiting 2s before retry…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Layer 2: Fallback to daily snapshots
  if (!_restoreOk) {
    console.warn('[startup] Main backup failed after 3 attempts, trying daily snapshots…');
    try {
      const snapshotOk = await restoreFromDailySnapshot(DB_PATH);
      if (snapshotOk) {
        const n = verifyDbEntries(DB_PATH);
        console.log(`[startup] Snapshot restore: entries=${n}`);
        if (n > 0) _restoreOk = true;
      }
    } catch (err) {
      console.warn('[startup] Daily snapshot restore failed:', err?.message || err);
    }
  }

  if (_restoreOk) {
    console.log('[startup] ✓ Database restored successfully');
  } else {
    console.error('[startup] ✗ ALL restore attempts failed — starting with empty DB');
  }
}

const db = openDb();

// Post-openDb verification
try {
  const postOpen = db.prepare('SELECT COUNT(*) as n FROM time_entries').get();
  const postCust = db.prepare('SELECT COUNT(*) as n FROM customers').get();
  console.log(`[startup] After openDb: ${postOpen?.n || 0} entries, ${postCust?.n || 0} customers`);
} catch (e) { console.warn('[startup] post-openDb check failed', e?.message); }

// Schedule backups to Cloud Storage so data persists beyond ephemeral instances
if (process.env.NODE_ENV === 'production') {
  try {
    scheduleBackups(DB_PATH);
    scheduleDailySnapshots(DB_PATH);
    // Create one snapshot at boot so there is always at least one recent recovery point.
    await snapshotDailyToCloud(DB_PATH);
  } catch (err) {
    console.warn('[startup] scheduleBackups failed', err?.message || err);
  }
}

// Ensure DB schema is migrated (adds columns and seeds customers if empty)
await migrate(db);
ensureSystemCustomer('Lunch', '');

// Ensure fallback/default employees are present in production only
if (process.env.NODE_ENV === 'production') {
  try {
    const res = ensureEmployees(db);
    if (res && res.ok && res.inserted) console.log('[startup] inserted default employees:', res.inserted);
    if (res && !res.ok) console.warn('[startup] ensureEmployees failed:', res.error);
  } catch (err) {
    console.warn('[startup] ensureEmployees threw', err?.message || err);
  }
}

app.use(helmet({ contentSecurityPolicy: false })); // allow inline scripts in MVP
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

// Setup basic crash email alerting
process.on('uncaughtException', async (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  try {
    const to = process.env.EMAIL_TO || 'nathan@jcwelton.com';
    await sendEmail({
      to,
      subject: '🚨 URGENT: Labor Timekeeper App Crash',
      text: `The Labor Timekeeper app has crashed due to an uncaught exception.\n\nError: ${err.message}\n\nStack:\n${err.stack}`
    });
  } catch (emailErr) {
    console.error('[FATAL] Failed to send crash email:', emailErr);
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  try {
    const to = process.env.EMAIL_TO || 'nathan@jcwelton.com';
    await sendEmail({
      to,
      subject: '🚨 URGENT: Labor Timekeeper App Crash (Unhandled Rejection)',
      text: `The Labor Timekeeper app has crashed due to an unhandled rejection.\n\nReason: ${reason}`
    });
  } catch (emailErr) {
    console.error('[FATAL] Failed to send crash email:', emailErr);
  }
});
// Serve generated exports for download links
app.use('/exports', express.static(EXPORT_DIR));

// Use /tmp for uploads in production (App Engine read-only filesystem)
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './data/uploads';
const upload = multer({ dest: uploadDir });

function readSeedJson(relPath) {
  const p = path.join(SEED_DIR, relPath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.warn('[seed] failed to read', p, err?.message || err);
    return null;
  }
}

function uniqueNamesFromSamples(samples, key) {
  const set = new Set();
  for (const entry of samples || []) {
    const name = String(entry?.[key] || '').trim();
    if (name) set.add(name);
  }
  return [...set];
}

function ensureSimulationCustomers(sampleEntries) {
  const existingRows = db.prepare('SELECT name FROM customers').all();
  const existing = new Set(existingRows.map(r => String(r.name || '').toLowerCase()));
  const seedCustomers = readSeedJson('customers.json') || [];
  const seedMap = new Map();
  for (const c of seedCustomers) {
    const name = typeof c === 'string' ? c : c.name;
    if (!name) continue;
    seedMap.set(String(name).toLowerCase(), typeof c === 'string' ? '' : (c.address || ''));
  }

  const sampleNames = uniqueNamesFromSamples(sampleEntries, 'customer');
  let customersToInsert = [];
  if (existing.size === 0) {
    if (seedCustomers.length > 0) customersToInsert = seedCustomers;
    else customersToInsert = sampleNames.map(name => ({ name, address: '' }));
  } else {
    for (const name of sampleNames) {
      if (!name) continue;
      if (existing.has(String(name).toLowerCase())) continue;
      const address = seedMap.get(String(name).toLowerCase()) || '';
      customersToInsert.push({ name, address });
    }
  }

  if (customersToInsert.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)');
  for (const c of customersToInsert) {
    const name = typeof c === 'string' ? c : c.name;
    const address = typeof c === 'string' ? '' : (c.address || '');
    if (!name) continue;
    insert.run(id('cust_'), name, address, now);
    existing.add(String(name).toLowerCase());
  }
}

function ensureSystemCustomer(name, address = '') {
  if (!name) return;
  try {
    const existing = db.prepare('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) return;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)').run(id('cust_'), name, address, now);
  } catch (err) {
    console.warn('[startup] ensureSystemCustomer failed', err?.message || err);
  }
}

function ensureSimulationEmployees(sampleEntries) {
  const count = db.prepare('SELECT COUNT(*) as n FROM employees').get().n || 0;
  if (count > 0) return;
  let employees = readSeedJson('employees.json');
  if (!employees || employees.length === 0) {
    const adminNames = new Set(['chris jacobi', 'chris z', 'chris zavesky']);
    employees = uniqueNamesFromSamples(sampleEntries, 'employee').map(name => ({
      name,
      role: adminNames.has(String(name).toLowerCase()) ? 'admin' : 'hourly',
      default_bill_rate: 0,
      default_pay_rate: 0,
      aliases: []
    }));
  }
  if (!employees || employees.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const e of employees) {
    const isAdmin = e.is_admin ? 1 : (e.role === 'admin' ? 1 : 0);
    insert.run(
      id('emp_'),
      e.name,
      Number(e.default_bill_rate || 0),
      Number(e.default_pay_rate || 0),
      isAdmin,
      JSON.stringify(e.aliases || []),
      now
    );
  }
}

function ensureSimulationSeedData(sampleEntries) {
  ensureSimulationCustomers(sampleEntries);
  ensureSimulationEmployees(sampleEntries);
}

function ensureSimulationRates() {
  // Apply default bill rates for employees if missing (use seed/employees.json)
  const employees = readSeedJson('employees.json') || [];
  const update = db.prepare(`
    UPDATE employees
    SET
      default_bill_rate = COALESCE(NULLIF(default_bill_rate, 0), ?),
      default_pay_rate = COALESCE(NULLIF(default_pay_rate, 0), ?)
    WHERE LOWER(name) = LOWER(?)
  `);
  let updatedEmployees = 0;
  for (const e of employees) {
    if (!e?.name) continue;
    const rate = Number(e.default_bill_rate || 0);
    const r = update.run(rate, rate, e.name);
    if (r.changes > 0) updatedEmployees += r.changes;
  }

  // If overrides are empty, apply seed overrides for simulation-only scenarios
  const overrideCount = db.prepare("SELECT COUNT(*) as n FROM rate_overrides").get().n || 0;
  let updatedOverrides = 0;
  if (overrideCount === 0) {
    const overrides = readSeedJson('rate_overrides.json') || [];
    if (overrides.length > 0) {
      const getEmp = db.prepare("SELECT id FROM employees WHERE name = ? OR LOWER(name) = LOWER(?)");
      const getCust = db.prepare("SELECT id FROM customers WHERE name = ? OR LOWER(name) = LOWER(?)");
      const upsertRate = db.prepare(`
        INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, customer_id) DO UPDATE SET bill_rate=excluded.bill_rate
      `);
      const now = new Date().toISOString();
      for (const o of overrides) {
        const empName = o.employee_name === "Chris J" ? "Chris Jacobi" : o.employee_name;
        const emp = getEmp.get(empName, empName);
        const cust = getCust.get(o.customer_name, o.customer_name);
        if (!emp || !cust) continue;
        upsertRate.run(id("ro_"), emp.id, cust.id, Number(o.bill_rate), now);
        updatedOverrides++;
      }
    }
  }

  return { employeesUpdated: updatedEmployees, overridesUpdated: updatedOverrides };
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getWeekStartsForMonthByWeekEnd(month) {
  const payrollRange = payrollMonthRange(month);
  if (payrollRange) {
    const weeks = payrollWeeksForMonth(month);
    const monthStart = payrollRange.start;
    const nextMonth = shiftYmd(payrollRange.end, 1);
    return { weeks, monthStart, nextMonth };
  }
  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const start = ymdToDate(monthStart);
  const end = ymdToDate(nextMonth);
  const firstWeekStart = weekStartYMD(ymdToDate(monthStart));
  const weeks = [];
  for (let d = ymdToDate(firstWeekStart); d < new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000); d.setDate(d.getDate() + 7)) {
    const weekStart = formatYmd(d);
    const weekEnd = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd >= start && weekEnd < end) weeks.push(weekStart);
  }
  return { weeks, monthStart, nextMonth };
}

function buildStressSampleEntries() {
  const employees = [
    { name: 'Chris Jacobi', role: 'admin', customers: ['JCW'] },
    { name: 'Chris Zavesky', role: 'admin', customers: ['JCW'] },
    { name: 'Doug Kinsey', role: 'hourly', customers: ['Hall', 'Richer', 'Lucas', 'Howard'] },
    { name: 'Jason Green', role: 'hourly', customers: ['Hall', 'Richer', 'Lucas', 'Howard'] },
    { name: 'Boban Abbate', role: 'hourly', customers: ['Boyle', 'Campbell', 'Hall', 'Howard'] },
    { name: 'Sean Matthew', role: 'hourly', customers: ['Landy', 'Watkins', 'Hall', 'Howard'] },
    { name: 'Phil Henderson', role: 'hourly', customers: ['Watkins', 'Richer', 'Lucas', 'Howard'] },
    { name: 'Thomas Brinson', role: 'hourly', customers: ['Landy', 'Watkins', 'Hall', 'Howard'] }
  ];

  const entries = [];
  for (const emp of employees) {
    if (emp.role === 'admin') {
      // Admin template: 8 hours Wed-Fri + Mon-Tue on a single client
      for (const dayOffset of [0, 1, 2, 5, 6]) {
        entries.push({ employee: emp.name, customer: emp.customers[0], hours: 8, dayOffset, notes: '' });
      }
      continue;
    }

    const [monClient, tue1, tue2, tue3] = emp.customers;
    // Hourly template: Wed PTO, Thu Holiday, Fri PTO, Mon 8, Tue split
    entries.push({ employee: emp.name, customer: monClient, hours: 8, dayOffset: 5, notes: '' });
    entries.push({ employee: emp.name, customer: 'PTO', hours: 8, dayOffset: 0, notes: 'PTO' });
    entries.push({ employee: emp.name, customer: 'Holiday Pay', hours: 8, dayOffset: 1, notes: 'Holiday' });
    entries.push({ employee: emp.name, customer: 'PTO', hours: 8, dayOffset: 2, notes: 'PTO' });
    // Tuesday split to mirror template time blocks
    entries.push({ employee: emp.name, customer: tue1, hours: 1.5, dayOffset: 6, notes: '' });
    entries.push({ employee: emp.name, customer: tue2, hours: 0.5, dayOffset: 6, notes: '' });
    entries.push({ employee: emp.name, customer: tue1, hours: 2.5, dayOffset: 6, notes: '' });
    entries.push({ employee: emp.name, customer: tue3, hours: 3.5, dayOffset: 6, notes: '' });
  }

  return entries;
}

/** Health */
app.get("/api/health", (req, res) => {
  try {
    const stats = {
      customers: db.prepare('SELECT COUNT(*) AS n FROM customers').get().n || 0,
      employees: db.prepare('SELECT COUNT(*) AS n FROM employees').get().n || 0,
      time_entries: db.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n || 0
    };
    return res.json({ ok: true, today: todayYMD(), db: DB_PATH, stats });
  } catch (err) {
    return res.json({ ok: true, today: todayYMD(), db: DB_PATH, stats: null, error: String(err?.message || err) });
  }
});

/** Reference data - no auth required */
app.get("/api/customers", (req, res) => {
  // Exclude obvious test or placeholder customers from the public API
  const rows = db.prepare(
    `SELECT id, name, address FROM customers
     WHERE lower(name) NOT LIKE 'test%'
       AND lower(name) NOT LIKE '%api test%'
       AND lower(name) NOT LIKE '%placeholder%'
       AND lower(name) NOT LIKE '%api%'
       AND lower(name) NOT LIKE '%test%'
     ORDER BY name ASC`
  ).all();
  res.json(rows);
});

/** Admin: Clear time entries that reference API/test placeholder customers
 * POST /api/admin/clear-test-entries
 */
app.post('/api/admin/clear-test-entries', (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }

    // Find customer ids with suspicious names
    const rows = db.prepare(`SELECT id, name FROM customers WHERE lower(name) LIKE '%api%' OR lower(name) LIKE '%test%' OR lower(name) LIKE '%placeholder%'`).all();
    if (!rows || rows.length === 0) return res.json({ ok: true, deleted: 0, customers: [] });
    const ids = rows.map(r => r.id);
    const del = db.prepare(`DELETE FROM time_entries WHERE customer_id IN (${ids.map(()=>'?').join(',')})`);
    const result = del.run(...ids);
    res.json({ ok: true, deleted: result.changes || 0, customers: rows.map(r => r.name) });
  } catch (err) {
    console.error('[admin/clear-test-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Diagnostic: list time entries referencing API/Test/Placeholder customers
app.get('/api/admin/list-test-entries', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT te.id, te.work_date, te.hours, te.status, c.name as customer_name, e.name as employee_name
      FROM time_entries te
      JOIN customers c ON c.id = te.customer_id
      JOIN employees e ON e.id = te.employee_id
      WHERE (lower(c.name) LIKE '%api%' OR lower(c.name) LIKE '%test%' OR lower(c.name) LIKE '%placeholder%') AND te.archived = 0
      ORDER BY te.work_date ASC
    `).all();
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[admin/list-test-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: clear entries that were seeded by the simulate functions (notes contain 'Seeded sample hours')
app.post('/api/admin/clear-comments', (req, res) => {
  try {
    const r = db.prepare('DELETE FROM weekly_comments').run();
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[admin/clear-comments]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post('/api/admin/clear-seeded-entries', (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }
    const del = db.prepare(`DELETE FROM time_entries WHERE notes LIKE ?`);
    const r = del.run('%Seeded sample hours%');
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[admin/clear-seeded-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: clear seeded entries for a specific employee
 * POST /api/admin/clear-employee-seeded { employee_id: 'emp_xxx', since?: 'ISO date' }
 */
app.post('/api/admin/clear-employee-seeded', (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }
    const { employee_id, since } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const sinceIso = since ? new Date(since).toISOString() : null;
    let r;
    if (sinceIso) {
      const del = db.prepare(`DELETE FROM time_entries WHERE employee_id = ? AND created_at >= ?`);
      r = del.run(employee_id, sinceIso);
    } else {
      const del = db.prepare(`DELETE FROM time_entries WHERE employee_id = ?`);
      r = del.run(employee_id);
    }
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[admin/clear-employee-seeded]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: list recent time entries (helpful to find seeded entries)
app.get('/api/admin/list-recent-entries', (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString();
    const rows = db.prepare(`
      SELECT te.id, te.work_date, te.hours, te.status, te.notes, te.created_at, e.name as employee_name, c.name as customer_name
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      JOIN customers c ON c.id = te.customer_id
      WHERE te.created_at >= ? AND te.archived = 0
      ORDER BY te.created_at DESC
    `).all(sinceIso);
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[admin/list-recent-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/payroll-weeks", (req, res) => {
  try {
    const today = todayYMD();
    const currentMonth = today.slice(0, 7); // YYYY-MM
    let month = String(req.query.month || currentMonth);
    let weeks = payrollWeeksForMonth(month) || [];

    // If no payroll weeks defined for requested/current month, try next month so UI can advance after close
    if (!weeks.length) {
      const [y, m] = month.split('-').map(Number);
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      const nextWeeks = payrollWeeksForMonth(nextMonth) || [];
      if (nextWeeks.length) {
        month = nextMonth;
        weeks = nextWeeks;
      }
    }

    // Determine sensible currentWeek:
    // - prefer the week that contains today if present
    // - else prefer the first future week (>= today)
    // - else fall back to the most recent available week
    let currentWeek = weekStartYMD(new Date());
    if (weeks.length) {
      if (weeks.includes(currentWeek)) {
        // keep currentWeek as-is
      } else {
        // find first week >= currentWeek (string YYYY-MM-DD compares lexicographically)
        const future = weeks.find(w => w >= currentWeek);
        if (future) currentWeek = future;
        else currentWeek = weeks[weeks.length - 1];
      }
    }

    res.json({ month, weeks, currentWeek });
  } catch (err) {
    console.error("payroll-weeks error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/employees", (req, res) => {
  try {
    const rows = getEmployeesDBOrDefault(db);
    const out = rows.map(r => ({ id: r.id, name: r.name, default_bill_rate: r.default_bill_rate || 0, is_admin: r.role === 'admin' }));
    return res.json(out);
  } catch (err) {
    return res.json([]);
  }
});

/** Time entries - employee_id passed in query/body */
app.get("/api/time-entries", (req, res) => {
  const employeeId = req.query.employee_id;
  if (!employeeId) return res.status(400).json({ error: "employee_id required" });

  const weekStart = String(req.query.week_start || weekStartYMD(new Date()));
  const { ordered } = weekDates(weekStart);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  const rows = db.prepare(`
    SELECT te.*, c.name as customer_name
    FROM time_entries te
    JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ?
      AND te.work_date >= ? AND te.work_date <= ? AND te.archived = 0
    ORDER BY te.work_date ASC, te.start_time ASC, te.created_at ASC
  `).all(employeeId, start, end);

  res.json({ week_start: weekStart, days: ordered, entries: rows });
});

app.post("/api/time-entries", (req, res) => {
  const { id: entryId, employee_id, customer_id, work_date, hours, notes, start_time, end_time } = req.body || {};
  if (!employee_id || !customer_id || !work_date) {
    return res.status(400).json({ error: "employee_id, customer_id, work_date required" });
  }
  const now = new Date().toISOString();
  const calcHours = () => {
    if (start_time && end_time) {
      const [sh, sm] = String(start_time).split(':').map(Number);
      const [eh, em] = String(end_time).split(':').map(Number);
      if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) return null;
      const start = sh + (sm / 60);
      const end = eh + (em / 60);
      return end >= start ? Math.round((end - start) * 100) / 100 : null;
    }
    return null;
  };
  const resolvedHours = hours != null ? Number(hours) : calcHours();
  if (resolvedHours == null || !Number.isFinite(resolvedHours)) {
    return res.status(400).json({ error: "hours or valid start_time/end_time required" });
  }
  let resolvedStart = String(start_time || "");
  let resolvedEnd = String(end_time || "");
  // Total-hours mode: when only hours are provided, stamp a standard PM window.
  if (!resolvedStart && !resolvedEnd && hours != null) {
    resolvedStart = "07:30";
    resolvedEnd = "16:00";
  }

  if (entryId) {
    const existing = db.prepare(`
      SELECT id, status FROM time_entries WHERE id = ?
    `).get(entryId);
    if (!existing) return res.status(404).json({ error: "entry not found" });
    if (existing.status === "APPROVED") {
      return res.status(409).json({ error: "Entry is locked (approved)" });
    }
    db.prepare(`
      UPDATE time_entries
      SET customer_id = ?, work_date = ?, hours = ?, start_time = ?, end_time = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(customer_id, work_date, resolvedHours, resolvedStart, resolvedEnd, String(notes || ""), now, entryId);
  } else {
    db.prepare(`
      INSERT INTO time_entries
        (id, employee_id, customer_id, work_date, hours, start_time, end_time, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
    `).run(id("te_"), employee_id, customer_id, work_date, resolvedHours, resolvedStart, resolvedEnd, String(notes || ""), now, now);
  }

  console.log('[audit] time-entry', JSON.stringify({ employee_id, customer_id, work_date, hours: resolvedHours, start_time: resolvedStart, end_time: resolvedEnd, status: entryId ? 'UPDATED' : 'DRAFT', entry_id: entryId || undefined }));
  res.json({ ok: true });
});

/** Allow employee to delete their own DRAFT time entry
 * DELETE /api/time-entries/:id  { employee_id }
 */
app.delete('/api/time-entries/:id', (req, res) => {
  try {
    const teId = req.params.id;
    const isAdmin = req.headers['x-admin-secret'] === (process.env.ADMIN_PIN || '7707');
    const forceDelete = req.query.force === 'true' || req.body?.force === true;

    const entry = db.prepare('SELECT id, employee_id, status FROM time_entries WHERE id = ?').get(teId);
    if (!entry) return res.status(404).json({ error: 'time entry not found' });

    // Admin force-delete: skip employee_id and status checks
    if (isAdmin && forceDelete) {
      const r = db.prepare('DELETE FROM time_entries WHERE id = ?').run(teId);
      return res.json({ ok: true, deleted: r.changes || 0 });
    }

    // Normal employee delete: require employee_id ownership
    const employeeId = req.body?.employee_id || req.query.employee_id;
    if (!employeeId) return res.status(400).json({ error: 'employee_id required' });
    if (entry.employee_id !== employeeId) return res.status(403).json({ error: 'not authorized to delete this entry' });
    if (entry.status && entry.status !== 'DRAFT') return res.status(409).json({ error: 'only DRAFT entries can be deleted (use ?force=true with admin)' });

    const r = db.prepare('DELETE FROM time_entries WHERE id = ?').run(teId);
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[time-entries/delete]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/time-entries/clear-drafts", (req, res) => {
  try {
    const { employee_id, week_start } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: "employee_id required" });
    const ws = String(week_start || weekStartYMD(new Date()));
    const { ordered } = weekDates(ws);
    const start = ordered[0].ymd;
    const end = ordered[6].ymd;
    const r = db.prepare(`
      DELETE FROM time_entries
      WHERE employee_id = ?
        AND work_date >= ? AND work_date <= ?
        AND (status = 'DRAFT' OR status IS NULL)
    `).run(employee_id, start, end);
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[time-entries/clear-drafts]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/submit-week", async (req, res) => {
  const { employee_id, week_start, comment } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });

  const ws = String(week_start || weekStartYMD(new Date()));
  const { ordered } = weekDates(ws);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  const submitResult = db.prepare(`
    UPDATE time_entries
    SET status = 'SUBMITTED', updated_at = ?
    WHERE employee_id = ?
      AND work_date >= ? AND work_date <= ?
      AND (status = 'DRAFT' OR status IS NULL)
  `).run(new Date().toISOString(), employee_id, start, end);

  if (typeof comment === 'string' && comment.trim()) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO weekly_comments (id, employee_id, week_start, comment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, week_start) DO UPDATE SET
        comment = excluded.comment,
        updated_at = excluded.updated_at
    `).run(id('wc_'), employee_id, ws, comment.trim(), now, now);
  }

  try {
    await backupToCloud(DB_PATH);
  } catch (err) {
    console.warn('[submit-week] backupToCloud failed', err?.message || err);
  }

  // Notify admin via email on submit-week (best-effort)
  (async () => {
    try {
      if ((submitResult?.changes || 0) <= 0) return;
      const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(employee_id);
      const totals = db.prepare(`
        SELECT
          COUNT(*) as entries,
          SUM(hours) as hours
        FROM time_entries
        WHERE employee_id = ?
          AND work_date >= ? AND work_date <= ?
          AND status = 'SUBMITTED'
      `).get(employee_id, start, end);
      const subject = `Week submitted: ${emp?.name || employee_id} (${ws})`;
      const text = `Weekly hours submitted.

Employee: ${emp?.name || employee_id}
Week: ${start} to ${end}
Entries: ${totals?.entries || 0}
Hours: ${Number(totals?.hours || 0).toFixed(2)}
Comment: ${typeof comment === 'string' ? comment.trim() : ''}

View admin approvals: ${process.env.BASE_URL || 'http://localhost:3000'}/admin
`;
      const to = process.env.EMAIL_TO || 'nathan@jcwelton.com';
      await sendEmail({ to, cc: 'projects@jcwelton.com', subject, text });
    } catch (err) {
      console.warn('[email] Failed to send submit-week notification', err?.message || err);
    }
  })();

  console.log('[audit] submit-week', JSON.stringify({ employee_id, week_start: ws, submitted: submitResult?.changes || 0 }));
  res.json({ ok: true, week_start: ws });
});

/** Allow employee to reopen their submitted week (back to DRAFT) */
app.post("/api/unsubmit-week", (req, res) => {
  const { employee_id, week_start } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });
  const ws = String(week_start || weekStartYMD(new Date()));
  const { ordered } = weekDates(ws);
  const start = ordered[0]?.ymd;
  const end = ordered[6]?.ymd;
  if (!start || !end) return res.status(400).json({ error: "Invalid week_start" });
  const stmt = db.prepare(`
    UPDATE time_entries
    SET status = 'DRAFT', updated_at = ?
    WHERE employee_id = ?
      AND work_date >= ? AND work_date <= ?
      AND status = 'SUBMITTED'
  `);
  const now = new Date().toISOString();
  const result = stmt.run(now, employee_id, start, end);
  res.json({ ok: true, week_start: ws, reopened: result.changes || 0 });
});

app.get("/api/weekly-comment", (req, res) => {
  try {
    const employeeId = req.query.employee_id;
    if (!employeeId) return res.status(400).json({ error: "employee_id required" });
    const weekStart = String(req.query.week_start || weekStartYMD(new Date()));
    const row = db.prepare(`
      SELECT comment FROM weekly_comments
      WHERE employee_id = ? AND week_start = ?
    `).get(employeeId, weekStart);
    res.json({ ok: true, week_start: weekStart, comment: row?.comment || "" });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin approvals - no auth, anyone can view/approve for now */
app.get("/api/approvals", (req, res) => {
  const weekStart = String(req.query.week_start || getDefaultAdminWeekStart(db));
  const { ordered } = weekDates(weekStart);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  const rows = db.prepare(`
    SELECT te.*, e.name as employee_name, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'SUBMITTED'
    ORDER BY te.work_date ASC, e.name ASC
  `).all(start, end);

  const comments = db.prepare(`
    SELECT wc.employee_id, wc.comment, e.name as employee_name
    FROM weekly_comments wc
    JOIN employees e ON e.id = wc.employee_id
    WHERE wc.week_start = ?
  `).all(weekStart);

  res.json({ week_start: weekStart, days: ordered, submitted: rows, comments });
});

// Admin: list week starts that have entries in a given month
app.get("/api/admin/weeks", (req, res) => {
  const month = String(req.query.month || '').trim();
  const range = monthRange(month);
  if (!range) return res.status(400).json({ error: "month=YYYY-MM required" });
  const { start, end } = range;
  const weeksFromCalendar = payrollWeeksForMonth(month);
  if (weeksFromCalendar.length) {
    return res.json({ weeks: weeksFromCalendar });
  }
  const rows = db.prepare(`
    SELECT DISTINCT work_date
    FROM time_entries
    WHERE work_date >= ? AND work_date <= ? AND archived = 0
    ORDER BY work_date DESC
  `).all(start, end);
  const weeks = new Set();
  for (const r of rows) {
    if (!r.work_date) continue;
    const ws = weekStartYMD(ymdToDate(r.work_date));
    weeks.add(ws);
  }
  res.json({ weeks: Array.from(weeks).sort().reverse() });
});

app.post("/api/approve", async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids[] required" });

  const stmt = db.prepare("UPDATE time_entries SET status='APPROVED', updated_at=? WHERE id=? AND status='SUBMITTED'");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const teId of ids) stmt.run(now, teId);
  });
  tx();

  try {
    await backupToCloud(DB_PATH);
  } catch (err) {
    console.warn('[approve] backupToCloud failed', err?.message || err);
  }

  res.json({ ok: true, approved: ids.length });
});

// Admin: force backup to cloud (for safe-promote workflow)
app.post("/api/admin/force-backup", async (req, res) => {
  try {
    await backupToCloud(DB_PATH);
    res.json({ ok: true, message: 'Backup triggered' });
  } catch (err) {
    console.error('[force-backup] failed:', err?.message || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: get ALL entries for a week (not just SUBMITTED) - for delete functionality
app.get("/api/admin/all-entries", (req, res) => {
  const weekStart = String(req.query.week_start || getDefaultAdminWeekStart(db));
  const { ordered } = weekDates(weekStart);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  const rows = db.prepare(`
    SELECT te.*, e.name as employee_name, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ? AND te.archived = 0
    ORDER BY te.work_date ASC, e.name ASC
  `).all(start, end);

  res.json({ week_start: weekStart, entries: rows });
});

// Admin preview of monthly report (HTML-friendly data)
app.get("/api/admin/report-preview", (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM required" });
    const { weeks, monthStart, nextMonth } = getWeekStartsForMonthByWeekEnd(month);
    const weekSet = new Set(weeks);
    const rangeStart = weeks[0] || monthStart;
    const rangeEnd = (() => {
      const last = weeks[weeks.length - 1];
      if (!last) return nextMonth;
      const d = ymdToDate(last);
      d.setDate(d.getDate() + 6);
      return formatYmd(d);
    })();

    const rows = db.prepare(`
      SELECT te.*, e.name as employee_name, c.name as customer_name
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      JOIN customers c ON c.id = te.customer_id
      WHERE te.work_date >= ? AND te.work_date <= ?
        AND te.status = 'APPROVED' AND te.archived = 0
      ORDER BY te.work_date ASC, e.name ASC
    `).all(rangeStart, rangeEnd);

    const perEmployee = new Map();
    const perEmpDate = new Map();
    let totalHours = 0;
    let totalBilled = 0;
    let totalEntries = 0;
    for (const r of rows) {
      const weekStart = weekStartYMD(ymdToDate(r.work_date));
      if (!weekSet.has(weekStart)) continue;
      const isLunch = String(r.customer_name || '').toLowerCase() === 'lunch' || String(r.notes || '').toLowerCase().includes('lunch');
      const key = `${r.employee_id}::${r.work_date}`;
      if (!perEmpDate.has(key)) perEmpDate.set(key, { employee_id: r.employee_id, employee_name: r.employee_name, work: 0, lunch: 0, rows: [] });
      const bucket = perEmpDate.get(key);
      const hours = Number(r.hours || 0);
      if (isLunch) bucket.lunch += hours;
      else {
        bucket.work += hours;
        bucket.rows.push(r);
        totalEntries += 1;
      }
    }
    for (const bucket of perEmpDate.values()) {
      const netHours = Math.max(0, Number(bucket.work) - Number(bucket.lunch));
      if (!perEmployee.has(bucket.employee_id)) {
        perEmployee.set(bucket.employee_id, { employee_id: bucket.employee_id, employee_name: bucket.employee_name, hours: 0, billed: 0 });
      }
      const agg = perEmployee.get(bucket.employee_id);
      agg.hours += netHours;
      totalHours += netHours;
      // approximate billed by applying rates per row, then scale for lunch deduction if needed
      let billed = 0;
      for (const r of bucket.rows) {
        const rate = getBillRate(db, r.employee_id, r.customer_id);
        billed += Number(r.hours || 0) * rate;
      }
      if (bucket.work > 0 && bucket.lunch > 0) {
        billed = billed * (netHours / bucket.work);
      }
      agg.billed += billed;
      totalBilled += billed;
    }

    // Build per-week breakdown: week -> customer -> [{ employee, hours, billed }]
    const byWeekMap = new Map();
    for (const bucket of perEmpDate.values()) {
      for (const r of bucket.rows) {
        const ws = weekStartYMD(ymdToDate(r.work_date));
        if (!weekSet.has(ws)) continue;
        if (!byWeekMap.has(ws)) byWeekMap.set(ws, new Map());
        const custMap = byWeekMap.get(ws);
        const custKey = r.customer_name;
        if (!custMap.has(custKey)) custMap.set(custKey, new Map());
        const empMap = custMap.get(custKey);
        if (!empMap.has(r.employee_id)) empMap.set(r.employee_id, { employee_name: bucket.employee_name, hours: 0, billed: 0 });
        const emp = empMap.get(r.employee_id);
        const rate = getBillRate(db, r.employee_id, r.customer_id);
        emp.hours += Number(r.hours || 0);
        emp.billed += Number(r.hours || 0) * rate;
      }
    }
    const byWeek = [...byWeekMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([ws, custMap]) => {
        let weekHours = 0, weekBilled = 0;
        const customers = [...custMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([custName, empMap]) => {
            const employees = [...empMap.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
            const custHours = employees.reduce((s, e) => s + e.hours, 0);
            const custBilled = employees.reduce((s, e) => s + e.billed, 0);
            weekHours += custHours;
            weekBilled += custBilled;
            return { customer: custName, hours: round2(custHours), billed: round2(custBilled), employees: employees.map(e => ({ ...e, hours: round2(e.hours), billed: round2(e.billed) })) };
          });
        return { weekStart: ws, hours: round2(weekHours), billed: round2(weekBilled), customers };
      });

    const comments = weeks.length
      ? db.prepare(`
          SELECT wc.week_start, wc.comment, e.name as employee_name
          FROM weekly_comments wc
          JOIN employees e ON e.id = wc.employee_id
          WHERE wc.week_start IN (${weeks.map(() => '?').join(',')})
        `).all(...weeks)
      : [];

    res.json({
      ok: true,
      month,
      weeks,
      totals: { entries: totalEntries, hours: round2(totalHours), billed: round2(totalBilled) },
      employees: [...perEmployee.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
      byWeek,
      comments
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Voice: upload audio -> transcribe -> parse -> return proposed entries */
app.post("/api/voice/command", upload.single("audio"), async (req, res) => {
  try {
    const openai = getOpenAI();
    if (!openai) return res.status(503).json({ error: "OpenAI API key not configured. Voice features are disabled." });

    if (!req.file) return res.status(400).json({ error: "audio file required" });
    const filePath = req.file.path;
    const originalName = req.file.originalname || "audio.webm";

    const customers = db.prepare("SELECT id, name FROM customers ORDER BY name ASC").all();
    const text = await transcribeAudio(filePath, originalName);
    const parsed = await parseVoiceCommand({ text, customers });

    res.json({ ok: true, transcript: text, parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Exports - no auth for simplicity */
app.get("/api/export/monthly", async (req, res) => {
  try {
    const month = String(req.query.month || "").trim(); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM required" });

    // Use the new generateMonthlyExport which has correct vertical format
    const result = await generateMonthlyExport({ db, month });
    
    // Read the generated file and send it
    const fileBuffer = fs.readFileSync(result.filepath);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Billing Report - same format as monthly but with client-facing billing rates */
app.get("/api/export/monthly-billing", async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM required" });

    // Client-facing billing rates loaded from DB (employees.client_bill_rate)
    // Previously hardcoded — now managed via DB for parity with payroll logic
    const billingRates = buildBillingRatesMap(db);

    const result = await generateMonthlyExport({ db, month, billingRates });
    const fileBuffer = fs.readFileSync(result.filepath);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Printable HTML report - one-click print all timesheets
 * GET /api/admin/print-week?week_start=YYYY-MM-DD
 */
app.get("/api/admin/print-week", (req, res) => {
  try {
    const weekStart = String(req.query.week_start || weekStartYMD(new Date())).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start=YYYY-MM-DD required" });
    }
    const html = generatePrintableReport({ db, weekStart });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("[print-week]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** ============================================================
 *  Option A - Functional XLSX Pipeline Endpoints
 *  ============================================================ */

/**
 * Generate weekly XLSX exports (one per employee)
 * GET /api/admin/generate-week?week_start=YYYY-MM-DD
 */
app.get("/api/admin/generate-week", async (req, res) => {
  try {
    const weekStart = String(req.query.week_start || weekStartYMD()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: "week_start=YYYY-MM-DD required" });
    }

    const result = await generateWeeklyExports({ db, weekStart });

    // Fire-and-forget: email admin with links and attachments for the generated files
    (async () => {
      try {
        const to = process.env.EMAIL_TO || 'nathan@jcwelton.com';
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const links = result.files.map(f => `${baseUrl}/exports/${weekStart.slice(0,7)}/${weekStart}/${encodeURIComponent(f.filename)}`);
        const subject = `Weekly Exports: ${weekStart}`;
        const text = `Weekly exports for ${weekStart} are ready.\n\nFiles:\n${links.join('\n')}\n\nFiles are also attached to this email.`;
        const attachments = result.files.map(f => ({ filename: f.filename, path: f.filepath }));
        await sendEmail({ to, subject, text, attachments });
        console.log('[email] Weekly export notification sent to', to);
      } catch (err) {
        console.warn('[email] Failed to send weekly export notification', err?.message || err);
      }
    })();

    res.json({
      ok: true,
      weekStart,
      outputDir: result.outputDir,
      files: result.files,
      totals: result.totals,
    });
  } catch (err) {
    console.error("[generate-week]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Generate monthly payroll breakdown XLSX
 * GET /api/admin/generate-month?month=YYYY-MM
 */
app.get("/api/admin/generate-month", async (req, res) => {
  try {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const month = String(req.query.month || defaultMonth).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month=YYYY-MM required" });
    }

    const result = await generateMonthlyExport({ db, month });
    res.json({
      ok: true,
      month,
      filepath: result.filepath,
      filename: result.filename,
      totals: result.totals,
    });
  } catch (err) {
    console.error("[generate-month]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Close month: delete all time_entries for the specified month (retention policy)
 * POST /api/admin/close-month { month: "YYYY-MM", confirm: true }
 */
app.post("/api/admin/close-month", async (req, res) => {
  try {
    const { month, confirm } = req.body;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month=YYYY-MM required" });
    }
    if (!confirm) {
      return res.status(400).json({ error: "confirm=true required to delete data" });
    }

    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    // Count entries before deletion
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM time_entries
      WHERE work_date >= ? AND work_date < ?
    `).get(monthStart, nextMonth);

    // Archive entries instead of deleting
    const result = db.prepare(`
      UPDATE time_entries
      SET archived = 1, updated_at = ?
      WHERE work_date >= ? AND work_date < ?
    `).run(new Date().toISOString(), monthStart, nextMonth);

    console.log(`[close-month] Archived ${result.changes} entries for ${month}`);

    res.json({
      ok: true,
      month,
      deletedCount: result.changes,
      message: `Closed month ${month}: ${result.changes} entries archived`,
    });
  } catch (err) {
    console.error("[close-month]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Get holidays for a year or date range
 * GET /api/holidays?year=2026  OR  /api/holidays?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
app.get("/api/holidays", (req, res) => {
  try {
    const year = req.query.year;
    const start = req.query.start;
    const end = req.query.end;

    if (year) {
      const holidays = getHolidaysForYear(parseInt(year, 10));
      return res.json({ ok: true, year: parseInt(year, 10), holidays });
    }

    if (start && end) {
      const holidays = getHolidaysInRange(start, end);
      return res.json({ ok: true, start, end, holidays });
    }

    // Default: current year
    const currentYear = new Date().getFullYear();
    const holidays = getHolidaysForYear(currentYear);
    res.json({ ok: true, year: currentYear, holidays });
  } catch (err) {
    console.error("[holidays]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Auto-create customer if not found (for client confirmation flow)
 * POST /api/customers/find-or-create { name: string, address?: string }
 */
app.post("/api/customers/find-or-create", (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    const trimmedName = name.trim();
    const trimmedAddress = (address || '').trim();
    
    // Try to find existing customer by name (case-insensitive)
    let customer = db.prepare(`
      SELECT * FROM customers WHERE LOWER(name) = LOWER(?)
    `).get(trimmedName);

    let created = false;
    if (!customer) {
      // Create new customer
      const newId = id("cust_");
      db.prepare(`
        INSERT INTO customers (id, name, address, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(newId, trimmedName, trimmedAddress);
      
      customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(newId);
      created = true;
      console.log(`[find-or-create] Created new customer: ${trimmedName}`);
    } else if (trimmedAddress && (!customer.address || customer.address === '')) {
      // Update address if existing customer has no address
      db.prepare("UPDATE customers SET address = ? WHERE id = ?").run(trimmedAddress, customer.id);
      customer.address = trimmedAddress;
    }

    res.json({ ok: true, customer, created });
  } catch (err) {
    console.error("[find-or-create]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Import exports back to DB */
import { importWeeklyExport, importWeek, importMonth } from "./lib/import_excel.js";

// Import a single weekly export file
app.post("/api/import/file", async (req, res) => {
  try {
    const { filePath, dryRun = false, replace = false } = req.body;
    if (!filePath) return res.status(400).json({ error: "filePath required" });
    
    const results = await importWeeklyExport(filePath, { dryRun, replace });
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error("[import/file]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Import all exports for a week
app.post("/api/import/week", async (req, res) => {
  try {
    const { weekStart, dryRun = false, replace = false } = req.body;
    if (!weekStart) return res.status(400).json({ error: "weekStart required (YYYY-MM-DD)" });
    
    const results = await importWeek(weekStart, { dryRun, replace });
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error("[import/week]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Import all exports for a month
app.post("/api/import/month", async (req, res) => {
  try {
    const { yearMonth, dryRun = false, replace = false } = req.body;
    if (!yearMonth) return res.status(400).json({ error: "yearMonth required (YYYY-MM)" });
    
    const results = await importMonth(yearMonth, { dryRun, replace });
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error("[import/month]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// List available exports
app.get("/api/exports", (req, res) => {
  try {
    const exportDir = EXPORT_DIR; // path.resolve("exports")
    if (!fs.existsSync(exportDir)) {
        return res.json({ ok: true, months: [] });
      }
    
      const months = fs.readdirSync(exportDir)
      .filter(d => /^\d{4}-\d{2}$/.test(d))
      .sort()
      .reverse();
    
    const result = months.map(month => {
      const monthDir = path.join(exportDir, month);
      const weeks = fs.readdirSync(monthDir)
        .filter(d => {
          const fullPath = path.join(monthDir, d);
          return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
        })
        .sort();
      
      const hasMonthly = fs.existsSync(path.join(monthDir, `Payroll_Breakdown_${month}.xlsx`));
      
      return { month, weeks, hasMonthly };
    });
    
    res.json({ ok: true, exports: result });
  } catch (err) {
    console.error("[exports]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Seed database (for production deployment) */
app.post("/api/admin/seed", async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'seeding disabled in production' });
    }
    const seedPath = SEED_DIR; // path.resolve("seed")
    const customers = JSON.parse(fs.readFileSync(path.join(seedPath, "customers.json"), "utf-8"));
    const employees = JSON.parse(fs.readFileSync(path.join(seedPath, "employees.json"), "utf-8"));
    const overrides = JSON.parse(fs.readFileSync(path.join(seedPath, "rate_overrides.json"), "utf-8"));
    
    const now = new Date().toISOString();
    
    // Customers
    const findCust = db.prepare("SELECT id, address FROM customers WHERE LOWER(name) = LOWER(?)");
    const insertCust = db.prepare("INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)");
    const updateAddr = db.prepare("UPDATE customers SET address = ? WHERE id = ?");
    
    let custCount = 0;
    for (const c of customers) {
      const name = typeof c === 'string' ? c : c.name;
      const address = typeof c === 'string' ? '' : (c.address || '');
      const existing = findCust.get(name);
      if (existing) {
        if ((!existing.address || existing.address === '') && address) {
          updateAddr.run(address, existing.id);
        }
      } else {
        insertCust.run(id("cust_"), name, address, now);
        custCount++;
      }
    }
    
    // Employees
    const insertEmp = db.prepare(`
      INSERT OR IGNORE INTO employees
        (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    let empCount = 0;
    for (const e of employees) {
      const isAdmin = e.is_admin ? 1 : (e.role === 'admin' ? 1 : 0);
      const result = insertEmp.run(
        id("emp_"),
        e.name,
        Number(e.default_bill_rate || 0),
        Number(e.default_pay_rate || 0),
        isAdmin,
        JSON.stringify(e.aliases || []),
        now
      );
      if (result.changes > 0) empCount++;
    }
    
    // Rate overrides
    const getEmp = db.prepare("SELECT id FROM employees WHERE name = ?");
    const getCust = db.prepare("SELECT id FROM customers WHERE name = ?");
    const upsertRate = db.prepare(`
      INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, customer_id) DO UPDATE SET bill_rate=excluded.bill_rate
    `);
    
    let rateCount = 0;
    for (const o of overrides) {
      const empName = o.employee_name === "Chris J" ? "Chris Jacobi" : o.employee_name;
      const emp = getEmp.get(empName);
      const cust = getCust.get(o.customer_name);
      if (!emp || !cust) continue;
      upsertRate.run(id("ro_"), emp.id, cust.id, Number(o.bill_rate), now);
      rateCount++;
    }
    
    // If running in production, back up DB immediately so seeded data is persisted
    if (process.env.NODE_ENV === 'production') {
      try {
        await backupToCloud(DB_PATH);
      } catch (err) {
        console.warn('[admin/seed] backupToCloud failed', err?.message || err);
      }
    }

    res.json({ 
      ok: true, 
      seeded: { customers: custCount, employees: empCount, overrides: rateCount },
      totals: {
        customers: db.prepare("SELECT COUNT(*) as n FROM customers").get().n,
        employees: db.prepare("SELECT COUNT(*) as n FROM employees").get().n,
        overrides: db.prepare("SELECT COUNT(*) as n FROM rate_overrides").get().n
      }
    });
  } catch (err) {
    console.error("[admin/seed]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Simulate a week with sample entries (optional reset/submit/approve)
 * POST /api/admin/simulate-week { week_start: 'YYYY-MM-DD', reset?: bool, submit?: bool, approve?: bool }
 * If ADMIN_SECRET env var is set, client must send header 'x-admin-secret' or body.admin_secret matching it.
 */
app.post('/api/admin/simulate-week', (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'seeding disabled in production' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }

    const { week_start, reset = false, submit = false, approve = false } = req.body || {};
    if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
      return res.status(400).json({ error: 'week_start=YYYY-MM-DD required' });
    }

    const SAMPLE_ENTRIES = buildStressSampleEntries();

    ensureSimulationSeedData(SAMPLE_ENTRIES);

    // Find employees and customers (include aliases and role for matching)
    const employees = db.prepare('SELECT id, name, aliases_json, role FROM employees').all();
    const customers = db.prepare('SELECT id, name FROM customers').all();
    const empMap = new Map();
    // map by name and aliases (case-insensitive keys)
    for (const e of employees) {
      empMap.set(e.name.toLowerCase(), e);
      try {
        const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : [];
        for (const a of aliases || []) {
          if (a && typeof a === 'string') empMap.set(a.toLowerCase(), e);
        }
      } catch (err) {
        // ignore parse errors
      }
    }
    // customer map keyed by lowercase name for lenient matching
    const custMap = new Map();
    for (const c of customers) custMap.set(c.name.toLowerCase(), c);

    // Optionally delete existing entries for the week
    const start = week_start;
    const startDate = new Date(start);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;

    let created = 0, skipped = 0, deleted = 0;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      if (reset) {
        const del = db.prepare(`DELETE FROM time_entries WHERE work_date >= ? AND work_date <= ?`);
        const r = del.run(start, end);
        deleted = r.changes || 0;
      }

      for (const entry of SAMPLE_ENTRIES) {
        // try exact/alias match (case-insensitive) for employee
        const empKey = String(entry.employee || '').toLowerCase();
        let emp = empMap.get(empKey);
        if (!emp) {
          // try substring match
          emp = employees.find(e => e.name.toLowerCase().includes(empKey) || (e.aliases_json || '').toLowerCase().includes(empKey));
        }

        // try customer match similarly
        const custKey = String(entry.customer || '').toLowerCase();
        let cust = custMap.get(custKey);
        if (!cust) {
          cust = customers.find(c => c.name.toLowerCase().includes(custKey));
        }

        if (!emp || !cust) { skipped++; continue; }

        // Skip admin users and Jafid per request
        const empNameLower = (emp.name || '').toLowerCase();
        if ((emp.role && emp.role === 'admin') || empNameLower.includes('jafid')) {
          skipped++; continue;
        }

        // compute work_date for this entry
        const [y,m,d] = start.split('-').map(Number);
        const workDate = new Date(y, m-1, d + entry.dayOffset);
        const workDateYmd = `${workDate.getFullYear()}-${String(workDate.getMonth()+1).padStart(2,'0')}-${String(workDate.getDate()).padStart(2,'0')}`;

        // avoid duplicate
        const exists = db.prepare(`SELECT id FROM time_entries WHERE employee_id=? AND customer_id=? AND work_date=?`).get(emp.id, cust.id, workDateYmd);
        if (exists) { skipped++; continue; }

        const status = approve ? 'APPROVED' : (submit ? 'SUBMITTED' : 'DRAFT');
        const notes = entry.notes ? `Seeded sample hours - ${entry.notes}` : 'Seeded sample hours';
        db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), notes, status, now, now);
        created++;
      }
    });
    tx();

    res.json({ ok: true, week_start, created, skipped, deleted, options: { reset, submit, approve } });
  } catch (err) {
    console.error('[admin/simulate-week]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Simulate entries for a single employee for a week
 * POST /api/admin/simulate-employee { employee_id: 'id', week_start: 'YYYY-MM-DD', reset?: bool, submit?: bool }
 */
app.post('/api/admin/simulate-employee', (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'seeding disabled in production' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }

    const { employee_id, week_start, reset = false, submit = false } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) return res.status(400).json({ error: 'week_start=YYYY-MM-DD required' });

    ensureSimulationSeedData([]);

    const emp = db.prepare('SELECT id, name, role FROM employees WHERE id = ?').get(employee_id);
    if (!emp) return res.status(404).json({ error: 'employee not found' });
    if (emp.role === 'admin') return res.status(400).json({ error: 'cannot seed admin user' });

    const customers = db.prepare('SELECT id, name FROM customers ORDER BY name ASC').all();
    if (!customers || customers.length === 0) return res.status(400).json({ error: 'no customers to seed' });

    // Simple pattern: fill Mon-Fri with 8 hours across available customers
    const DAY_OFFSETS = [0,1,2,3,4];
    let created = 0, skipped = 0, deleted = 0;
    const now = new Date().toISOString();

    const start = week_start;
    const [y,m,d] = start.split('-').map(Number);
    const tx = db.transaction(() => {
      if (reset) {
        const del = db.prepare(`DELETE FROM time_entries WHERE employee_id=? AND work_date >= ? AND work_date <= ?`);
        const endDate = new Date(y, m-1, d + 6);
        const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
        const r = del.run(employee_id, start, end);
        deleted = r.changes || 0;
      }

      for (let i = 0; i < DAY_OFFSETS.length; i++) {
        const dayOffset = DAY_OFFSETS[i];
        const workDate = new Date(y, m-1, d + dayOffset);
        const workDateYmd = `${workDate.getFullYear()}-${String(workDate.getMonth()+1).padStart(2,'0')}-${String(workDate.getDate()).padStart(2,'0')}`;
        // pick customer round-robin
        const cust = customers[i % customers.length];
        const exists = db.prepare(`SELECT id FROM time_entries WHERE employee_id=? AND customer_id=? AND work_date=?`).get(employee_id, cust.id, workDateYmd);
        if (exists) { skipped++; continue; }
        const status = submit ? 'SUBMITTED' : 'DRAFT';
        db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id('te_'), employee_id, cust.id, workDateYmd, 8, 'Seeded sample hours', status, now, now);
        created++;
      }
    });
    tx();

    res.json({ ok: true, employee: emp.name, week_start, created, skipped, deleted, options: { reset, submit } });
  } catch (err) {
    console.error('[admin/simulate-employee]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Database stats */
app.get("/api/admin/stats", (req, res) => {
  try {
    const stats = {
      customers: db.prepare("SELECT COUNT(*) as n FROM customers").get().n,
      employees: db.prepare("SELECT COUNT(*) as n FROM employees").get().n,
      time_entries: db.prepare("SELECT COUNT(*) as n FROM time_entries").get().n,
      rate_overrides: db.prepare("SELECT COUNT(*) as n FROM rate_overrides").get().n,
      entries_by_status: db.prepare(`
        SELECT status, COUNT(*) as count FROM time_entries GROUP BY status
      `).all()
    };
    res.json({ ok: true, stats });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Temporary debug endpoint: list employees (requires admin secret if set)
app.get('/api/admin/dump-employees', (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.query?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });
    const rows = db.prepare('SELECT id, name, role, is_admin FROM employees ORDER BY name ASC').all();
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[admin/dump-employees]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: upsert rate overrides by employee/customer name
// POST /api/admin/upsert-rates { rates: [{ customer, employee, bill_rate }] }
app.post('/api/admin/upsert-rates', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });

    const rates = req.body?.rates;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: 'rates[] required' });
    }

    const employees = db.prepare('SELECT id, name, aliases_json FROM employees').all();
    const customers = db.prepare('SELECT id, name FROM customers').all();
    const empMap = new Map();
    for (const e of employees) {
      empMap.set(e.name.toLowerCase(), e);
      try {
        const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : [];
        for (const a of aliases || []) empMap.set(String(a).toLowerCase(), e);
      } catch {}
    }
    const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c]));

    const normalizeEmp = name => {
      const raw = String(name || '').trim();
      if (!raw) return '';
      return raw.split(' - ')[0].trim().toLowerCase();
    };
    const normalizeCust = name => String(name || '').trim().toLowerCase();

    const upsert = db.prepare(`
      INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, customer_id) DO UPDATE SET bill_rate=excluded.bill_rate
    `);
    const now = new Date().toISOString();
    let updated = 0;
    const missing = [];

    const tx = db.transaction(() => {
      for (const r of rates) {
        const empKey = normalizeEmp(r.employee);
        const custKey = normalizeCust(r.customer);
        if (!empKey || !custKey) {
          missing.push({ employee: r.employee, customer: r.customer, reason: 'missing name' });
          continue;
        }
        let emp = empMap.get(empKey);
        if (!emp) emp = employees.find(e => e.name.toLowerCase().includes(empKey));
        let cust = custMap.get(custKey);
        if (!cust) cust = customers.find(c => c.name.toLowerCase().includes(custKey));
        if (!emp || !cust) {
          missing.push({ employee: r.employee, customer: r.customer, reason: 'no match' });
          continue;
        }
        upsert.run(id('ro_'), emp.id, cust.id, Number(r.bill_rate || 0), now);
        updated++;
      }
    });
    tx();

    if (process.env.NODE_ENV === 'production') {
      try {
        await backupToCloud(DB_PATH);
      } catch (err) {
        console.warn('[admin/upsert-rates] backupToCloud failed', err?.message || err);
      }
    }

    res.json({ ok: true, updated, missing });
  } catch (err) {
    console.error('[admin/upsert-rates]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: upsert default bill/pay rates by employee name
// POST /api/admin/upsert-employee-rates { rates: [{ employee, bill_rate, pay_rate? }] }
app.post('/api/admin/upsert-employee-rates', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });

    const rates = req.body?.rates;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: 'rates[] required' });
    }

    const employees = db.prepare('SELECT id, name, aliases_json FROM employees').all();
    const empMap = new Map();
    for (const e of employees) {
      empMap.set(e.name.toLowerCase(), e);
      try {
        const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : [];
        for (const a of aliases || []) empMap.set(String(a).toLowerCase(), e);
      } catch {}
    }

    const normalizeEmp = name => {
      const raw = String(name || '').trim();
      if (!raw) return '';
      return raw.split(' - ')[0].trim().toLowerCase();
    };

    const update = db.prepare(`
      UPDATE employees
      SET default_bill_rate = ?, default_pay_rate = ?
      WHERE id = ?
    `);

    let updated = 0;
    const missing = [];
    const tx = db.transaction(() => {
      for (const r of rates) {
        const empKey = normalizeEmp(r.employee);
        if (!empKey) {
          missing.push({ employee: r.employee, reason: 'missing name' });
          continue;
        }
        let emp = empMap.get(empKey);
        if (!emp) emp = employees.find(e => e.name.toLowerCase().includes(empKey));
        if (!emp) {
          missing.push({ employee: r.employee, reason: 'no match' });
          continue;
        }
        const bill = Number(r.bill_rate || 0);
        const pay = Number(r.pay_rate || 0);
        update.run(bill, pay, emp.id);
        updated++;
      }
    });
    tx();

    if (process.env.NODE_ENV === 'production') {
      try {
        await backupToCloud(DB_PATH);
      } catch (err) {
        console.warn('[admin/upsert-employee-rates] backupToCloud failed', err?.message || err);
      }
    }

    res.json({ ok: true, updated, missing });
  } catch (err) {
    console.error('[admin/upsert-employee-rates]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: expose basic schema info for verification
app.get('/api/admin/schema', (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.query?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });

    const tables = ['employees', 'customers', 'rate_overrides', 'time_entries'];
    const schema = {};
    for (const t of tables) {
      schema[t] = db.prepare(`PRAGMA table_info(${t})`).all();
    }
    res.json({ ok: true, schema });
  } catch (err) {
    console.error('[admin/schema]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Seed previous sample weeks for UAT (leaves current week empty)
 * POST /api/admin/seed-weeks
 * Response: { ok: true, seeded: { '<week>': { created, skipped, deleted } } }
 */
app.post('/api/admin/seed-weeks', (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'seeding disabled in production' });
    }
    // Determine week starts: previous 2 weeks; leave current week empty
    const now = new Date();
    const getWeekStart = d => weekStartYMD(new Date(d));
    const currentWeek = getWeekStart(now);
    const prev1 = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
    const prev2 = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14));
    const weeks = [prev2, prev1];

    const results = {};
    for (const wk of weeks) {
      // Reuse simulate-week logic by performing inserts similar to the endpoint
      const SAMPLE_ENTRIES = buildStressSampleEntries();
      ensureSimulationSeedData(SAMPLE_ENTRIES);

      // load employees/customers maps
      const employees = db.prepare('SELECT id, name, aliases_json, role FROM employees').all();
      const customers = db.prepare('SELECT id, name FROM customers').all();
      const empMap = new Map();
      for (const e of employees) {
        empMap.set(e.name.toLowerCase(), e);
        try { const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : []; for (const a of aliases||[]) empMap.set(a.toLowerCase(), e); } catch(e){}
      }
      const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c]));

      let created = 0, skipped = 0, deleted = 0;
      const nowTs = new Date().toISOString();
      const tx = db.transaction(() => {
        // reset week entries to avoid duplicates
        const del = db.prepare(`DELETE FROM time_entries WHERE work_date >= ? AND work_date <= ?`);
        const sy = wk;
        const sd = new Date(sy);
        const ed = new Date(sd); ed.setDate(ed.getDate() + 6);
        const end = `${ed.getFullYear()}-${String(ed.getMonth()+1).padStart(2,'0')}-${String(ed.getDate()).padStart(2,'0')}`;
        const r = del.run(sy, end);
        deleted = r.changes || 0;

        for (const entry of SAMPLE_ENTRIES) {
          const empKey = String(entry.employee || '').toLowerCase();
          let emp = empMap.get(empKey);
          if (!emp) emp = employees.find(e => e.name.toLowerCase().includes(empKey) || (e.aliases_json||'').toLowerCase().includes(empKey));
          const custKey = String(entry.customer || '').toLowerCase();
          let cust = custMap.get(custKey);
          if (!cust) cust = customers.find(c => c.name.toLowerCase().includes(custKey));
          if (!emp || !cust) { skipped++; continue; }
          if ((emp.role && emp.role === 'admin') || (emp.name || '').toLowerCase().includes('jafid')) { skipped++; continue; }

          const [y,m,d] = sy.split('-').map(Number);
          const workDate = new Date(y, m-1, d + entry.dayOffset);
          const workDateYmd = `${workDate.getFullYear()}-${String(workDate.getMonth()+1).padStart(2,'0')}-${String(workDate.getDate()).padStart(2,'0')}`;
          const notes = entry.notes ? `Seeded sample hours - ${entry.notes}` : 'Seeded sample hours';
          db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), notes, 'DRAFT', nowTs, nowTs);
          created++;
        }
      });
      tx();
      results[wk] = { created, skipped, deleted };
    }

    res.json({ ok: true, seeded: results, leftEmpty: currentWeek });
  } catch (err) {
    console.error('[admin/seed-weeks]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Simulate a full month by seeding each week of the month
 * POST /api/admin/simulate-month { month: 'YYYY-MM', reset?: bool, submit?: bool, approve?: bool }
 */
app.post('/api/admin/simulate-month', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });

    const { month, reset = false, submit = false, approve = false } = req.body || {};
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM required' });

    const payrollRange = payrollMonthRange(month);
    const monthStart = payrollRange?.start || `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const nextMonth = payrollRange?.end
      ? shiftYmd(payrollRange.end, 1)
      : (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`);

    // compute payroll week starts for the payroll month
    const weeks = payrollWeeksForMonth(month);
    if (!weeks.length) {
      const firstWeekStart = weekStartYMD(ymdToDate(monthStart));
      const end = ymdToDate(nextMonth);
      for (let d = ymdToDate(firstWeekStart); d < end; d.setDate(d.getDate() + 7)) {
        weeks.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    }

    const ratesSeeded = ensureSimulationRates();
    const SAMPLE_ENTRIES = buildStressSampleEntries();
    ensureSimulationSeedData(SAMPLE_ENTRIES);

    const results = {};
    const missing = [];
    for (const wk of weeks) {
      // call simulate-week logic by constructing body and reusing core insertion code (reset/submit/approve per week)

      // load employees/customers maps
      const employees = db.prepare('SELECT id, name, aliases_json, role FROM employees').all();
      const customers = db.prepare('SELECT id, name FROM customers').all();
      const empMap = new Map();
      for (const e of employees) {
        empMap.set(e.name.toLowerCase(), e);
        try { const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : []; for (const a of aliases||[]) empMap.set(a.toLowerCase(), e); } catch(e){}
      }
      const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c]));

      let created = 0, skipped = 0, deleted = 0;
      const nowTs = new Date().toISOString();
      const tx = db.transaction(() => {
        // optionally delete week entries
        if (reset) {
          const sd = new Date(wk);
          const ed = new Date(sd); ed.setDate(ed.getDate() + 6);
          const endYmd = `${ed.getFullYear()}-${String(ed.getMonth()+1).padStart(2,'0')}-${String(ed.getDate()).padStart(2,'0')}`;
          const del = db.prepare(`DELETE FROM time_entries WHERE work_date >= ? AND work_date <= ?`);
          const r = del.run(wk, endYmd); deleted = r.changes || 0;
        }

        for (const entry of SAMPLE_ENTRIES) {
          const empKey = String(entry.employee || '').toLowerCase();
          let emp = empMap.get(empKey);
          if (!emp) emp = employees.find(e => e.name.toLowerCase().includes(empKey) || (e.aliases_json||'').toLowerCase().includes(empKey));
          const custKey = String(entry.customer || '').toLowerCase();
          let cust = custMap.get(custKey);
          if (!cust) cust = customers.find(c => c.name.toLowerCase().includes(custKey));
          if (!emp || !cust) {
            skipped++;
            if (missing.length < 50) {
              missing.push({ employee: entry.employee, customer: entry.customer, week: wk, reason: !emp ? 'employee' : 'customer' });
            }
            continue;
          }
          const empNameLower = (emp.name || '').toLowerCase();
          if (empNameLower.includes('jafid')) { skipped++; continue; }

          const [yy,mm,dd] = wk.split('-').map(Number);
          const workDate = new Date(yy, mm-1, dd + entry.dayOffset);
          const workDateYmd = `${workDate.getFullYear()}-${String(workDate.getMonth()+1).padStart(2,'0')}-${String(workDate.getDate()).padStart(2,'0')}`;

          // Allow multiple entries for the same customer/day to match template layout

          const status = approve ? 'APPROVED' : (submit ? 'SUBMITTED' : 'DRAFT');
          const notes = entry.notes ? `Seeded sample hours - ${entry.notes}` : 'Seeded sample hours';
          db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), notes, status, nowTs, nowTs);
          created++;
        }
      });
      tx();
      results[wk] = { created, skipped, deleted };
    }

    if (process.env.NODE_ENV === 'production') {
      try {
        await backupToCloud(DB_PATH);
      } catch (err) {
        console.warn('[admin/simulate-month] backupToCloud failed', err?.message || err);
      }
    }

    res.json({ ok: true, month, seeded: results, ratesSeeded, missing });
  } catch (err) {
    console.error('[admin/simulate-month]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Email monthly report */
app.post("/api/admin/email-report", async (req, res) => {
  try {
    const { month, to } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month required in YYYY-MM format" });
    }
    
    // Generate the report
    const result = await generateMonthlyExport({ db, month });
    
    // Send via email
    await sendMonthlyReport({
      month,
      filepath: result.filepath,
      filename: result.filename,
      totals: result.totals,
      to, // optional override, defaults to EMAIL_TO env var
    });
    
    res.json({ 
      ok: true, 
      message: `Report emailed to ${to || process.env.EMAIL_TO}`,
      totals: result.totals 
    });
  } catch (err) {
    console.error("[admin/email-report]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Reconcile payroll - archives and clears time entries for a month */
app.post("/api/admin/reconcile", async (req, res) => {
  try {
    const { month, confirm } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month required in YYYY-MM format" });
    }
    
    // Get payroll month range (payroll weeks, not calendar month)
    const { weeks, monthStart, nextMonth } = getWeekStartsForMonthByWeekEnd(month);
    const weekSet = new Set(weeks);
    const rangeStart = weeks[0] || monthStart;
    const rangeEnd = (() => {
      const last = weeks[weeks.length - 1];
      if (!last) return nextMonth;
      const d = ymdToDate(last);
      d.setDate(d.getDate() + 6);
      return formatYmd(d);
    })();

    // Get preview of what will be archived (using payroll month range)
    // To ensure exact matching to the preview shown, we do a 2-step process:
    // 1. Fetch all candidate entries in the broad date range
    const allEntries = db.prepare(`
      SELECT te.*, e.default_bill_rate,
        COALESCE(ro.bill_rate, e.default_bill_rate) as eff_rate
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      LEFT JOIN rate_overrides ro ON ro.employee_id = te.employee_id AND ro.customer_id = te.customer_id
      WHERE te.work_date >= ? AND te.work_date <= ? AND te.archived = 0
    `).all(rangeStart, rangeEnd);
    
    // 2. Filter strictly by whether the entry's date falls into the weeks for this month
    const validEntryIds = [];
    const filtered = [];
    for (const r of allEntries) {
      const ws = weekStartYMD(ymdToDate(r.work_date));
      if (weekSet.has(ws)) {
        filtered.push(r);
        validEntryIds.push(r.id);
      }
    }
    
    const preview = {
      count: filtered.length,
      totalHours: filtered.reduce((s, r) => s + Number(r.hours || 0), 0),
      totalBilled: filtered.reduce((s, r) => s + Number(r.hours || 0) * Number(r.eff_rate || 0), 0)
    };
    
    if (!confirm) {
      // Return preview without clearing
      return res.json({
        ok: true,
        preview: true,
        month,
        entries: preview.count || 0,
        totalHours: preview.totalHours || 0,
        totalBilled: Math.round((preview.totalBilled || 0) * 100) / 100,
        message: "Send confirm: true to archive this data"
      });
    }
    
    // Set archived = 1 exactly for the valid ids
    let archivedCount = 0;
    if (validEntryIds.length > 0) {
      const nowTs = new Date().toISOString();
      const stmt = db.prepare('UPDATE time_entries SET archived = 1, updated_at = ? WHERE id = ?');
      const tx = db.transaction(() => {
        for (const id of validEntryIds) {
          stmt.run(nowTs, id);
          archivedCount++;
        }
      });
      tx();
    }
    
    res.json({
      ok: true,
      reconciled: true,
      cleared: archivedCount,
      message: `Archived ${archivedCount} entries for ${month}`
    });
  } catch (err) {
    console.error("[admin/reconcile]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Restore latest DB from Cloud Storage and restart instance
 * POST /api/admin/restore-latest
 */
app.post("/api/admin/restore-latest", async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });
    const restored = await restoreFromCloud(DB_PATH);
    res.json({ ok: true, restored });
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error('[admin/restore-latest]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Import custom time entries (for patch seeding/testing)
 * POST /api/admin/import-entries
 * Body: { entries: [{ employee, customer, work_date, hours, notes?, status? }], default_status?: 'SUBMITTED'|'APPROVED'|'DRAFT' }
 * If ADMIN_SECRET env var is set, client must send header 'x-admin-secret' or body.admin_secret matching it.
 */
app.post('/api/admin/import-entries', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) {
      return res.status(403).json({ error: 'admin secret required' });
    }

    const entries = req.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries[] required' });
    }

    const defaultStatus = String(req.body?.default_status || 'SUBMITTED').toUpperCase();
    const allowed = new Set(['DRAFT', 'SUBMITTED', 'APPROVED']);
    const statusFallback = allowed.has(defaultStatus) ? defaultStatus : 'SUBMITTED';

    const employees = db.prepare('SELECT id, name, aliases_json FROM employees').all();
    const customers = db.prepare('SELECT id, name FROM customers').all();
    const empMap = new Map();
    for (const e of employees) {
      empMap.set(String(e.name || '').toLowerCase(), e);
      try {
        const aliases = e.aliases_json ? JSON.parse(e.aliases_json) : [];
        for (const a of aliases || []) empMap.set(String(a).toLowerCase(), e);
      } catch {}
    }
    const custMap = new Map(customers.map(c => [String(c.name || '').toLowerCase(), c]));

    let created = 0;
    const skipped = [];
    const nowTs = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const r of entries) {
        const empKey = String(r.employee || '').trim().toLowerCase();
        const custKey = String(r.customer || '').trim().toLowerCase();
        const workDate = String(r.work_date || '').trim();
        const hours = Number(r.hours || 0);
        if (!empKey || !custKey || !/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !Number.isFinite(hours)) {
          skipped.push({ entry: r, reason: 'invalid fields' });
          continue;
        }
        let emp = empMap.get(empKey);
        if (!emp) emp = employees.find(e => String(e.name || '').toLowerCase().includes(empKey));
        let cust = custMap.get(custKey);
        if (!cust) cust = customers.find(c => String(c.name || '').toLowerCase().includes(custKey));
        if (!emp || !cust) {
          skipped.push({ entry: r, reason: !emp ? 'employee' : 'customer' });
          continue;
        }
        const status = allowed.has(String(r.status || '').toUpperCase()) ? String(r.status || '').toUpperCase() : statusFallback;
        insert.run(id('te_'), emp.id, cust.id, workDate, hours, r.notes || '', status, nowTs, nowTs);
        created += 1;
      }
    });
    tx();

    if (process.env.NODE_ENV === 'production') {
      try {
        await backupToCloud(DB_PATH);
      } catch (err) {
        console.warn('[admin/import-entries] backupToCloud failed', err?.message || err);
      }
    }

    res.json({ ok: true, created, skipped });
  } catch (err) {
    console.error('[admin/import-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: Restore latest DB from Cloud Storage into current DB (merge)
 * POST /api/admin/restore-latest-merge
 */
app.post("/api/admin/restore-latest-merge", async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
    if (adminSecret && provided !== adminSecret) return res.status(403).json({ error: 'admin secret required' });

    const tmpPath = `${DB_PATH}.restore.${Date.now()}`;
    const downloaded = await downloadBackupTo(tmpPath);
    if (!downloaded) return res.status(500).json({ error: 'failed to download backup' });

    const srcDb = new Database(tmpPath, { readonly: true });
    const srcEmployees = srcDb.prepare('SELECT * FROM employees').all();
    const srcCustomers = srcDb.prepare('SELECT * FROM customers').all();
    const srcOverrides = srcDb.prepare('SELECT * FROM rate_overrides').all();
    const srcEntries = srcDb.prepare('SELECT * FROM time_entries').all();
    const srcComments = srcDb.prepare('SELECT * FROM weekly_comments').all();

    const tx = db.transaction(() => {
      db.exec('PRAGMA foreign_keys=OFF;');
      db.exec('DELETE FROM time_entries;');
      db.exec('DELETE FROM weekly_comments;');
      db.exec('DELETE FROM rate_overrides;');
      db.exec('DELETE FROM customers;');
      db.exec('DELETE FROM employees;');

      const insertEmp = db.prepare('INSERT OR IGNORE INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of srcEmployees) insertEmp.run(r.id, r.name, r.default_bill_rate, r.default_pay_rate, r.is_admin, r.aliases_json, r.created_at);

      const insertCust = db.prepare('INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)');
      for (const r of srcCustomers) insertCust.run(r.id, r.name, r.address || '', r.created_at);

      const insertOv = db.prepare('INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const r of srcOverrides) insertOv.run(r.id, r.employee_id, r.customer_id, r.bill_rate, r.created_at);

      const insertTe = db.prepare('INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, start_time, end_time, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of srcEntries) insertTe.run(r.id, r.employee_id, r.customer_id, r.work_date, r.hours, r.start_time || '', r.end_time || '', r.notes || '', r.status, r.created_at, r.updated_at);

      const insertWc = db.prepare('INSERT INTO weekly_comments (id, employee_id, week_start, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of srcComments) insertWc.run(r.id, r.employee_id, r.week_start, r.comment || '', r.created_at, r.updated_at);

      db.exec('PRAGMA foreign_keys=ON;');
    });
    tx();
    srcDb.close();

    res.json({ ok: true, restored: true });
  } catch (err) {
    console.error('[admin/restore-latest-merge]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Admin: List archived payroll months */
app.get("/api/admin/archives", async (req, res) => {
  try {
    const archives = await listArchives();
    res.json({ ok: true, archives });
  } catch (err) {
    console.error("[admin/archives]", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** SPA fallbacks - serve app at root */
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));
app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));
app.get("/admin", (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Labor Timekeeper running on http://localhost:${port}`);
});

// ── Graceful shutdown: flush DB to GCS before the instance dies ──────
// GAE sends SIGTERM before shutting down an instance. Without this handler,
// any writes since the last 5-minute scheduled backup would be lost because
// /tmp is ephemeral.
async function gracefulShutdown(signal) {
  console.log(`[shutdown] Received ${signal} — flushing database to Cloud Storage…`);
  try {
    await backupToCloud(DB_PATH);
    console.log('[shutdown] Final backup completed successfully');
  } catch (err) {
    console.error('[shutdown] Final backup FAILED:', err?.message || err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { openDb, id } from "./lib/db.js";
import { weekStartYMD, weekDates, todayYMD, ymdToDate } from "./lib/time.js";
import { transcribeAudio, parseVoiceCommand } from "./lib/voice.js";
import { getOpenAI } from "./lib/openai.js";
import { buildMonthlyWorkbook } from "./lib/export_excel.js";
import { generateWeeklyExports } from "./lib/export/generateWeekly.js";
import { generateMonthlyExport } from "./lib/export/generateMonthly.js";
import { getHolidaysForYear, getHolidaysInRange } from "./lib/holidays.js";
import { sendMonthlyReport, sendEmail } from "./lib/email.js";
import { archiveAndClearPayroll, listArchives, restoreFromCloud, scheduleBackups, backupToCloud } from "./lib/storage.js";
import { loadSecrets } from "./lib/secrets.js";
import { migrate } from "./lib/migrate.js";
import { ensureEmployees, getEmployeesDBOrDefault } from "./lib/bootstrap.js";

// Resolve directories relative to this module so the server works
// even when started from a different current working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORT_DIR = path.join(__dirname, 'exports');
const SEED_DIR = path.join(__dirname, 'seed');

// Load secrets from Google Secret Manager in production
await loadSecrets();

const app = express();

// Ensure persistent DB is restored from Cloud Storage in production
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'app.db');
process.env.DATABASE_PATH = DB_PATH;

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

if (process.env.NODE_ENV === 'production') {
  try {
    await restoreFromCloud(DB_PATH);
  } catch (err) {
    console.warn('[startup] restoreFromCloud failed', err?.message || err);
  }
}

const db = openDb();

// Schedule backups to Cloud Storage so data persists beyond ephemeral instances
if (process.env.NODE_ENV === 'production') {
  try {
    scheduleBackups(DB_PATH);
  } catch (err) {
    console.warn('[startup] scheduleBackups failed', err?.message || err);
  }
}

// Ensure DB schema is migrated (adds columns and seeds customers if empty)
await migrate(db);

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
  const count = db.prepare('SELECT COUNT(*) as n FROM customers').get().n || 0;
  if (count > 0) return;
  let customers = readSeedJson('customers.json');
  if (!customers || customers.length === 0) {
    customers = uniqueNamesFromSamples(sampleEntries, 'customer').map(name => ({ name, address: '' }));
  }
  if (!customers || customers.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)');
  for (const c of customers) {
    const name = typeof c === 'string' ? c : c.name;
    const address = typeof c === 'string' ? '' : (c.address || '');
    if (!name) continue;
    insert.run(id('cust_'), name, address, now);
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
      WHERE lower(c.name) LIKE '%api%' OR lower(c.name) LIKE '%test%' OR lower(c.name) LIKE '%placeholder%'
      ORDER BY te.work_date ASC
    `).all();
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[admin/list-test-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: clear entries that were seeded by the simulate functions (notes contain 'Seeded sample hours')
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
      WHERE te.created_at >= ?
      ORDER BY te.created_at DESC
    `).all(sinceIso);
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[admin/list-recent-entries]', err);
    res.status(500).json({ error: String(err?.message || err) });
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
      AND te.work_date >= ? AND te.work_date <= ?
    ORDER BY te.work_date ASC
  `).all(employeeId, start, end);

  res.json({ week_start: weekStart, days: ordered, entries: rows });
});

app.post("/api/time-entries", (req, res) => {
  const { employee_id, customer_id, work_date, hours, notes } = req.body || {};
  if (!employee_id || !customer_id || !work_date || hours == null) {
    return res.status(400).json({ error: "employee_id, customer_id, work_date, hours required" });
  }
  const now = new Date().toISOString();

  // Upsert per employee+customer+date (keeps UI simple)
  const existing = db.prepare(`
    SELECT id, status FROM time_entries
    WHERE employee_id = ? AND customer_id = ? AND work_date = ?
  `).get(employee_id, customer_id, work_date);

  if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
    return res.status(409).json({ error: "Entry is locked (submitted/approved)" });
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO time_entries
        (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
    `).run(id("te_"), employee_id, customer_id, work_date, Number(hours), String(notes || ""), now, now);
  } else {
    db.prepare(`
      UPDATE time_entries
      SET hours = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(hours), String(notes || ""), now, existing.id);
  }

  // Notify admin via email about new/updated time entry (best-effort)
  (async () => {
    try {
      const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(employee_id);
      const cust = db.prepare('SELECT id, name FROM customers WHERE id = ?').get(customer_id);
      const subject = `Time entry ${existing ? 'updated' : 'created'}: ${emp?.name || employee_id}`;
      const text = `A time entry was ${existing ? 'updated' : 'created'}.

Employee: ${emp?.name || employee_id}
Customer: ${cust?.name || customer_id}
Date: ${work_date}
Hours: ${hours}
Notes: ${notes || ''}

View admin approvals: ${process.env.BASE_URL || 'http://localhost:3000'}/admin
`;
      const to = process.env.EMAIL_TO || 'nathan@jcwelton.com';
      await sendEmail({ to, subject, text });
    } catch (err) {
      console.warn('[email] Failed to send time-entry notification', err?.message || err);
    }
  })();

  res.json({ ok: true });
});

/** Allow employee to delete their own DRAFT time entry
 * DELETE /api/time-entries/:id  { employee_id }
 */
app.delete('/api/time-entries/:id', (req, res) => {
  try {
    const teId = req.params.id;
    const employeeId = req.body?.employee_id || req.query.employee_id;
    if (!employeeId) return res.status(400).json({ error: 'employee_id required' });

    const entry = db.prepare('SELECT id, employee_id, status FROM time_entries WHERE id = ?').get(teId);
    if (!entry) return res.status(404).json({ error: 'time entry not found' });
    if (entry.employee_id !== employeeId) return res.status(403).json({ error: 'not authorized to delete this entry' });
    if (entry.status && entry.status !== 'DRAFT') return res.status(409).json({ error: 'only DRAFT entries can be deleted' });

    const r = db.prepare('DELETE FROM time_entries WHERE id = ?').run(teId);
    res.json({ ok: true, deleted: r.changes || 0 });
  } catch (err) {
    console.error('[time-entries/delete]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/submit-week", (req, res) => {
  const { employee_id, week_start } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });

  const ws = String(week_start || weekStartYMD(new Date()));
  const { ordered } = weekDates(ws);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  db.prepare(`
    UPDATE time_entries
    SET status = 'SUBMITTED', updated_at = ?
    WHERE employee_id = ?
      AND work_date >= ? AND work_date <= ?
      AND (status = 'DRAFT' OR status IS NULL)
  `).run(new Date().toISOString(), employee_id, start, end);

  res.json({ ok: true, week_start: ws });
});

/** Admin approvals - no auth, anyone can view/approve for now */
app.get("/api/approvals", (req, res) => {
  const weekStart = String(req.query.week_start || weekStartYMD(new Date()));
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

  res.json({ week_start: weekStart, days: ordered, submitted: rows });
});

app.post("/api/approve", (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids[] required" });

  const stmt = db.prepare("UPDATE time_entries SET status='APPROVED', updated_at=? WHERE id=? AND status='SUBMITTED'");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const teId of ids) stmt.run(now, teId);
  });
  tx();

  res.json({ ok: true, approved: ids.length });
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

    // Delete entries
    const result = db.prepare(`
      DELETE FROM time_entries
      WHERE work_date >= ? AND work_date < ?
    `).run(monthStart, nextMonth);

    console.log(`[close-month] Deleted ${result.changes} entries for ${month}`);

    res.json({
      ok: true,
      month,
      deletedCount: result.changes,
      message: `Closed month ${month}: ${result.changes} entries deleted`,
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
        (id, name, pin_hash, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let empCount = 0;
    for (const e of employees) {
      const isAdmin = e.is_admin ? 1 : (e.role === 'admin' ? 1 : 0);
      const result = insertEmp.run(
        id("emp_"),
        e.name,
        "no-auth",
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

    // Sample entries adapted from scripts/simulate.js
    const SAMPLE_ENTRIES = [
      { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 0 },
      { employee: 'Chris Jacobi', customer: 'Hall', hours: 8, dayOffset: 1 },
      { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 2 },
      { employee: 'Chris Jacobi', customer: 'Bryan', hours: 10, dayOffset: 3 },
      { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 4 },
      { employee: 'Chris Z', customer: 'Hall', hours: 9, dayOffset: 0 },
      { employee: 'Chris Z', customer: 'Bryan', hours: 8, dayOffset: 1 },
      { employee: 'Chris Z', customer: 'McGill', hours: 7, dayOffset: 2 },
      { employee: 'Chris Z', customer: 'Hall', hours: 8, dayOffset: 3 },
      { employee: 'Chris Z', customer: 'Bryan', hours: 10, dayOffset: 4 },
      { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 0 },
      { employee: 'Doug Kinsey', customer: 'Hall', hours: 10, dayOffset: 1 },
      { employee: 'Doug Kinsey', customer: 'Bryan', hours: 10, dayOffset: 2 },
      { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 3 },
      { employee: 'Doug Kinsey', customer: 'Hall', hours: 8, dayOffset: 4 },
      { employee: 'Jafid Osorio', customer: 'Bryan', hours: 8, dayOffset: 0 },
      { employee: 'Jafid Osorio', customer: 'McGill', hours: 8, dayOffset: 1 },
      { employee: 'Jafid Osorio', customer: 'Hall', hours: 8, dayOffset: 2 },
      { employee: 'Jafid Osorio', customer: 'Bryan', hours: 8, dayOffset: 3 },
      { employee: 'Jafid Osorio', customer: 'McGill', hours: 8, dayOffset: 4 }
    ];

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
        db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), '', status, now, now);
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
      const SAMPLE_ENTRIES = [
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 0 },
        { employee: 'Chris Jacobi', customer: 'Hall', hours: 8, dayOffset: 1 },
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 2 },
        { employee: 'Chris Jacobi', customer: 'Bryan', hours: 10, dayOffset: 3 },
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 4 },
        { employee: 'Chris Z', customer: 'Hall', hours: 9, dayOffset: 0 },
        { employee: 'Chris Z', customer: 'Bryan', hours: 8, dayOffset: 1 },
        { employee: 'Chris Z', customer: 'McGill', hours: 7, dayOffset: 2 },
        { employee: 'Chris Z', customer: 'Hall', hours: 8, dayOffset: 3 },
        { employee: 'Chris Z', customer: 'Bryan', hours: 10, dayOffset: 4 },
        { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 0 },
        { employee: 'Doug Kinsey', customer: 'Hall', hours: 10, dayOffset: 1 },
        { employee: 'Doug Kinsey', customer: 'Bryan', hours: 10, dayOffset: 2 },
        { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 3 },
        { employee: 'Doug Kinsey', customer: 'Hall', hours: 8, dayOffset: 4 }
      ];

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
          db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), '', 'DRAFT', nowTs, nowTs);
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

    // compute month start and next month start
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // compute payroll week starts (defaults to Wednesday) that intersect the month
    const weeks = [];
    const firstWeekStart = weekStartYMD(ymdToDate(monthStart));
    const end = ymdToDate(nextMonth);
    for (let d = ymdToDate(firstWeekStart); d < end; d.setDate(d.getDate() + 7)) {
      weeks.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }

    const results = {};
    for (const wk of weeks) {
      // call simulate-week logic by constructing body and reusing core insertion code (reset/submit/approve per week)
      // We'll reuse the SAMPLE_ENTRIES pattern from simulate-week
      const SAMPLE_ENTRIES = [
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 0 },
        { employee: 'Chris Jacobi', customer: 'Hall', hours: 8, dayOffset: 1 },
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 2 },
        { employee: 'Chris Jacobi', customer: 'Bryan', hours: 10, dayOffset: 3 },
        { employee: 'Chris Jacobi', customer: 'McGill', hours: 8, dayOffset: 4 },
        { employee: 'Chris Z', customer: 'Hall', hours: 9, dayOffset: 0 },
        { employee: 'Chris Z', customer: 'Bryan', hours: 8, dayOffset: 1 },
        { employee: 'Chris Z', customer: 'McGill', hours: 7, dayOffset: 2 },
        { employee: 'Chris Z', customer: 'Hall', hours: 8, dayOffset: 3 },
        { employee: 'Chris Z', customer: 'Bryan', hours: 10, dayOffset: 4 },
        { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 0 },
        { employee: 'Doug Kinsey', customer: 'Hall', hours: 10, dayOffset: 1 },
        { employee: 'Doug Kinsey', customer: 'Bryan', hours: 10, dayOffset: 2 },
        { employee: 'Doug Kinsey', customer: 'McGill', hours: 10, dayOffset: 3 },
        { employee: 'Doug Kinsey', customer: 'Hall', hours: 8, dayOffset: 4 }
      ];

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
          if (!emp || !cust) { skipped++; continue; }
          const empNameLower = (emp.name || '').toLowerCase();
          if ((emp.role && emp.role === 'admin') || empNameLower.includes('jafid')) { skipped++; continue; }

          const [yy,mm,dd] = wk.split('-').map(Number);
          const workDate = new Date(yy, mm-1, dd + entry.dayOffset);
          const workDateYmd = `${workDate.getFullYear()}-${String(workDate.getMonth()+1).padStart(2,'0')}-${String(workDate.getDate()).padStart(2,'0')}`;

          const exists = db.prepare(`SELECT id FROM time_entries WHERE employee_id=? AND customer_id=? AND work_date=?`).get(emp.id, cust.id, workDateYmd);
          if (exists) { skipped++; continue; }

          const status = approve ? 'APPROVED' : (submit ? 'SUBMITTED' : 'DRAFT');
          db.prepare(`INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id('te_'), emp.id, cust.id, workDateYmd, Number(entry.hours), '', status, nowTs, nowTs);
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

    res.json({ ok: true, month, seeded: results });
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
    
    // Get preview of what will be archived
    const preview = db.prepare(`
      SELECT
        COUNT(*) as count,
        SUM(te.hours) as totalHours,
        SUM(te.hours * COALESCE(ro.bill_rate, e.default_bill_rate)) as totalBilled
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      LEFT JOIN rate_overrides ro ON ro.employee_id = te.employee_id AND ro.customer_id = te.customer_id
      WHERE te.work_date LIKE ?
    `).get(`${month}%`);
    
    if (!confirm) {
      // Return preview without clearing
      return res.json({
        ok: true,
        preview: true,
        month,
        entries: preview.count || 0,
        totalHours: preview.totalHours || 0,
        totalBilled: Math.round((preview.totalBilled || 0) * 100) / 100,
        message: "Send confirm: true to archive and clear this data"
      });
    }
    
    // Archive and clear
    const result = await archiveAndClearPayroll(db, month);
    
    res.json({
      ok: true,
      reconciled: true,
      ...result,
      message: `Archived and cleared ${result.cleared} entries for ${month}`
    });
  } catch (err) {
    console.error("[admin/reconcile]", err);
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

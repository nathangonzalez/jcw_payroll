import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import fs from "fs";
import path from "path";
import { openDb, id } from "./lib/db.js";
import { weekStartYMD, weekDates, todayYMD } from "./lib/time.js";
import { transcribeAudio, parseVoiceCommand } from "./lib/voice.js";
import { getOpenAI } from "./lib/openai.js";
import { buildMonthlyWorkbook } from "./lib/export_excel.js";
import { generateWeeklyExports } from "./lib/export/generateWeekly.js";
import { generateMonthlyExport } from "./lib/export/generateMonthly.js";
import { getHolidaysForYear, getHolidaysInRange } from "./lib/holidays.js";
import { sendMonthlyReport } from "./lib/email.js";
import { archiveAndClearPayroll, listArchives } from "./lib/storage.js";
import { loadSecrets } from "./lib/secrets.js";
import { migrate } from "./lib/migrate.js";

// Load secrets from Google Secret Manager in production
await loadSecrets();

const app = express();
const db = openDb();

// Ensure DB schema is migrated (adds columns and seeds customers if empty)
await migrate(db);

app.use(helmet({ contentSecurityPolicy: false })); // allow inline scripts in MVP
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Use /tmp for uploads in production (App Engine read-only filesystem)
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './data/uploads';
const upload = multer({ dest: uploadDir });

/** Health */
app.get("/api/health", (req, res) => res.json({ ok: true, today: todayYMD() }));

/** Reference data - no auth required */
app.get("/api/customers", (req, res) => {
  const rows = db.prepare("SELECT id, name, address FROM customers ORDER BY name ASC").all();
  res.json(rows);
});

app.get("/api/employees", (req, res) => {
  const rows = db.prepare("SELECT id, name, default_bill_rate, is_admin FROM employees ORDER BY name ASC").all();
  res.json(rows);
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

  res.json({ ok: true });
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
      AND status = 'DRAFT'
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
    const exportDir = path.resolve("exports");
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
    const seedPath = path.resolve("seed");
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

    // Find employees and customers
    const employees = db.prepare('SELECT id, name FROM employees').all();
    const customers = db.prepare('SELECT id, name FROM customers').all();
    const empMap = new Map(employees.map(e => [e.name, e]));
    const custMap = new Map(customers.map(c => [c.name, c]));

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
        const emp = empMap.get(entry.employee);
        const cust = custMap.get(entry.customer);
        if (!emp || !cust) { skipped++; continue; }

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
app.get("/", (req, res) => res.sendFile(path.resolve("public/app.html")));
app.get("/app", (req, res) => res.sendFile(path.resolve("public/app.html")));
app.get("/admin", (req, res) => res.sendFile(path.resolve("public/admin.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Labor Timekeeper running on http://localhost:${port}`);
});

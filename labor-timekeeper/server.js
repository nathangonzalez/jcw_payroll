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
import { buildMonthlyWorkbook, buildInvoiceWorkbook } from "./lib/export_excel.js";
import { generateWeeklyExports } from "./lib/export/generateWeekly.js";
import { generateMonthlyExport } from "./lib/export/generateMonthly.js";
import { getHolidaysForYear, getHolidaysInRange } from "./lib/holidays.js";

const app = express();
const db = openDb();

app.use(helmet({ contentSecurityPolicy: false })); // allow inline scripts in MVP
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const upload = multer({ dest: "./data/uploads" });

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
    const monthYmd = `${month}-01`;

    const wb = await buildMonthlyWorkbook({ db, monthYmd });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Monthly Summary ${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/export/invoice", async (req, res) => {
  try {
    const customerId = String(req.query.customer_id || "");
    const start = String(req.query.start || "");
    const end = String(req.query.end || "");
    if (!customerId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: "customer_id, start=YYYY-MM-DD, end=YYYY-MM-DD required" });
    }

    const wb = await buildInvoiceWorkbook({ db, customerId, startYmd: start, endYmd: end });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice ${customerId} ${start} to ${end}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
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

/** SPA fallbacks - serve app at root */
app.get("/", (req, res) => res.sendFile(path.resolve("public/app.html")));
app.get("/app", (req, res) => res.sendFile(path.resolve("public/app.html")));
app.get("/admin", (req, res) => res.sendFile(path.resolve("public/admin.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Labor Timekeeper running on http://localhost:${port}`);
});

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "fs";
import path from "path";
import { openDb, id } from "./lib/db.js";
import { requireAuth, requireAdmin, cookieName, createSession, destroySession, verifyPin } from "./lib/auth.js";
import { weekStartYMD, weekDates, todayYMD } from "./lib/time.js";
import { transcribeAudio, parseVoiceCommand } from "./lib/voice.js";
import { buildMonthlyWorkbook } from "./lib/export_excel.js";

const app = express();
const db = openDb();

app.use(helmet({ contentSecurityPolicy: false })); // allow inline scripts in MVP
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static("public"));

const upload = multer({ dest: "./data/uploads" });

/** Health */
app.get("/api/health", (req, res) => res.json({ ok: true, today: todayYMD() }));

/** Auth */
app.post("/api/login", (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin) return res.status(400).json({ error: "name and pin required" });
  const emp = db.prepare("SELECT * FROM employees WHERE name = ?").get(String(name));
  if (!emp) return res.status(401).json({ error: "Invalid login" });
  if (!verifyPin(pin, emp.pin_hash)) return res.status(401).json({ error: "Invalid login" });

  const { sid, expires } = createSession(db, emp.id);
  res.cookie(cookieName(), sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true behind HTTPS
    expires
  });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies?.[cookieName()];
  if (sid) destroySession(db, sid);
  res.clearCookie(cookieName());
  res.json({ ok: true });
});

app.get("/api/me", requireAuth(db), (req, res) => {
  res.json({
    id: req.employee.id,
    name: req.employee.name,
    is_admin: !!req.employee.is_admin
  });
});

/** Reference data */
app.get("/api/customers", requireAuth(db), (req, res) => {
  const rows = db.prepare("SELECT id, name FROM customers ORDER BY name ASC").all();
  res.json(rows);
});

app.get("/api/employees", requireAdmin(db), (req, res) => {
  const rows = db.prepare("SELECT id, name, default_bill_rate, is_admin FROM employees ORDER BY name ASC").all();
  res.json(rows);
});

/** Time entries */
app.get("/api/time-entries", requireAuth(db), (req, res) => {
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
  `).all(req.employee.id, start, end);

  res.json({ week_start: weekStart, days: ordered, entries: rows });
});

app.post("/api/time-entries", requireAuth(db), (req, res) => {
  const { customer_id, work_date, hours, notes } = req.body || {};
  if (!customer_id || !work_date || hours == null) return res.status(400).json({ error: "customer_id, work_date, hours required" });
  const now = new Date().toISOString();

  // Upsert per employee+customer+date (keeps UI simple)
  const existing = db.prepare(`
    SELECT id, status FROM time_entries
    WHERE employee_id = ? AND customer_id = ? AND work_date = ?
  `).get(req.employee.id, customer_id, work_date);

  if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
    return res.status(409).json({ error: "Entry is locked (submitted/approved)" });
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO time_entries
        (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
    `).run(id("te_"), req.employee.id, customer_id, work_date, Number(hours), String(notes || ""), now, now);
  } else {
    db.prepare(`
      UPDATE time_entries
      SET hours = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(hours), String(notes || ""), now, existing.id);
  }

  res.json({ ok: true });
});

app.post("/api/submit-week", requireAuth(db), (req, res) => {
  const weekStart = String(req.body?.week_start || weekStartYMD(new Date()));
  const { ordered } = weekDates(weekStart);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  db.prepare(`
    UPDATE time_entries
    SET status = 'SUBMITTED', updated_at = ?
    WHERE employee_id = ?
      AND work_date >= ? AND work_date <= ?
      AND status = 'DRAFT'
  `).run(new Date().toISOString(), req.employee.id, start, end);

  res.json({ ok: true, week_start: weekStart });
});

/** Admin approvals */
app.get("/api/approvals", requireAdmin(db), (req, res) => {
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

app.post("/api/approve", requireAdmin(db), (req, res) => {
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
app.post("/api/voice/command", requireAuth(db), upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "audio file required" });
    const filePath = req.file.path;

    const customers = db.prepare("SELECT id, name FROM customers ORDER BY name ASC").all();
    const text = await transcribeAudio(filePath);
    const parsed = await parseVoiceCommand({ text, customers });

    // Cleanup temp
    fs.unlink(filePath, () => {});
    res.json({ ok: true, transcript: text, parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Exports */
app.get("/api/export/monthly", requireAdmin(db), async (req, res) => {
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

// Invoice export removed - not used in Option A workflow

/** SPA fallbacks */
app.get("/", (req, res) => res.sendFile(path.resolve("public/index.html")));
app.get("/app", (req, res) => res.sendFile(path.resolve("public/app.html")));
app.get("/admin", (req, res) => res.sendFile(path.resolve("public/admin.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Labor Timekeeper running on http://localhost:${port}`);
});

import ExcelJS from "exceljs";
import { openDb, id } from "../lib/db.js";
import { generateWeeklyExports } from "../lib/export/generateWeekly.js";
import { generateMonthlyExport } from "../lib/export/generateMonthly.js";
import { weekDates } from "../lib/time.js";

const weekStart = "2026-01-14";
const month = "2026-01";

const sampleEntries = [
  {
    date: "2026-01-14",
    work: [{ customer: "Nagel", start: "07:30", end: "17:00" }],
    lunch: { start: "12:00", end: "12:30" }
  },
  {
    date: "2026-01-15",
    work: [
      { customer: "Vincent", start: "07:30", end: "15:30" },
      { customer: "Muncey", start: "16:00", end: "17:00" }
    ],
    lunch: { start: "12:00", end: "12:30" }
  },
  {
    date: "2026-01-16",
    work: [
      { customer: "Vincent", start: "08:00", end: "11:00" },
      { customer: "Hall", start: "11:00", end: "16:00" }
    ]
  },
  {
    date: "2026-01-19",
    work: [{ customer: "Landy", start: "07:30", end: "16:00" }],
    lunch: { start: "12:00", end: "12:30" }
  },
  {
    date: "2026-01-20",
    work: [
      { customer: "Hall", start: "07:30", end: "14:00" },
      { customer: "Landy", start: "14:00", end: "16:00" }
    ],
    lunch: { start: "12:00", end: "12:30" }
  }
];

function parseTimeToHours(t) {
  const [h, m] = t.split(":").map(Number);
  return h + (m / 60);
}

function calcHours(start, end) {
  return Math.round((parseTimeToHours(end) - parseTimeToHours(start)) * 100) / 100;
}

function ensureCustomer(db, name) {
  const existing = db.prepare("SELECT id FROM customers WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const custId = id("cust_");
  db.prepare("INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)").run(
    custId,
    name,
    "",
    now
  );
  return custId;
}

function ensureEmployee(db, name, rate = 35) {
  const existing = db.prepare("SELECT id FROM employees WHERE LOWER(name) = LOWER(?)").get(name);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const empId = id("emp_");
  db.prepare(`INSERT INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(empId, name, rate, rate, 0, "[]", now);
  return empId;
}

async function main() {
  const db = openDb();
  const { ordered } = weekDates(weekStart);
  const start = ordered[0].ymd;
  const end = ordered[6].ymd;

  const employeeName = "Jason Green";
  const empId = ensureEmployee(db, employeeName, 35);
  ensureCustomer(db, "Lunch");

  const del = db.prepare(`
    DELETE FROM time_entries
    WHERE employee_id = ?
      AND work_date >= ? AND work_date <= ?
  `);
  del.run(empId, start, end);

  const insert = db.prepare(`
    INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, start_time, end_time, notes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const day of sampleEntries) {
    for (const w of day.work) {
      const custId = ensureCustomer(db, w.customer);
      insert.run(
        id("te_"),
        empId,
        custId,
        day.date,
        calcHours(w.start, w.end),
        w.start,
        w.end,
        "",
        "APPROVED",
        now,
        now
      );
    }
    if (day.lunch) {
      const lunchId = ensureCustomer(db, "Lunch");
      insert.run(
        id("te_"),
        empId,
        lunchId,
        day.date,
        calcHours(day.lunch.start, day.lunch.end),
        day.lunch.start,
        day.lunch.end,
        "Lunch",
        "APPROVED",
        now,
        now
      );
    }
  }

  const weekly = await generateWeeklyExports({ db, weekStart });
  const weeklyFile = weekly.files.find(f => f.employee === employeeName)?.filepath;
  if (!weeklyFile) throw new Error("Weekly export file not found for Jason Green");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(weeklyFile);
  const ws = wb.getWorksheet("Sheet1");

  let total = 0;
  let lunchRows = 0;
  const toHours = (v) => {
    if (v instanceof Date) {
      return v.getUTCHours() + (v.getUTCMinutes() / 60);
    }
    if (typeof v === "number") return v * 24;
    return null;
  };
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const marker = row.getCell(5).value;
    if (String(marker).toLowerCase().includes("total")) break;
    const client = String(row.getCell(2).value || "").trim();
    if (!client) continue;
    const c = row.getCell(3).value;
    const d = row.getCell(4).value || 0;
    const e = row.getCell(5).value;
    const cH = toHours(c);
    const dH = toHours(d) || 0;
    const eH = toHours(e);
    if (cH != null && eH != null) {
      const hours = Math.round(((eH - cH - dH)) * 100) / 100;
      total += hours;
      if (d) lunchRows += 1;
    }
  }

  const monthly = await generateMonthlyExport({ db, month });

  console.log("Weekly export:", weeklyFile);
  console.log("Monthly export:", monthly.filepath);
  console.log("Computed total hours from Sheet1:", total);
  console.log("Lunch rows with deduction:", lunchRows);
  console.log("Expected total hours: 41.5");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

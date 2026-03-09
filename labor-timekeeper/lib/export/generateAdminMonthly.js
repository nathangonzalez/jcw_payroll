import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { getClientBillRate } from "../billing.js";
import { payrollMonthRange, ymdToDate } from "../time.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function formatDateLabel(ymd) {
  const d = ymdToDate(ymd);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

function getOutputDir(month) {
  const baseDir = process.env.NODE_ENV === "production" ? "/tmp/exports" : "./exports";
  const dir = path.resolve(`${baseDir}/${month}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function generateAdminMonthlyExport({ db, month }) {
  const payrollRange = payrollMonthRange(month);
  const monthStart = payrollRange?.start || `${month}-01`;
  const monthEnd = payrollRange?.end || `${month}-31`;

  const rows = db.prepare(`
    SELECT
      te.work_date,
      te.hours,
      te.notes,
      te.employee_id,
      te.customer_id,
      e.name AS employee_name,
      e.role AS employee_role,
      e.is_admin AS employee_is_admin,
      c.name AS customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'APPROVED'
      AND (
        e.role = 'admin'
        OR e.is_admin = 1
        OR lower(e.name) IN ('chris jacobi', 'chris zavesky', 'chris z')
      )
      AND lower(c.name) <> 'lunch'
    ORDER BY te.work_date ASC, c.name ASC, e.name ASC
  `).all(monthStart, monthEnd);

  const byCustomer = new Map();
  for (const r of rows) {
    const customerName = String(r.customer_name || "").trim() || "Unknown";
    if (!byCustomer.has(customerName)) byCustomer.set(customerName, []);
    byCustomer.get(customerName).push(r);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Admin Monthly");

  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Client Name", key: "client", width: 24 },
    { header: "Employee", key: "employee", width: 22 },
    { header: "Hours Per Job", key: "hours", width: 12 },
    { header: "Rate", key: "rate", width: 12 },
    { header: "Total", key: "total", width: 12 },
    { header: "Notes", key: "notes", width: 42 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

  let grandHours = 0;
  let grandTotal = 0;
  const customers = [...byCustomer.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [customerName, entries] of customers) {
    const header = ws.addRow({
      date: "",
      client: customerName,
      employee: "",
      hours: "",
      rate: "",
      total: "",
      notes: "",
    });
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };

    for (const entry of entries) {
      const rate = getClientBillRate(db, entry.employee_id, entry.customer_id);
      const hours = round2(entry.hours);
      const total = round2(hours * rate);
      grandHours += hours;
      grandTotal += total;
      ws.addRow({
        date: formatDateLabel(entry.work_date),
        client: customerName,
        employee: entry.employee_name,
        hours,
        rate,
        total,
        notes: entry.notes || "",
      });
    }

    ws.addRow({});
  }

  const totalRow = ws.addRow({
    date: "",
    client: "MONTH TOTAL",
    employee: "",
    hours: round2(grandHours),
    rate: "",
    total: round2(grandTotal),
    notes: "",
  });
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  totalRow.getCell(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(6).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (let i = 2; i <= ws.rowCount; i += 1) {
    ws.getCell(`E${i}`).numFmt = '"$"#,##0.00';
    ws.getCell(`F${i}`).numFmt = '"$"#,##0.00';
    ws.getCell(`D${i}`).numFmt = '0.00';
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const outputDir = getOutputDir(month);
  const filename = `Admin_Monthly_${month}.xlsx`;
  const filepath = path.join(outputDir, filename);
  await wb.xlsx.writeFile(filepath);

  return {
    filepath,
    filename,
    outputDir,
    totals: {
      customers: customers.length,
      entries: rows.length,
      hours: round2(grandHours),
      total: round2(grandTotal),
    },
  };
}


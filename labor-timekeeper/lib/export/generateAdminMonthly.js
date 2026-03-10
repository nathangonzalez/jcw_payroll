import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { getClientBillRate } from "../billing.js";
import { payrollMonthRange } from "../time.js";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function getOutputDir(month) {
  const baseDir = process.env.NODE_ENV === "production" ? "/tmp/exports" : "./exports";
  const dir = path.resolve(`${baseDir}/${month}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isChrisJacobi(name) {
  const n = normalizeName(name);
  return n.includes("chris jacobi") || n === "chris j";
}

function isChrisZ(name) {
  const n = normalizeName(name);
  return n.includes("chris zavesky") || n === "chris z" || n === "chris z.";
}

const ADMIN_TEMPLATE = [
  { customer: "Campbell", cjRate: 100, czRate: 100 },
  { customer: "Caputo (Maint Items)", cjRate: 100, czRate: 100 },
  { customer: "Caputo (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Corr", cjRate: 100, czRate: 100 },
  { customer: "Delacruz", cjRate: 100, czRate: 100 },
  { customer: "Ericson", cjRate: 100, czRate: 100 },
  { customer: "Fritts (Roof / Mold Issue)", cjRate: 100, czRate: 100 },
  { customer: "Funke (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Funke (Maint Items)", cjRate: 100, czRate: 100 },
  { customer: "Gonzalez (Nathan Personal)", cjRate: 90, czRate: 90 },
  { customer: "Hall", cjRate: 100, czRate: 100 },
  { customer: "Horr (Maint)", cjRate: 100, czRate: 100 },
  { customer: "Horr (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Howard", cjRate: 90, czRate: 90 },
  { customer: "Jebsen", cjRate: 100, czRate: 100 },
  { customer: "Knight (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Knight (Maint Items)", cjRate: 100, czRate: 100 },
  { customer: "Landy", cjRate: 90, czRate: 90 },
  { customer: "Leixner-Smith (Insp)", cjRate: 100, czRate: 100 },
  { customer: "Lynn", cjRate: 90, czRate: 90 },
  { customer: "Markfield", cjRate: 100, czRate: 100 },
  { customer: "McClure (Maint. Items)", cjRate: 100, czRate: 100 },
  { customer: "McClure (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "McFarland", cjRate: 100, czRate: 100 },
  { customer: "McGill", cjRate: 90, czRate: 90 },
  { customer: "Montross (Maint. Items)", cjRate: 100, czRate: 100 },
  { customer: "Montross (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Muncey (Maint. Items)", cjRate: 100, czRate: 100 },
  { customer: "Muncey (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Nagel", cjRate: 100, czRate: 100 },
  { customer: "Null", cjRate: 100, czRate: 100 },
  { customer: "O'Connor (Maint. Items)", cjRate: 100, czRate: 100 },
  { customer: "O'Connor (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Richer", cjRate: 90, czRate: 90 },
  { customer: "Schroeder", cjRate: 100, czRate: 90 },
  { customer: "Sweeney", cjRate: 85, czRate: 85 },
  { customer: "Tercek", cjRate: 90, czRate: 90 },
  { customer: "Theobald", cjRate: 100, czRate: 100 },
  { customer: "Tubergen", cjRate: 100, czRate: 100 },
  { customer: "Ueltschi", cjRate: 85, czRate: 85 },
  { customer: "Varricchio", cjRate: 100, czRate: 100 },
  { customer: "Vincent", cjRate: 100, czRate: 100 },
  { customer: "Walsh", cjRate: 100, czRate: 100 },
  { customer: "Watkins", cjRate: 90, czRate: 90 },
  { customer: "Welles (Maint. Items)", cjRate: 100, czRate: 100 },
  { customer: "Welles (Insp.)", cjRate: 100, czRate: 100 },
  { customer: "Winn", cjRate: 100, czRate: 100 },
  { customer: "Total Hours on Insp.", cjRate: 100, czRate: 100 },
];

const TEMPLATE_RATE_BY_CUSTOMER = new Map(
  ADMIN_TEMPLATE.map((row) => [normalizeName(row.customer), { cjRate: row.cjRate, czRate: row.czRate }])
);

export async function generateAdminMonthlyExport({ db, month }) {
  const payrollRange = payrollMonthRange(month);
  const monthStart = payrollRange?.start || `${month}-01`;
  const monthEnd = payrollRange?.end || `${month}-31`;

  const rows = db.prepare(`
    SELECT
      te.hours,
      te.customer_id,
      te.employee_id,
      e.name AS employee_name,
      c.name AS customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'APPROVED'
      AND te.archived = 0
      AND (
        e.role = 'admin'
        OR e.is_admin = 1
        OR lower(e.name) IN ('chris jacobi', 'chris zavesky', 'chris z')
      )
      AND lower(c.name) <> 'lunch'
    ORDER BY c.name ASC, e.name ASC
  `).all(monthStart, monthEnd);

  const employees = db.prepare(`
    SELECT id, name
    FROM employees
    WHERE role = 'admin' OR is_admin = 1 OR lower(name) IN ('chris jacobi', 'chris zavesky', 'chris z')
    ORDER BY name ASC
  `).all();
  const chrisJ = employees.find((e) => isChrisJacobi(e.name)) || null;
  const chrisZ = employees.find((e) => isChrisZ(e.name)) || null;

  const customerIdRows = db.prepare("SELECT id, name FROM customers ORDER BY name ASC").all();
  const customerIdByName = new Map();
  for (const row of customerIdRows) customerIdByName.set(normalizeName(row.name), row.id);

  const allCustomers = new Set(ADMIN_TEMPLATE.map((row) => row.customer));
  for (const row of rows) {
    allCustomers.add(String(row.customer_name || "").trim());
  }

  const summaryMap = new Map();
  const ensureSummary = (customerName) => {
    if (!summaryMap.has(customerName)) {
      const templateRates = TEMPLATE_RATE_BY_CUSTOMER.get(normalizeName(customerName)) || { cjRate: 100, czRate: 100 };
      summaryMap.set(customerName, {
        customer: customerName,
        cjHours: 0,
        cjRate: templateRates.cjRate,
        czHours: 0,
        czRate: templateRates.czRate,
      });
    }
    return summaryMap.get(customerName);
  };

  for (const customerName of allCustomers) ensureSummary(customerName);

  for (const row of rows) {
    const customer = String(row.customer_name || "").trim();
    const bucket = ensureSummary(customer);
    const hours = round2(Number(row.hours || 0));
    if (isChrisJacobi(row.employee_name)) bucket.cjHours = round2(bucket.cjHours + hours);
    if (isChrisZ(row.employee_name)) bucket.czHours = round2(bucket.czHours + hours);
  }

  const resolveRate = (employee, customerName, fallbackRate) => {
    if (!employee?.id) return Number(fallbackRate || 100);
    const customerId = customerIdByName.get(normalizeName(customerName));
    if (!customerId) return Number(fallbackRate || 100);
    const rate = getClientBillRate(db, employee.id, customerId);
    return Number(rate || fallbackRate || 100);
  };

  for (const row of summaryMap.values()) {
    row.cjRate = resolveRate(chrisJ, row.customer, row.cjRate);
    row.czRate = resolveRate(chrisZ, row.customer, row.czRate);
    row.cjAmount = round2(row.cjHours * row.cjRate);
    row.czAmount = round2(row.czHours * row.czRate);
  }

  const templateOrder = ADMIN_TEMPLATE.map((row) => row.customer);
  const extraCustomers = [...summaryMap.keys()]
    .filter((name) => !templateOrder.some((base) => normalizeName(base) === normalizeName(name)))
    .sort((a, b) => a.localeCompare(b));
  const orderedCustomers = [...templateOrder, ...extraCustomers];

  const orderedRows = orderedCustomers
    .map((customer) => {
      const direct = summaryMap.get(customer);
      if (direct) return direct;
      const byNormalized = [...summaryMap.values()].find(
        (row) => normalizeName(row.customer) === normalizeName(customer)
      );
      return byNormalized || ensureSummary(customer);
    })
    .filter(Boolean);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Admin Monthly");
  ws.properties.defaultRowHeight = 18;
  ws.views = [{ state: "frozen", ySplit: 2 }];

  ws.columns = [
    { width: 34 }, // Client
    { width: 10 }, // CJ Hours
    { width: 9 },  // CJ Rate
    { width: 16 }, // CJ Amount
    { width: 10 }, // CZ Hours
    { width: 9 },  // CZ Rate
    { width: 16 }, // CZ Amount
  ];

  ws.getRow(2).values = [
    "Client",
    "Chris J\nHours",
    "Chris J\nRate",
    "Chris J Amount\nBilled",
    "Chris Z\nHours",
    "Chris Z\nRate",
    "Chris Z Amount\nBilled",
  ];

  const headerRow = ws.getRow(2);
  headerRow.height = 34;
  headerRow.alignment = { vertical: "bottom", horizontal: "center", wrapText: true };
  headerRow.getCell(1).font = { bold: true };
  headerRow.getCell(2).font = { bold: true, color: { argb: "FF1F4E79" } };
  headerRow.getCell(3).font = { bold: true, color: { argb: "FF1F4E79" } };
  headerRow.getCell(4).font = { bold: true, color: { argb: "FF1F4E79" } };
  headerRow.getCell(5).font = { bold: true, color: { argb: "FF2E7D32" } };
  headerRow.getCell(6).font = { bold: true, color: { argb: "FF2E7D32" } };
  headerRow.getCell(7).font = { bold: true, color: { argb: "FF2E7D32" } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFECEFF1" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FF666666" } },
      left: { style: "thin", color: { argb: "FF666666" } },
      bottom: { style: "thin", color: { argb: "FF666666" } },
      right: { style: "thin", color: { argb: "FF666666" } },
    };
  });

  let grandCjHours = 0;
  let grandCzHours = 0;
  let grandCjAmount = 0;
  let grandCzAmount = 0;

  let rowNo = 3;
  for (const row of orderedRows) {
    ws.getCell(`A${rowNo}`).value = row.customer;
    ws.getCell(`B${rowNo}`).value = row.cjHours || "";
    ws.getCell(`C${rowNo}`).value = row.cjRate || "";
    ws.getCell(`D${rowNo}`).value = {
      formula: `IF(OR(B${rowNo}="",C${rowNo}=""),"",B${rowNo}*C${rowNo})`,
      result: row.cjAmount || 0,
    };
    ws.getCell(`E${rowNo}`).value = row.czHours || "";
    ws.getCell(`F${rowNo}`).value = row.czRate || "";
    ws.getCell(`G${rowNo}`).value = {
      formula: `IF(OR(E${rowNo}="",F${rowNo}=""),"",E${rowNo}*F${rowNo})`,
      result: row.czAmount || 0,
    };

    ws.getCell(`B${rowNo}`).font = { color: { argb: "FF1F4E79" } };
    ws.getCell(`C${rowNo}`).font = { color: { argb: "FF1F4E79" } };
    ws.getCell(`D${rowNo}`).font = { color: { argb: "FF1F4E79" } };
    ws.getCell(`E${rowNo}`).font = { color: { argb: "FF2E7D32" } };
    ws.getCell(`F${rowNo}`).font = { color: { argb: "FF2E7D32" } };
    ws.getCell(`G${rowNo}`).font = { color: { argb: "FF2E7D32" } };

    for (let c = 1; c <= 7; c += 1) {
      ws.getCell(rowNo, c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF5F5F5" },
      };
    }

    grandCjHours += Number(row.cjHours || 0);
    grandCzHours += Number(row.czHours || 0);
    grandCjAmount += Number(row.cjAmount || 0);
    grandCzAmount += Number(row.czAmount || 0);
    rowNo += 1;
  }

  const totalRowNo = rowNo;
  ws.getCell(`A${totalRowNo}`).value = "TOTAL:";
  ws.getCell(`B${totalRowNo}`).value = { formula: `SUM(B3:B${totalRowNo - 1})`, result: round2(grandCjHours) };
  ws.getCell(`D${totalRowNo}`).value = { formula: `SUM(D3:D${totalRowNo - 1})`, result: round2(grandCjAmount) };
  ws.getCell(`E${totalRowNo}`).value = { formula: `SUM(E3:E${totalRowNo - 1})`, result: round2(grandCzHours) };
  ws.getCell(`G${totalRowNo}`).value = { formula: `SUM(G3:G${totalRowNo - 1})`, result: round2(grandCzAmount) };
  ws.getRow(totalRowNo).font = { bold: true };
  for (let c = 1; c <= 7; c += 1) {
    ws.getCell(totalRowNo, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0F0F0" },
    };
  }

  const footerNote = month === "2026-01"
    ? "*Chris Z was off Jan 1st, 2nd, 16th -4 hours half day"
    : "";
  if (footerNote) {
    ws.getCell(`A${totalRowNo + 1}`).value = footerNote;
    ws.getCell(`A${totalRowNo + 1}`).font = { italic: true, color: { argb: "FF2E7D32" } };
    ws.mergeCells(`A${totalRowNo + 1}:G${totalRowNo + 1}`);
    ws.getCell(`A${totalRowNo + 1}`).alignment = { horizontal: "center" };
  }
  for (let r = 2; r <= totalRowNo; r += 1) {
    for (let c = 1; c <= 7; c += 1) {
      ws.getCell(r, c).border = {
        top: { style: "thin", color: { argb: "FF9E9E9E" } },
        left: { style: "thin", color: { argb: "FF9E9E9E" } },
        bottom: { style: "thin", color: { argb: "FF9E9E9E" } },
        right: { style: "thin", color: { argb: "FF9E9E9E" } },
      };
      if (c === 2 || c === 3 || c === 5 || c === 6) {
        ws.getCell(r, c).alignment = { horizontal: "center" };
      } else if (c !== 1) {
        ws.getCell(r, c).alignment = { horizontal: "right" };
      }
    }
  }

  for (let c = 1; c <= 7; c += 1) {
    const cell = ws.getCell(totalRowNo, c);
    cell.border = {
      ...cell.border,
      top: { style: "double", color: { argb: "FF000000" } },
    };
  }

  for (let i = 3; i <= totalRowNo; i += 1) {
    ws.getCell(`B${i}`).numFmt = '0.0;[Red]-0.0;""';
    ws.getCell(`C${i}`).numFmt = '0;[Red]-0;""';
    ws.getCell(`D${i}`).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00;"-"';
    ws.getCell(`E${i}`).numFmt = '0.0;[Red]-0.0;""';
    ws.getCell(`F${i}`).numFmt = '0;[Red]-0;""';
    ws.getCell(`G${i}`).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00;"-"';
  }

  ws.getCell(`B${totalRowNo}`).numFmt = "0.0";
  ws.getCell(`D${totalRowNo}`).numFmt = '"$"#,##0.00';
  ws.getCell(`E${totalRowNo}`).numFmt = "0.0";
  ws.getCell(`G${totalRowNo}`).numFmt = '"$"#,##0.00';

  const outputDir = getOutputDir(month);
  const filename = `Admin_Monthly_${month}.xlsx`;
  const filepath = path.join(outputDir, filename);
  await wb.xlsx.writeFile(filepath);

  return {
    filepath,
    filename,
    outputDir,
    totals: {
      customers: orderedRows.length,
      entries: rows.length,
      hours: round2(grandCjHours + grandCzHours),
      total: round2(grandCjAmount + grandCzAmount),
    },
  };
}


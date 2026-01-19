/**
 * Weekly XLSX Export Generator
 * Generates 1 workbook per employee per week
 * Filename: <EmployeeName>_<YYYY-MM-DD>.xlsx
 * Columns: Date, Client, Hours, Type (Regular|OT|PTO|Holiday), Rate, Total
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";
import { getBillRate } from "../billing.js";
import { getEmployeeCategory, splitEntriesWithOT, calculatePayWithOT } from "../classification.js";
import { isHoliday } from "../holidays.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATHS = [
  path.resolve(__dirname, "..", "..", "public", "icon-192.png"),
  path.resolve(process.cwd(), "public", "icon-192.png")
];

/**
 * Generate weekly XLSX files for all employees with approved entries
 * @param {Object} options
 * @param {Database} options.db - SQLite database instance
 * @param {string} options.weekStart - Week start date YYYY-MM-DD
 * @returns {Promise<{files: Array, totals: Object}>}
 */
export async function generateWeeklyExports({ db, weekStart }) {
  // Calculate week end (7 days from start)
  const [y, m, d] = weekStart.split("-").map(Number);
  const startDate = new Date(y, m - 1, d);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const weekEnd = formatYmd(endDate);

  // Create output directory (use /tmp in production for App Engine)
  const baseDir = process.env.NODE_ENV === 'production' ? '/tmp/exports' : './exports';
  const monthDir = weekStart.slice(0, 7);
  const outputDir = path.resolve(`${baseDir}/${monthDir}/${weekStart}`);
  ensureDir(outputDir);

  // Query all approved entries for the week, grouped by employee
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.default_bill_rate, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'APPROVED'
    ORDER BY te.employee_id, te.work_date ASC
  `).all(weekStart, weekEnd);

  // Group by employee
  const byEmployee = new Map();
  for (const row of entries) {
    if (!byEmployee.has(row.employee_id)) {
      byEmployee.set(row.employee_id, {
        id: row.employee_id,
        name: row.employee_name,
        entries: [],
      });
    }
    byEmployee.get(row.employee_id).entries.push(row);
  }

  // Ensure all employees exist in the map (create empty entries for those with no approved rows)
  const allEmployees = db.prepare('SELECT id, name FROM employees ORDER BY name ASC').all();
  for (const e of allEmployees) {
    if (!byEmployee.has(e.id)) {
      byEmployee.set(e.id, { id: e.id, name: e.name, entries: [] });
    }
  }

  const files = [];
  const totals = {
    employees: 0,
    totalHours: 0,
    totalRegular: 0,
    totalOT: 0,
    totalAmount: 0,
    adminAmount: 0,
    hourlyAmount: 0,
  };

  // Generate one workbook per employee
  for (const [empId, emp] of byEmployee) {
    const category = getEmployeeCategory(emp.name);
    const workbook = new ExcelJS.Workbook();
    const logoId = addLogoImage(workbook);
    const ws = workbook.addWorksheet("Sheet1");
    // Jason Green.xls-style header
    ws.columns = [
      { width: 10 }, // Date
      { width: 22 }, // Client Name
      { width: 12 }, // Time Start
      { width: 10 }, // Lunch
      { width: 12 }, // Time Out
      { width: 14 }, // Hours Per Job
      { width: 3 },  // spacer
      { width: 22 }, // Client
      { width: 10 }, // Hours
      { width: 10 }, // Rate
      { width: 12 }, // Total
    ];
    const headerRow = ws.addRow(["Date", "Client Name", "Time Start", "Lunch", "Time Out", "Hours Per Job", "", "Client", "Hours", "Rate", "Total"]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell, colNum) => {
      if ([1,2,3,4,5,6,8,9,10,11].includes(colNum)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      }
    });
    addLogoToSheet(ws, logoId, 7.2);

    // Build entries with rate lookup and type assignment
    const enrichedEntries = emp.entries.map((e) => {
      const rate = getBillRate(db, e.employee_id, e.customer_id);
      const holiday = isHoliday(e.work_date);
      return {
        ...e,
        rate,
        holidayName: holiday.name,
      };
    });

    // Split entries for OT calculation (hourly employees)
    const processedEntries = splitEntriesWithOT(enrichedEntries, category);

    // Calculate totals for this employee
    let empTotalHours = 0;
    let empRegularHours = 0;
    let empOTHours = 0;
    let empTotalAmount = 0;

    // Prepare entries grouped by date for left panel
    const entriesByDate = new Map();
    for (const entry of processedEntries) {
      const key = entry.work_date;
      if (!entriesByDate.has(key)) entriesByDate.set(key, []);
      entriesByDate.get(key).push(entry);
    }
    const sortedDates = [...entriesByDate.keys()].sort();

    const leftRows = [];
    const summaryMap = new Map();

    for (const date of sortedDates) {
      const dayEntries = entriesByDate.get(date);
      const dayObj = new Date(date + "T12:00:00");
      const dayName = dayObj.toLocaleDateString("en-US", { weekday: "short" });
      const dayNum = String(dayObj.getDate());
      let currentTime = 7.5;
      // Pre-calc lunch row: first row that would start at/after noon (without lunch).
      let probeTime = 7.5;
      let lunchIndex = -1;
      for (let i = 0; i < dayEntries.length; i += 1) {
        if (probeTime >= 12) {
          lunchIndex = i;
          break;
        }
        probeTime += Number(dayEntries[i].hours || 0);
      }
      if (lunchIndex === -1) lunchIndex = 0;
      let idx = 0;
      for (const entry of dayEntries) {
        const hours = Number(entry.hours);
        const rate = entry.rate;

        let type = entry.type || "Regular";
        if (entry.holidayName) type = "Holiday";
        if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";

        const clientName = type === "PTO" ? "PTO" : (type === "Holiday" ? "Holiday Pay" : entry.customer_name);
        const dateLabel = idx === 0 ? dayName : (idx === 1 ? dayNum : "");

        const timeStart = currentTime;
        const lunch = idx === lunchIndex ? 0.5 : "";
        const timeOut = timeStart + hours + (lunch === "" ? 0 : lunch);

        leftRows.push([dateLabel, clientName, round2(timeStart), lunch, round2(timeOut), hours, "", "", "", "", ""]);
        currentTime = timeOut;
        idx += 1;

        const otMultiplier = type === "OT" ? 1.5 : 1;
        const total = round2(hours * rate * otMultiplier);

        empTotalHours += hours;
        if (type === "OT") empOTHours += hours;
        else empRegularHours += hours;
        empTotalAmount += total;

        const key = clientName.toLowerCase();
        if (!summaryMap.has(key)) summaryMap.set(key, { name: clientName, hours: 0, total: 0, rate });
        const agg = summaryMap.get(key);
        agg.hours += hours;
        agg.total += total;
        agg.rate = rate;

      }
    }

    for (const r of leftRows) ws.addRow(r);
    const desiredTotalRow = 39; // matches template where Total is on row 39
    while (ws.rowCount < desiredTotalRow - 1) ws.addRow(["", "", "", "", "", "", "", "", "", "", ""]);

    const totalRowIndex = desiredTotalRow;
    const totalRow = ["", "", "", "", "Total:", { formula: `SUM(F2:F${totalRowIndex - 1})` }, "", "", "", "", ""];
    ws.addRow(totalRow);

    // Right panel summary (client totals)
    const summaryRows = [...summaryMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    let rIdx = 2;
    const rateSet = new Set();
    const summaryTotalRow = 21; // template TOTAL row
    for (const s of summaryRows) {
      if (rIdx >= summaryTotalRow) break;
      const row = ws.getRow(rIdx);
      row.getCell(8).value = s.name;
      row.getCell(9).value = round2(s.hours);
      row.getCell(10).value = s.rate;
      row.getCell(11).value = { formula: `I${rIdx}*J${rIdx}` };
      rateSet.add(s.rate);
      rIdx++;
    }
    const totalSummaryRow = ws.getRow(summaryTotalRow);
    totalSummaryRow.getCell(8).value = "TOTAL:";
    totalSummaryRow.getCell(9).value = { formula: `SUM(I2:I${summaryTotalRow - 1})` };
    totalSummaryRow.getCell(10).value = rateSet.size === 1 ? [...rateSet][0] : "";
    totalSummaryRow.getCell(11).value = { formula: `SUM(K2:K${summaryTotalRow - 1})` };

    ws.getColumn(10).numFmt = '"$"#,##0.00';
    ws.getColumn(11).numFmt = '"$"#,##0.00';
    try { formatSheet(ws); } catch (e) {}

    // Save file
    const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${safeName}_${weekStart}.xlsx`;
    const filepath = path.join(outputDir, filename);
    // Office Use Only sheet (template-style)
    const officeSheet = workbook.addWorksheet("Sheet2");
    addLogoToSheet(officeSheet, logoId, 7.2);
    officeSheet.columns = [
      { width: 16 }, { width: 10 }, { width: 10 }, { width: 12 },
      { width: 2 }, { width: 16 }, { width: 10 }, { width: 10 }, { width: 12 }
    ];
    officeSheet.getCell("A1").value = "OFFICE USE ONLY:";
    officeSheet.getCell("A1").font = { bold: true };
    const weekRange = `${formatMdy(startDate)} - ${formatMdy(endDate)}`;
    officeSheet.getCell("A5").value = emp.name;
    officeSheet.getCell("F5").value = weekRange;
    officeSheet.getCell("A7").value = "JOB";
    officeSheet.getCell("B7").value = "HOURS";
    officeSheet.getCell("C7").value = "RATE";
    officeSheet.getCell("D7").value = "TOTAL";
    officeSheet.getCell("F7").value = "JOB";
    officeSheet.getCell("G7").value = "HOURS";
    officeSheet.getCell("H7").value = "RATE";
    officeSheet.getCell("I7").value = "TOTAL";
    officeSheet.getRow(7).font = { bold: true };
    officeSheet.getCell("A21").value = "HOURS";
    officeSheet.getCell("B21").value = "RATE";
    officeSheet.getCell("C21").value = "TOTAL";
    officeSheet.getRow(21).font = { bold: true };

    // Blank Sheet3 to match template
    workbook.addWorksheet("Sheet3");
    await workbook.xlsx.writeFile(filepath);

    files.push({
      employee: emp.name,
      category,
      filename,
      filepath,
      hours: empTotalHours,
      regularHours: empRegularHours,
      otHours: empOTHours,
      amount: empTotalAmount,
    });

    // Update totals
    totals.employees++;
    totals.totalHours += empTotalHours;
    totals.totalRegular += empRegularHours;
    totals.totalOT += empOTHours;
    totals.totalAmount += empTotalAmount;
    if (category === 'admin') {
      totals.adminAmount += empTotalAmount;
    } else {
      totals.hourlyAmount += empTotalAmount;
    }
  }

  // Round final totals
  totals.totalHours = round2(totals.totalHours);
  totals.totalRegular = round2(totals.totalRegular);
  totals.totalOT = round2(totals.totalOT);
  totals.totalAmount = round2(totals.totalAmount);
  totals.adminAmount = round2(totals.adminAmount || 0);
  totals.hourlyAmount = round2(totals.hourlyAmount || 0);

  console.log(`[generateWeekly] Week ${weekStart}: ${files.length} employee files generated`);
  console.log(`[generateWeekly] Totals: ${totals.totalHours}hrs (${totals.totalRegular} reg + ${totals.totalOT} OT) = $${totals.totalAmount}`);

  return { files, totals, outputDir };
}

// Helpers
function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMdy(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = String(date.getFullYear()).slice(-2);
  return `${m}/${d}/${y}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function addLogoImage(workbook) {
  try {
    let buffer = null;
    for (const p of LOGO_PATHS) {
      if (fs.existsSync(p)) {
        buffer = fs.readFileSync(p);
        break;
      }
    }
    if (!buffer) {
      console.warn('[export] logo file not found');
      return null;
    }
    return workbook.addImage({ buffer, extension: "png" });
  } catch (e) {
    console.warn('[export] failed to load logo', e?.message || e);
    return null;
  }
}

function addLogoToSheet(ws, logoId, col = 5.6) {
  try {
    if (logoId === null || logoId === undefined) return;
    ws.addImage(logoId, {
      tl: { col, row: 0 },
      ext: { width: 90, height: 28 }
    });
    const row1 = ws.getRow(1);
    row1.height = Math.max(row1.height || 15, 24);
  } catch (e) {
    console.warn('[export] failed to place logo', e?.message || e);
  }
}

function formatSheet(ws) {
  try { ws.views = [{ state: 'frozen', ySplit: 1 }]; } catch (e) {}
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = Object.assign({}, cell.font, { bold: true });
    if (!cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = Object.assign({}, cell.alignment, { vertical: 'middle', horizontal: 'center' });
    cell.border = Object.assign({}, cell.border, { bottom: { style: 'thin' } });
  });

  const colMax = [];
  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      let s = '';
      if (val == null) s = '';
      else if (typeof val === 'object' && val.text) s = String(val.text);
      else s = String(val);
      colMax[colNumber] = Math.max(colMax[colNumber] || 0, s.length);
      if (rowNumber > 1) {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
      if (typeof cell.value === 'number') cell.alignment = { horizontal: 'right' };
    });
  });
  ws.columns.forEach((col, idx) => {
    const max = colMax[idx+1] || 10;
    col.width = Math.min(50, Math.max(12, Math.ceil(max + 2)));
  });
}

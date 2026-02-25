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
import { weekDates, weekStartYMD, ymdToDate } from "../time.js";

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
  // Normalize week start to payroll boundary and compute range
  const normalizedWeekStart = weekStartYMD(ymdToDate(weekStart));
  const { ordered } = weekDates(normalizedWeekStart);
  const weekStartYmd = ordered[0].ymd;
  const weekEnd = ordered[6].ymd;

  // Create output directory (use /tmp in production for App Engine)
  const baseDir = process.env.NODE_ENV === 'production' ? '/tmp/exports' : './exports';
  const monthDir = weekStartYmd.slice(0, 7);
  const outputDir = path.resolve(`${baseDir}/${monthDir}/${weekStartYmd}`);
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
  `).all(weekStartYmd, weekEnd);

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
    workbook.calcProperties.fullCalcOnLoad = true;
    const logoId = addLogoImage(workbook);
    const ws = workbook.addWorksheet("Sheet1");
    const weekComment = getWeekComment(db, empId, weekStartYmd);
    // Jason Green.xls-style header
    ws.columns = [
      { width: 8 },  // Date
      { width: 18 }, // Client Name
      { width: 11 }, // Time Start
      { width: 6 },  // Lunch
      { width: 11 }, // Time Out
      { width: 8 },  // Hours Per Job
      { width: 16 }, // Notes (wrapped)
      { width: 2 },  // spacer
      { width: 18 }, // Client
      { width: 7 },  // Hours
      { width: 8 },  // Rate
      { width: 10 }, // Total
    ];
    // Employee name + date range title row
    const weekRangeLabel = `${formatMdy(ymdToDate(weekStartYmd))} - ${formatMdy(ymdToDate(weekEnd))}`;
    const titleRow = ws.addRow([`${emp.name}  —  ${weekRangeLabel}`]);
    titleRow.font = { bold: true, size: 14 };
    ws.mergeCells(1, 1, 1, 7);
    titleRow.getCell(9).value = emp.name;
    titleRow.getCell(9).font = { bold: true, size: 12 };

    const headerRow = ws.addRow(["Date", "Client Name", "Time Start", "Lunch", "Time Out", "Hours Per Job", "Notes", "", "Client", "Hours", "Rate", "Total"]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell, colNum) => {
      if ([1,2,3,4,5,6,7,9,10,11,12].includes(colNum)) {
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

    // Apply lunch deduction for net hours before OT split
    const adjustedEntries = applyLunchNetHours(enrichedEntries);
    const processedEntries = splitEntriesWithOT(adjustedEntries.map(e => ({ ...e })), category);

    // Calculate totals for this employee
    let empTotalHours = 0;
    let empRegularHours = 0;
    let empOTHours = 0;
    let empTotalAmount = 0;

    // Prepare entries grouped by date for left panel
    const entriesByDate = new Map();
    for (const entry of adjustedEntries) {
      const key = entry.work_date;
      if (!entriesByDate.has(key)) entriesByDate.set(key, []);
      entriesByDate.get(key).push(entry);
    }
    const sortedDates = [...entriesByDate.keys()].sort();

    const summaryMap = new Map();

    for (const date of sortedDates) {
      const dayEntries = entriesByDate.get(date);
      const dayObj = new Date(date + "T12:00:00");
      const rawDay = dayObj.toLocaleDateString("en-US", { weekday: "short" });
      const dayName = rawDay === "Thu" ? "Thurs" : (rawDay === "Tue" ? "Tues" : rawDay);
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
      const orderedEntries = [...dayEntries].sort((a, b) => {
        const aStart = parseTimeToHours(a.start_time);
        const bStart = parseTimeToHours(b.start_time);
        if (aStart != null && bStart != null) return aStart - bStart;
        if (aStart != null) return -1;
        if (bStart != null) return 1;
        return 0;
      });
      const lunchEntry = orderedEntries.find(isLunchEntry);
      const lunchHours = lunchEntry ? Number((lunchEntry.raw_hours ?? lunchEntry.hours ?? 0)) : "";
      const lunchStart = lunchEntry ? parseTimeToHours(lunchEntry.start_time) : null;
      const lunchEnd = lunchEntry ? parseTimeToHours(lunchEntry.end_time) : null;
      const workEntries = orderedEntries.filter(e => !isLunchEntry(e));
      let lunchApplied = false;
      for (const entry of workEntries) {
        const hours = Number(entry.hours);
        const rate = entry.rate;

        let type = entry.type || "Regular";
        if (entry.holidayName || entry.notes?.toLowerCase().includes("holiday")) type = "Holiday";
        if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";

        const clientName = type === "PTO" ? "PTO" : (type === "Holiday" ? "Holiday Pay" : entry.customer_name);
        const dateLabel = idx === 0 ? `${dayName}-${dayNum}` : "";

        const explicitStart = parseTimeToHours(entry.start_time);
        const explicitEnd = parseTimeToHours(entry.end_time);
        const hasTimes = explicitStart != null && explicitEnd != null;
        const timeStart = hasTimes ? explicitStart : null;
        const timeOut = hasTimes ? explicitEnd : null;
        const spansLunch = hasTimes && (lunchStart != null && lunchEnd != null && timeStart <= lunchStart && timeOut >= lunchEnd);
        const afterLunch = hasTimes && (lunchStart != null && timeStart >= lunchStart);
        const applyLunch = hasTimes && (!lunchApplied && lunchHours !== "" && (spansLunch || afterLunch || (lunchStart == null && timeStart >= 12) || idx === workEntries.length - 1));
        const rowLunch = applyLunch ? lunchHours : "";
        const timeStartExcel = hasTimes ? (timeStart / 24) : "";
        const lunchExcel = hasTimes ? (rowLunch === "" ? "" : (rowLunch / 24)) : (rowLunch === "" ? "" : Number(rowLunch));
        const timeOutExcel = hasTimes ? (timeOut / 24) : "";

        const row = ws.addRow([dateLabel, clientName, timeStartExcel, lunchExcel, timeOutExcel, "", entry.notes || "", "", "", "", "", ""]);
        if (hasTimes) {
          row.getCell(6).value = { formula: `(E${row.number}-C${row.number}-N(D${row.number}))*24` };
        } else {
          row.getCell(6).value = Number(hours);
        }
        if (hasTimes) currentTime = timeOut;
        idx += 1;
        if (applyLunch) lunchApplied = true;

        // Day subtotal row (after last work entry for this day)
        if (idx === workEntries.length) {
          const daySubRow = ws.addRow(["", "", "", "", "", "", "", "", "", "", "", ""]);
          daySubRow.getCell(1).value = dayNum;
          daySubRow.getCell(1).font = { bold: true };
          daySubRow.getCell(6).value = { formula: `SUM(F${ws.rowCount - workEntries.length}:F${ws.rowCount - 1})` };
          daySubRow.getCell(6).font = { bold: true };
          daySubRow.getCell(6).border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
        }

        const total = round2(hours * rate);

        const summaryName = clientName === "PTO" ? "PTO " : clientName;
        const key = summaryName.toLowerCase();
        if (!summaryMap.has(key)) summaryMap.set(key, { name: clientName, hours: 0, total: 0, rate });
        const agg = summaryMap.get(key);
        agg.hours += hours;
        agg.total += total;
        agg.rate = rate;
        agg.name = summaryName;

      }
    }

    // Compute OT and totals using processed entries (net hours)
    for (const entry of processedEntries) {
      if (isLunchEntry(entry)) continue;
      const hours = Number(entry.hours || 0);
      if (!Number.isFinite(hours)) continue;
      let type = entry.type || "Regular";
      if (entry.holidayName || entry.notes?.toLowerCase().includes("holiday")) type = "Holiday";
      if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";
      const otMultiplier = type === "OT" ? 1.5 : 1;
      const total = round2(hours * entry.rate * otMultiplier);
      empTotalHours += hours;
      if (type === "OT") empOTHours += hours;
      else empRegularHours += hours;
      empTotalAmount += total;
    }

    // Add 1 spacer row before totals for clean separation
    ws.addRow(["", "", "", "", "", "", "", "", "", "", "", ""]);

    const totalRowIndex = ws.rowCount + 1;
    const totalRow = ["", "", "", "", "Total:", { formula: `SUM(F3:F${totalRowIndex - 1})` }, "", "", "", "", "", ""];
    const totalRowObj = ws.addRow(totalRow);
    totalRowObj.font = { bold: true };
    totalRowObj.getCell(5).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    totalRowObj.getCell(6).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    if (weekComment) {
      totalRowObj.getCell(7).value = "Comment:";
      totalRowObj.getCell(8).value = weekComment;
    }

    // Right panel summary (client totals)
    // Dynamic row count: place TOTAL row right after last summary entry + 1 blank
    const preferredOrder = ["Hall", "Howard", "Lucas", "Richer", "", "PTO ", "Holiday Pay"];
    const rateSet = new Set([...summaryMap.values()].map(s => s.rate).filter(r => r !== "" && r != null));
    const singleRate = rateSet.size === 1 ? [...rateSet][0] : "";
    const summaryRows = [];
    const used = new Set();
    for (const name of preferredOrder) {
      if (!name) {
        summaryRows.push({ name: "", hours: "", total: 0, rate: "" });
        continue;
      }
      const key = name.toLowerCase();
      if (summaryMap.has(key)) {
        summaryRows.push(summaryMap.get(key));
        used.add(key);
      }
    }
    const remaining = [...summaryMap.values()].filter(s => !used.has(s.name.toLowerCase()));
    remaining.sort((a, b) => a.name.localeCompare(b.name));
    summaryRows.push(...remaining);

    // Compute dynamic summary total row: max of (left panel total + 2) or (summary entries + header + 2)
    const summaryEntryCount = summaryRows.length;
    const minSummaryTotalRow = 3 + summaryEntryCount + 1; // header=2, data starts 3, +1 for spacing
    const summaryTotalRow = Math.max(minSummaryTotalRow, totalRowIndex + 1);

    let rIdx = 3;
    for (const s of summaryRows) {
      if (rIdx >= summaryTotalRow) break;
      const row = ws.getRow(rIdx);
      row.getCell(9).value = s.name || "";
      row.getCell(10).value = { formula: `IF(I${rIdx}="","",SUMIF($B$3:$B$${totalRowIndex - 1},TRIM(I${rIdx}),$F$3:$F$${totalRowIndex - 1}))` };
      row.getCell(11).value = s.name ? s.rate : "";
      row.getCell(12).value = { formula: `IF(OR(J${rIdx}="",K${rIdx}=""),"",J${rIdx}*K${rIdx})` };
      // Add borders to right panel cells
      for (const c of [9, 10, 11, 12]) {
        row.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
      rIdx++;
    }
    // Fill remaining rows up to total with empty bordered cells
    while (rIdx < summaryTotalRow) {
      const row = ws.getRow(rIdx);
      row.getCell(9).value = "";
      row.getCell(10).value = { formula: `IF(I${rIdx}="","",SUMIF($B$3:$B$${totalRowIndex - 1},TRIM(I${rIdx}),$F$3:$F$${totalRowIndex - 1}))` };
      row.getCell(11).value = "";
      row.getCell(12).value = { formula: `IF(OR(J${rIdx}="",K${rIdx}=""),"",J${rIdx}*K${rIdx})` };
      for (const c of [9, 10, 11, 12]) {
        row.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
      rIdx++;
    }
    const totalSummaryRow = ws.getRow(summaryTotalRow);
    totalSummaryRow.getCell(9).value = "TOTAL:";
    totalSummaryRow.getCell(9).font = { bold: true };
    totalSummaryRow.getCell(10).value = { formula: `SUM(J3:J${summaryTotalRow - 1})` };
    totalSummaryRow.getCell(10).font = { bold: true };
    totalSummaryRow.getCell(11).value = singleRate;
    totalSummaryRow.getCell(12).value = { formula: `IF(OR(J${summaryTotalRow}="",K${summaryTotalRow}=""),"",J${summaryTotalRow}*K${summaryTotalRow})` };
    totalSummaryRow.getCell(12).font = { bold: true };
    // Double bottom border on summary total row
    for (const c of [9, 10, 11, 12]) {
      totalSummaryRow.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'double' }, right: { style: 'thin' } };
    }

    ws.getColumn(3).numFmt = 'h:mm AM/PM';
    ws.getColumn(4).numFmt = 'h:mm';
    ws.getColumn(5).numFmt = 'h:mm AM/PM';
    ws.getColumn(6).numFmt = '0.00';
    ws.getColumn(11).numFmt = '"$"#,##0.00';
    ws.getColumn(12).numFmt = '"$"#,##0.00';
    try { formatSheet(ws); } catch (e) {}
    // Override frozen pane to freeze below name + header rows
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    // Print setup: fit on single page, landscape
    ws.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      paperSize: 1,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    };

    // Save file
    const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${safeName}_${weekStartYmd}.xlsx`;
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
    const weekRange = `${formatMdy(ymdToDate(weekStartYmd))} - ${formatMdy(ymdToDate(weekEnd))}`;
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

function parseTimeToHours(t) {
  if (!t || typeof t !== 'string') return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h + (m / 60);
}

function isLunchEntry(entry) {
  const name = String(entry.customer_name || '').toLowerCase();
  const notes = String(entry.notes || '').toLowerCase();
  return name === 'lunch' || notes.includes('lunch');
}

function applyLunchNetHours(entries) {
  for (const e of entries) {
    const raw = Number(e.hours || 0);
    e.raw_hours = raw;
    if (isLunchEntry(e)) e.hours = 0;
  }
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.work_date)) byDate.set(e.work_date, []);
    byDate.get(e.work_date).push(e);
  }
  for (const dayEntries of byDate.values()) {
    const lunchEntry = dayEntries.find(isLunchEntry);
    const lunchHours = lunchEntry ? Number(lunchEntry.raw_hours || 0) : 0;
    const lunchStart = lunchEntry ? parseTimeToHours(lunchEntry.start_time) : null;
    const lunchEnd = lunchEntry ? parseTimeToHours(lunchEntry.end_time) : null;
    const workEntries = dayEntries.filter(e => !isLunchEntry(e));
    const ordered = [...workEntries].sort((a, b) => {
      const aStart = parseTimeToHours(a.start_time);
      const bStart = parseTimeToHours(b.start_time);
      if (aStart != null && bStart != null) return aStart - bStart;
      if (aStart != null) return -1;
      if (bStart != null) return 1;
      return 0;
    });
    let lunchApplied = false;
    if (lunchHours > 0 && lunchStart == null && lunchEnd == null && ordered.length) {
      const first = ordered[0];
      const base = Number(first.raw_hours || 0);
      first.hours = Math.max(0, round2(base - lunchHours));
      lunchApplied = true;
    }
    for (let i = 0; i < ordered.length; i += 1) {
      const entry = ordered[i];
      let netHours = Number(entry.raw_hours || 0);
      const timeStart = parseTimeToHours(entry.start_time);
      const timeOut = parseTimeToHours(entry.end_time);
      const spansLunch = (lunchStart != null && lunchEnd != null && timeStart != null && timeOut != null && timeStart <= lunchStart && timeOut >= lunchEnd);
      const afterLunch = (lunchStart != null && timeStart != null && timeStart >= lunchStart);
      const applyLunch = (!lunchApplied && lunchHours > 0 && (spansLunch || afterLunch || (lunchStart == null && timeStart != null && timeStart >= 12) || i === ordered.length - 1));
      if (applyLunch) {
        netHours = Math.max(0, netHours - lunchHours);
        lunchApplied = true;
      }
      entry.hours = netHours;
    }
  }
  return entries;
}

function getWeekComment(db, employeeId, weekStart) {
  try {
    const row = db.prepare(`
      SELECT comment FROM weekly_comments
      WHERE employee_id = ? AND week_start = ?
    `).get(employeeId, weekStart);
    return row?.comment || '';
  } catch {
    return '';
  }
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
      if (rowNumber > 1 && colNumber !== 8) {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
      if (typeof cell.value === 'number') cell.alignment = { horizontal: 'right' };
    });
  });
  // Auto-fit columns based on content, but respect existing widths as minimums
  // Notes column (7) gets special treatment: smaller + wrapped
  const NOTES_COL = 7;
  const SPACER_COL = 8;
  ws.columns.forEach((col, idx) => {
    const colNum = idx + 1;
    if (colNum === SPACER_COL) return; // skip spacer
    const contentMax = colMax[colNum] || 0;
    const existingWidth = col.width || 8;
    if (colNum === NOTES_COL) {
      // Notes: cap at 16, enable wrapping
      col.width = Math.min(16, Math.max(8, Math.ceil(contentMax + 1)));
    } else {
      // Auto-fit: use content length + 1, but don't go below 6 or above 22
      const autoWidth = Math.ceil(contentMax + 1);
      col.width = Math.min(22, Math.max(6, autoWidth, existingWidth));
    }
  });
  // Enable text wrapping on Notes column
  ws.getColumn(NOTES_COL).alignment = { wrapText: true, vertical: 'top' };
}

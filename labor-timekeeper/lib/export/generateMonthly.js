/**
 * Monthly Payroll Breakdown XLSX Generator
 * 
 * Creates workbook with:
 *   - One sheet per week ("Week of Jan 5", "Week of Jan 12", etc.)
 *   - Final "Monthly Summary" sheet with totals
 * 
 * Each weekly sheet format:
 *   Customer header row
 *   Date | Employee | Rate | Hours | Total
 *   Subtotal per customer
 * 
 * PRIVACY: Admin employees (Chris J, Chris Z) shown in separate section
 * 
 * Filename: Payroll_Breakdown_<YYYY-MM>.xlsx
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";
import { getBillRate } from "../billing.js";
import { getEmployeeCategory, splitEntriesWithOT, calculatePayWithOT } from "../classification.js";
import { weekStartYMD, ymdToDate, payrollMonthRange, payrollWeeksForMonth } from "../time.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATHS = [
  path.resolve(__dirname, "..", "..", "public", "icon-192.png"),
  path.resolve(process.cwd(), "public", "icon-192.png")
];

/**
 * Get the payroll week start (Wednesday by default) that contains a given date
 */
function getPayrollWeekStart(dateStr) {
  return weekStartYMD(ymdToDate(dateStr));
}

function shiftYmd(ymd, days) {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Format date as YYYY-MM-DD
 */
function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format date for sheet name like "Week of Jan 5"
 */
function formatWeekName(sundayStr) {
  const [y, m, d] = sundayStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Week of ${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Return an array of payroll week-start strings (YYYY-MM-DD) for the payroll month.
 */
function getWeekStartsForMonth(month) {
  const weeks = payrollWeeksForMonth(month);
  if (weeks.length) return weeks;
  // Fallback to calendar month if payroll calendar isn't configured
  const monthStartStr = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const start = ymdToDate(monthStartStr);
  const end = ymdToDate(nextMonth);
  const firstWeekStart = weekStartYMD(ymdToDate(monthStartStr));
  const weeksFallback = [];
  for (let d = ymdToDate(firstWeekStart); d < new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000); d.setDate(d.getDate() + 7)) {
    const weekStart = formatYmd(d);
    const weekEnd = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd >= start && weekEnd < end) {
      weeksFallback.push(weekStart);
    }
  }
  return weeksFallback;
}

/**
 * Generate monthly payroll breakdown XLSX with weekly sheets
 */
export async function generateMonthlyExport({ db, month, billingRates }) {
  // Build rate lookup function: if billingRates provided, use those; otherwise use DB rates
  const _empNameToRate = billingRates ? new Map(Object.entries(billingRates).map(([k,v]) => [k.toLowerCase(), v])) : null;
  const _empIdNameCache = new Map();
  const getRate = (empId, custId, empName) => {
    if (_empNameToRate && empName) {
      const r = _empNameToRate.get(empName.toLowerCase());
      if (r != null) return Number(r);
    }
    if (_empNameToRate && empId) {
      // Lookup name from cache or DB
      if (!_empIdNameCache.has(empId)) {
        const row = db.prepare("SELECT name FROM employees WHERE id = ?").get(empId);
        _empIdNameCache.set(empId, row?.name || '');
      }
      const name = _empIdNameCache.get(empId);
      const r = _empNameToRate.get((name || '').toLowerCase());
      if (r != null) return Number(r);
    }
    return getBillRate(db, empId, custId);
  };
  const isBillingReport = !!billingRates;

  // Calculate date range for the month
  const payrollRange = payrollMonthRange(month);
  const monthStart = payrollRange?.start || `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = payrollRange?.end
    ? shiftYmd(payrollRange.end, 1)
    : (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`);

  // Create output directory
  const baseDir = process.env.NODE_ENV === 'production' ? '/tmp/exports' : './exports';
  const outputDir = path.resolve(`${baseDir}/${month}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Build payroll week list for the month (week end date determines month)
  const sortedWeeks = getWeekStartsForMonth(month);
  const weekSet = new Set(sortedWeeks);
  const rangeStart = sortedWeeks[0] || monthStart;
  const rangeEnd = (() => {
    const last = sortedWeeks[sortedWeeks.length - 1];
    if (!last) return nextMonth;
    const d = ymdToDate(last);
    d.setDate(d.getDate() + 6);
    return formatYmd(d);
  })();

  // Query all approved entries in the payroll month range
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.id as emp_id, c.name as customer_name, c.id as cust_id
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'APPROVED'
    ORDER BY te.work_date ASC, te.created_at ASC
  `).all(rangeStart, rangeEnd);
  const adjustedEntries = applyLunchNetHours(entries);

  // Normalize DB rows to the shape expected by sheet builders and group by week (Sunday start)
  const byWeek = new Map();
  // Also build a monthly aggregation by customer -> employee
  const monthlyAgg = new Map();

  for (const r of entries) {
    const row = {
      date: r.work_date,
      empName: r.employee_name,
      empId: r.emp_id,
      custName: r.customer_name,
      custId: r.cust_id,
      hours: Number(r.hours),
      notes: r.notes || '',
      category: getEmployeeCategory(r.employee_name)
    };

    const weekStart = getPayrollWeekStart(row.date);
    if (!weekSet.has(weekStart)) continue;
    if (String(row.custName || '').toLowerCase() === 'lunch') continue;
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, []);
    byWeek.get(weekStart).push(row);

    // monthly aggregation: customer -> employee -> { empId, name, hours, category }
    if (!monthlyAgg.has(row.custId)) monthlyAgg.set(row.custId, { name: row.custName, employees: new Map() });
    const custBucket = monthlyAgg.get(row.custId);
    if (!custBucket.employees.has(row.empId)) custBucket.employees.set(row.empId, { empId: row.empId, name: row.empName, hours: 0, category: row.category });
    const empBucket = custBucket.employees.get(row.empId);
    empBucket.hours += row.hours;
  }

  // sortedWeeks already computed above

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const logoId = addLogoImage(workbook);

  // Track weekly totals for summary sheet formulas
  const weeklyTotals = [];

  // Create Monthly Breakdown sheet first (promote it to front)
  const monthlySheet = workbook.addWorksheet('Monthly Breakdown');
  addLogoToSheet(monthlySheet, logoId, 9.2);
  setupWeeklyColumns(monthlySheet);

  const weeksDesc = [...sortedWeeks].reverse();

  // Group entries by employee
  const byEmployee = new Map();
  for (const r of adjustedEntries) {
    if (!byEmployee.has(r.emp_id)) byEmployee.set(r.emp_id, { id: r.emp_id, name: r.employee_name, entries: [] });
    byEmployee.get(r.emp_id).entries.push(r);
  }

  const getEmpWeekEntries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.id as emp_id, c.name as customer_name, c.id as cust_id
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ?
      AND te.work_date >= ?
      AND te.work_date <= ?
      AND te.status = 'APPROVED'
    ORDER BY te.work_date ASC, te.created_at ASC
  `);

  // ── STEP 1: Build consolidated employee sheets FIRST ──
  // This populates empPositions with correct sheet names + row ranges
  // so weekly breakdown sheets can reference them accurately.
  // empPositions: empId -> Map<weekStart, {sheetName, summaryStart, summaryEnd, summaryTotal}>
  const empPositions = new Map();
  const weeksForTabs = [...sortedWeeks].reverse();

  for (const [empId, empBucket] of byEmployee) {
    let empSheetName = (empBucket.name || '').slice(0, 31);
    const existingNames = new Set(workbook.worksheets.map(s => s.name));
    let sfx = 1;
    while (existingNames.has(empSheetName)) {
      empSheetName = `${(empBucket.name || '').slice(0, 28)}_${sfx}`.slice(0, 31);
      sfx++;
    }
    const ws = workbook.addWorksheet(empSheetName);
    const weekPositions = new Map();
    let isFirst = true;
    for (const wkStart of weeksForTabs) {
      const wkEndDate = ymdToDate(wkStart);
      wkEndDate.setDate(wkEndDate.getDate() + 6);
      const wkEnd = formatYmd(wkEndDate);
      const weekEntries = getEmpWeekEntries.all(empId, wkStart, wkEnd);
      if (!weekEntries || weekEntries.length === 0) continue;
      if (!isFirst) {
        for (let g = 0; g < 4; g++) ws.addRow([]);
      }
      const rowOffset = ws.rowCount;
      const comment = getWeekComment(db, empId, wkStart);
      const positions = buildTimesheetSheet(db, ws, weekEntries, logoId, {
        comment,
        rowOffset,
        empName: empBucket.name,
        weekStart: wkStart,
        weekEnd: wkEnd,
        isFirst
      });
      weekPositions.set(wkStart, { ...positions, sheetName: empSheetName });
      isFirst = false;
    }
    ws.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 1,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    };
    empPositions.set(empId, weekPositions);
  }

  // ── STEP 2: Build perWeekEmpSheetMap from empPositions ──
  // Maps: weekStart -> empId -> sheetName (the consolidated sheet)
  const perWeekEmpSheetMap = new Map();
  // Also: weekStart -> empId -> { sheetName, summaryStart, summaryEnd, summaryTotal }
  const perWeekEmpPositions = new Map();
  for (const [empId, weekMap] of empPositions) {
    for (const [wkStart, pos] of weekMap) {
      if (!perWeekEmpSheetMap.has(wkStart)) perWeekEmpSheetMap.set(wkStart, new Map());
      perWeekEmpSheetMap.get(wkStart).set(empId, pos.sheetName);
      if (!perWeekEmpPositions.has(wkStart)) perWeekEmpPositions.set(wkStart, new Map());
      perWeekEmpPositions.get(wkStart).set(empId, pos);
    }
  }

  // ── STEP 3: Build weekly breakdown sheets ──
  // Now formulas can correctly reference consolidated employee sheet names + rows
  for (const weekSunday of weeksDesc) {
    const weekEntries = byWeek.get(weekSunday);
    const sheetName = formatWeekName(weekSunday);
    const ws = workbook.addWorksheet(sheetName);
    addLogoToSheet(ws, logoId, 7.2);
    setupWeeklyColumns(ws);
    const weekEmpMap = perWeekEmpSheetMap.get(weekSunday) || new Map();
    const weekPosMap = perWeekEmpPositions.get(weekSunday) || new Map();
    const result = buildWeeklySheet(db, ws, weekEntries, weekEmpMap, getRate, weekPosMap);
    weeklyTotals.push({
      sheetName,
      weekTotalRow: result.weekTotalRow,
      hourlyTotal: result.hourlyTotal,
      adminTotal: result.adminTotal,
      weekTotal: result.weekTotal,
      otPremiumTotal: result.otPremiumTotal,
      otPremiumSubtotalRowNum: result.otPremiumSubtotalRowNum,
      cellPositions: result.cellPositions
    });
  }

  // The `monthlySheet` was created earlier and will be populated here

  // Header rows (left: hourly A-E, spacer F, right: admin G-K)
  let rowIdx = 0;
  rowIdx++;
  const header = monthlySheet.addRow(["", "", "", "", "", "", "", "", "", "", ""]);
  // Column headers
  rowIdx++;
  const headerRow = monthlySheet.addRow(["", "Employee", "$/hr", "Hr", "Total", "", "", "Admin", "$/hr", "Hr", "Total"]);
  headerRow.getCell(2).font = { bold: true };
  headerRow.getCell(3).font = { bold: true };
  headerRow.getCell(4).font = { bold: true };
  headerRow.getCell(5).font = { bold: true };
  headerRow.getCell(8).font = { bold: true };
  headerRow.getCell(9).font = { bold: true };
  headerRow.getCell(10).font = { bold: true };
  headerRow.eachCell((cell, colNum) => {
    if ([2,3,4,5,8,9,10,11].includes(colNum)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  });

  // Iterate customers and write aggregated employee rows into left (hourly) or right (admin)
  const customers = [...monthlyAgg.entries()].map(([custId, data]) => ({ custId, name: data.name, employees: data.employees }));
  customers.sort((a,b) => a.name.localeCompare(b.name));

  let monthlyHourlyTotal = 0;
  let monthlyAdminTotal = 0;
  let hourlyStartRow = null;
  let hourlyEndRow = null;
  let adminStartRow = null;
  let adminEndRow = null;

  for (const cust of customers) {
    // Customer header: left and right
    const ch = monthlySheet.addRow([cust.name]);
    ch.font = { bold: true };
    ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    monthlySheet.mergeCells(ch.number, 1, ch.number, 5);
    monthlySheet.mergeCells(ch.number, 7, ch.number, 11);

    const emps = [...cust.employees.values()].sort((a,b) => a.name.localeCompare(b.name));
    for (const e of emps) {
      const rate = getRate(e.empId, cust.custId, e.name);
      const amount = round2(e.hours * rate);
      // Build SUM formula across weekly sheets for this cust/emp combo
      const posKey = `${cust.custId}::${e.empId}`;
      const weekRefs = weeklyTotals
        .filter(w => w.cellPositions && w.cellPositions.has(posKey))
        .map(w => {
          const pos = w.cellPositions.get(posKey);
          return `'${w.sheetName}'!${pos.col}${pos.row}`;
        });
      const sumFormula = weekRefs.length > 0 ? weekRefs.join('+') : null;

      if ((e.category || '').toLowerCase() === 'admin') {
        // place in admin columns (G=7, H=8, I=9, J=10, K=11)
        const r = monthlySheet.addRow(['', '', '', '', '', '', '', e.name, rate, round2(e.hours), ""]);
        // Live formula: SUMIF per-customer hours from each weekly employee timesheet
        // Employee timesheets have: Col I = client name, Col J = hours (SUMIF per client)
        // We use SUMIF to pull only THIS customer's hours, not the employee total (J21).
        const custNameEscaped = (cust.name || '').replace(/"/g, '""');
        const adminEmpRefs = [];
        for (const wkStart of sortedWeeks) {
          const weekMap = perWeekEmpSheetMap.get(wkStart);
          const posMap = perWeekEmpPositions.get(wkStart);
          if (weekMap && weekMap.has(e.empId)) {
            const sName = weekMap.get(e.empId);
            const pos = posMap ? posMap.get(e.empId) : null;
            const sStart = pos ? pos.summaryStart : 3;
            const sEnd = pos ? pos.summaryEnd : 21;
            adminEmpRefs.push(`SUMIF('${sName}'!$I$${sStart}:$I$${sEnd},"${custNameEscaped}",'${sName}'!$J$${sStart}:$J$${sEnd})`);
          }
        }
        if (adminEmpRefs.length > 0) {
          r.getCell(10).value = { formula: adminEmpRefs.join('+') };
        }
        r.getCell(11).value = { formula: `I${r.number}*J${r.number}` };
        monthlyAdminTotal += amount;
        if (!adminStartRow) adminStartRow = r.number;
        adminEndRow = r.number;
      } else {
        // place in hourly columns (A=1, B=2, C=3, D=4, E=5)
        const r = monthlySheet.addRow(['', e.name, rate, round2(e.hours), ""]);
        // Live formula: SUM hours across weekly sheets
        if (sumFormula) {
          r.getCell(4).value = { formula: sumFormula };
        }
        r.getCell(5).value = { formula: `C${r.number}*D${r.number}` };
        monthlyHourlyTotal += amount;
        if (!hourlyStartRow) hourlyStartRow = r.number;
        hourlyEndRow = r.number;
      }
    }

    // blank row between customers
    monthlySheet.addRow([]);
  }

  // Totals
  const hourlySubtotalRow = monthlySheet.addRow(['Subtotal (Hourly)', '', '', 0, 0]);
  hourlySubtotalRow.getCell(4).value = hourlyStartRow ? { formula: `SUM(D${hourlyStartRow}:D${hourlyEndRow})` } : 0;
  hourlySubtotalRow.getCell(5).value = hourlyStartRow ? { formula: `SUM(E${hourlyStartRow}:E${hourlyEndRow})` } : 0;
  hourlySubtotalRow.font = { bold: true };
  const adminSubtotalRow = monthlySheet.addRow(['Subtotal (Admin)', '', '', '', '', '', '', '', '', 0, 0]);
  adminSubtotalRow.getCell(10).value = adminStartRow ? { formula: `SUM(J${adminStartRow}:J${adminEndRow})` } : 0;
  adminSubtotalRow.getCell(11).value = adminStartRow ? { formula: `SUM(K${adminStartRow}:K${adminEndRow})` } : 0;
  adminSubtotalRow.font = { bold: true };

  // OT Premium row: sum OT from each weekly sheet
  const otWeekRefs = weeklyTotals
    .filter(w => w.otPremiumSubtotalRowNum)
    .map(w => `'${w.sheetName}'!E${w.otPremiumSubtotalRowNum}`);
  const otPremiumRow = monthlySheet.addRow(['OT Premium (0.5x)', '', '', '', 0]);
  if (otWeekRefs.length > 0) {
    otPremiumRow.getCell(5).value = { formula: otWeekRefs.join('+') };
  }
  otPremiumRow.font = { bold: true };
  otPremiumRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };

  // Grand total (Hourly + OT Premium + Admin)
  const monthlyOtTotal = weeklyTotals.reduce((s, w) => s + Number(w.otPremiumTotal || 0), 0);
  const monthlyGrandTotal = round2(monthlyHourlyTotal + monthlyOtTotal + monthlyAdminTotal);
  const grandRow = monthlySheet.addRow(['GRAND TOTAL', '', '', '', '', '', '', '', '', '', monthlyGrandTotal]);
  grandRow.getCell(11).value = { formula: `E${hourlySubtotalRow.number}+E${otPremiumRow.number}+K${adminSubtotalRow.number}` };
  grandRow.font = { bold: true, size: 12 };
  grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  grandRow.getCell(11).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  // Ensure numeric formatting
  monthlySheet.getColumn(5).numFmt = '"$"#,##0.00';
  monthlySheet.getColumn(11).numFmt = '"$"#,##0.00';
  try { formatSheet(monthlySheet); } catch (e) {}

  // NOTE: Employee sheets already built in STEP 1 above.
  // (The old duplicate block was removed – employee sheets are created before weekly sheets
  //  so that cross-sheet formula references use the correct consolidated sheet names + row ranges.)

  // Save file (if target exists/locked, write to a timestamped filename)
  const prefix = isBillingReport ? 'Billing_Report' : 'Payroll_Breakdown';
  let filename = `${prefix}_${month}.xlsx`;
  let filepath = path.join(outputDir, filename);
  if (fs.existsSync(filepath)) {
    filename = `Payroll_Breakdown_${month}_${Date.now()}.xlsx`;
    filepath = path.join(outputDir, filename);
  }
  await workbook.xlsx.writeFile(filepath);

  const totals = weeklyTotals.reduce((acc, w) => {
    acc.hourlyTotal += Number(w.hourlyTotal || 0);
    acc.adminTotal += Number(w.adminTotal || 0);
    acc.grandTotal += Number(w.weekTotal || 0);
    return acc;
  }, { hourlyTotal: 0, adminTotal: 0, grandTotal: 0 });

  const customersCount = new Set(entries.map(r => r.customer_name)).size;
  const employeesCount = new Set(entries.map(r => r.employee_name)).size;

  return { filepath, filename, outputDir, totals: { customers: customersCount, employees: employeesCount, hourlyTotal: round2(totals.hourlyTotal), adminTotal: round2(totals.adminTotal), grandTotal: round2(totals.grandTotal) } };
}

/* ---- DEAD CODE REMOVED ----
    let sfx = 1;
    while (existingNames.has(empSheetName)) {
      empSheetName = `${(empBucket.name || '').slice(0, 28)}_${sfx}`.slice(0, 31);
      sfx++;
    }
    const ws = workbook.addWorksheet(empSheetName);
    const weekPositions = new Map();
    let isFirst = true;
    for (const wkStart of weeksForTabs) {
      const wkEndDate = ymdToDate(wkStart);
      wkEndDate.setDate(wkEndDate.getDate() + 6);
      const wkEnd = formatYmd(wkEndDate);
      const weekEntries = getEmpWeekEntries.all(empId, wkStart, wkEnd);
      if (!weekEntries || weekEntries.length === 0) continue;
      if (!isFirst) {
        // Add 4 blank separator rows
        for (let g = 0; g < 4; g++) ws.addRow([]);
      }
      const rowOffset = ws.rowCount; // current row count = starting offset
      const comment = getWeekComment(db, empId, wkStart);
      const positions = buildTimesheetSheet(db, ws, weekEntries, logoId, {
        comment,
        rowOffset,
        empName: empBucket.name,
        weekStart: wkStart,
        weekEnd: wkEnd,
        isFirst
      });
      weekPositions.set(wkStart, { ...positions, sheetName: empSheetName });
      isFirst = false;
    }
    // Print setup: fit on single page per week section, landscape
    ws.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0, // auto height (multiple pages OK for stacked weeks)
      paperSize: 1,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    };
    empPositions.set(empId, weekPositions);
    // Update perWeekEmpSheetMap with actual positions for cross-sheet refs
    for (const [wkStart, pos] of weekPositions) {
      const weekMap = perWeekEmpSheetMap.get(wkStart);
      if (weekMap) weekMap.set(empId, empSheetName);
    }
  }

  // Cross-sheet cascade: Weekly sheet hours now reference employee timesheets via SUMPRODUCT formulas
  // WEEK TOTAL = Hourly Subtotal + OT Premium + Admin (all formula-driven)
  // No J21 overwrite needed - weekly hours cells reference employee sheets directly

  // Note: Monthly Summary sheet removed. `Monthly Breakdown` has been populated above.

  // Save file (if target exists/locked, write to a timestamped filename)
  const prefix = isBillingReport ? 'Billing_Report' : 'Payroll_Breakdown';
  let filename = `${prefix}_${month}.xlsx`;
  let filepath = path.join(outputDir, filename);
  if (fs.existsSync(filepath)) {
    // append timestamp to avoid collisions or locked file errors
    filename = `Payroll_Breakdown_${month}_${Date.now()}.xlsx`;
    filepath = path.join(outputDir, filename);
  }
  await workbook.xlsx.writeFile(filepath);

  // Aggregate totals
  const totals = weeklyTotals.reduce((acc, w) => {
    acc.hourlyTotal += Number(w.hourlyTotal || 0);
    acc.adminTotal += Number(w.adminTotal || 0);
    acc.grandTotal += Number(w.weekTotal || 0);
    return acc;
  }, { hourlyTotal: 0, adminTotal: 0, grandTotal: 0 });

  // Counts
  const customersCount = new Set(entries.map(r => r.customer_name)).size;
  const employeesCount = new Set(entries.map(r => r.employee_name)).size;

  return { filepath, filename, outputDir, totals: { customers: customersCount, employees: employeesCount, hourlyTotal: round2(totals.hourlyTotal), adminTotal: round2(totals.adminTotal), grandTotal: round2(totals.grandTotal) } };
}
---- END DEAD CODE REMOVAL ---- */

/**
 * Set up column widths and formats for weekly sheet
 */
function setupWeeklyColumns(ws) {
  // Hourly section: A=Date, B=Employee, C=Rate, D=Hours, E=Total
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 25;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 3;  // Spacer
  // Admin section: G=Date, H=Employee, I=Rate, J=Hours, K=Total
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 20;
  ws.getColumn(9).width = 12;
  ws.getColumn(10).width = 10;
  ws.getColumn(11).width = 14;
  
  // Number formats
  ws.getColumn(3).numFmt = '"$"#,##0.00';
  ws.getColumn(5).numFmt = '"$"#,##0.00';
  ws.getColumn(9).numFmt = '"$"#,##0.00';
  ws.getColumn(11).numFmt = '"$"#,##0.00';
}

/**
 * Build a weekly sheet with entries grouped by customer
 */
function buildWeeklySheet(db, ws, entries = [], empSheetNameMap = new Map(), rateFn = null, empPositionsMap = new Map()) {
  if (!rateFn) rateFn = (empId, custId, empName) => getBillRate(db, empId, custId);
  let hourlyTotal = 0;
  let adminTotal = 0;
  let otPremiumTotal = 0;
  let currentRow = 0;
  let hourlySubtotalRowNum = null;
  let adminSubtotalRowNum = null;
  let otPremiumSubtotalRowNum = null;
  let hourlyDataLastRow = null;
  let adminDataLastRow = null;
  // Track cell positions for cross-sheet references: Map<"custId::empId", {hoursRow, category}>
  const cellPositions = new Map();
  
  // Track per-employee weekly hours for OT calculation
  const employeeWeeklyHours = new Map(); // empId -> { name, totalHours, rate }
  
  // Separate hourly and admin entries
  const hourlyEntries = entries.filter(e => e.category === "hourly");
  const adminEntries = entries.filter(e => e.category === "admin");
  
  // Pre-compute employee weekly totals for OT
  for (const entry of hourlyEntries) {
    if (!employeeWeeklyHours.has(entry.empId)) {
      const rate = rateFn(entry.empId, entry.custId, entry.empName);
      employeeWeeklyHours.set(entry.empId, { name: entry.empName, totalHours: 0, rate });
    }
    employeeWeeklyHours.get(entry.empId).totalHours += entry.hours;
  }
  
  // Group hourly by customer
  const hourlyByCustomer = new Map();
  for (const entry of hourlyEntries) {
    if (!hourlyByCustomer.has(entry.custId)) {
      hourlyByCustomer.set(entry.custId, {
        name: entry.custName,
        entries: []
      });
    }
    hourlyByCustomer.get(entry.custId).entries.push(entry);
  }
  
  // Add header row: Customer grouping with Date | Employee | $/hr | Hr | Total
  currentRow++;
  const headerRow = ws.addRow(["Date", "Employee", "$/hr", "Hr", "Total"]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, colNum) => {
    if (colNum <= 5) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    }
  });
  
  // Add admin header (right side)
  const adminHeaderRow = ws.getRow(1);
  adminHeaderRow.getCell(7).value = "Date";
  adminHeaderRow.getCell(7).font = { bold: true };
  adminHeaderRow.getCell(8).value = "Admin";
  adminHeaderRow.getCell(8).font = { bold: true };
  adminHeaderRow.getCell(9).value = "$/hr";
  adminHeaderRow.getCell(9).font = { bold: true };
  adminHeaderRow.getCell(10).value = "Hr";
  adminHeaderRow.getCell(10).font = { bold: true };
  adminHeaderRow.getCell(11).value = "Total";
  adminHeaderRow.getCell(11).font = { bold: true };
  
  // Sort customers alphabetically
  const sortedCustomers = [...hourlyByCustomer.entries()].sort((a, b) => 
    a[1].name.localeCompare(b[1].name)
  );
  
  // Process hourly entries by customer
  const hourlyTotalCells = [];
  for (const [custId, custData] of sortedCustomers) {
    // Customer header
    currentRow++;
    const custRow = ws.addRow([custData.name]);
    custRow.font = { bold: true };
    custRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
    ws.mergeCells(currentRow, 1, currentRow, 5);
    
    const firstDataRow = currentRow + 1;
    let customerTotal = 0;
    const customerTotalCells = [];
    
    // Consolidate entries by employee (sum hours for same emp+customer)
    const byEmp = new Map();
    for (const entry of custData.entries) {
      if (!byEmp.has(entry.empId)) {
        byEmp.set(entry.empId, { ...entry, hours: 0 });
      }
      byEmp.get(entry.empId).hours += entry.hours;
    }
    const consolidated = [...byEmp.values()].sort((a, b) => a.empName.localeCompare(b.empName));
    
    // Add one row per employee (consolidated hours)
    for (const entry of consolidated) {
      const rate = rateFn(entry.empId, custId, entry.empName);
      const hours = round2(entry.hours);
      const amount = round2(hours * rate);
      
      // Use cross-sheet formula if employee sheet exists
      const empSheet = empSheetNameMap.get(entry.empId);
      const custName = custData.name;
      
      currentRow++;
      const dataRow = ws.addRow(["", entry.empName, rate, hours, ""]);
      // Hours formula: reference employee timesheet column J (which already has SUMIF per client from column I)
      // Use actual row ranges from empPositionsMap for stacked weeks
      if (empSheet) {
        const pos = empPositionsMap.get(entry.empId);
        const sStart = pos ? pos.summaryStart : 3;
        const sEnd = pos ? pos.summaryEnd : 21;
        dataRow.getCell(4).value = { formula: `SUMIF('${empSheet}'!$I$${sStart}:$I$${sEnd},"${custName}",'${empSheet}'!$J$${sStart}:$J$${sEnd})` };
      }
      dataRow.getCell(5).value = { formula: `C${dataRow.number}*D${dataRow.number}` };
      hourlyDataLastRow = dataRow.number;
      // Track position for monthly cross-sheet reference
      cellPositions.set(`${custId}::${entry.empId}`, { row: dataRow.number, col: 'D', category: 'hourly' });
      customerTotalCells.push(`E${dataRow.number}`);
      hourlyTotalCells.push(`E${dataRow.number}`);
      
      customerTotal += amount;
      hourlyTotal += amount;
    }
    
    // Customer subtotal
    const lastDataRow = currentRow;
    currentRow++;
    const subtotalFormula = customerTotalCells.length
      ? `SUM(${customerTotalCells.join(",")})`
      : `0`;
    const subtotalRow = ws.addRow(["", "", "", "", { formula: subtotalFormula }]);
    subtotalRow.font = { bold: true };
    subtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    
    // Blank row
    currentRow++;
    ws.addRow([]);
  }
  
  // Add hourly subtotal
  currentRow++;
  // Build hours cell refs from the same rows
  const hourlyHoursCells = hourlyTotalCells.map(ref => ref.replace(/^E/, 'D'));
  const hourlySubtotalRow = ws.addRow(["Subtotal (Hourly)", "", "", 0, 0]);
  hourlySubtotalRow.getCell(4).value = { formula: hourlyHoursCells.length ? `SUM(${hourlyHoursCells.join(",")})` : `0` };
  hourlySubtotalRow.getCell(5).value = { formula: hourlyTotalCells.length ? `SUM(${hourlyTotalCells.join(",")})` : `0` };
  hourlySubtotalRow.font = { bold: true };
  hourlySubtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  hourlySubtotalRowNum = hourlySubtotalRow.number;
  
  // OT Premium section: rows for ALL hourly employees, formula-driven so edits cascade
  const OT_THRESHOLD = 40;
  const otPremiumCells = [];
  const allHourlyEmps = [...employeeWeeklyHours.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  
  if (allHourlyEmps.length > 0) {
    currentRow++;
    const otHeader = ws.addRow(["Overtime Premium (1.5x)"]);
    otHeader.font = { bold: true };
    otHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
    ws.mergeCells(otHeader.number, 1, otHeader.number, 5);
    
    for (const [empId, empData] of allHourlyEmps) {
      const otPremiumRate = round2(empData.rate * 0.5); // extra 0.5x on top of regular rate
      const empSheet = empSheetNameMap.get(empId);
      
      currentRow++;
      const otRow = ws.addRow(["OT", empData.name, otPremiumRate, 0, ""]);
      // Formula-driven OT hours: MAX(0, employee_total_hours - 40)
      if (empSheet) {
        const pos = empPositionsMap.get(empId);
        const sTotalRow = pos ? pos.summaryTotal : 22;
        otRow.getCell(4).value = { formula: `MAX(0,'${empSheet}'!J${sTotalRow}-${OT_THRESHOLD})` };
      } else {
        const otHours = round2(Math.max(0, empData.totalHours - OT_THRESHOLD));
        otRow.getCell(4).value = otHours;
      }
      otRow.getCell(5).value = { formula: `C${otRow.number}*D${otRow.number}` };
      otPremiumCells.push(`E${otRow.number}`);
      
      const otHours = Math.max(0, empData.totalHours - OT_THRESHOLD);
      otPremiumTotal += round2(otHours * otPremiumRate);
    }
    
    // OT subtotal
    currentRow++;
    const otSubtotalRow = ws.addRow(["Subtotal (OT Premium)", "", "", "", 0]);
    otSubtotalRow.getCell(5).value = { formula: otPremiumCells.length ? `SUM(${otPremiumCells.join(",")})` : `0` };
    otSubtotalRow.font = { bold: true };
    otSubtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
    otPremiumSubtotalRowNum = otSubtotalRow.number;
    
    // Blank row
    currentRow++;
    ws.addRow([]);
  }
  
  // Process admin entries (right side)
  if (adminEntries.length > 0) {
    // Group admin by customer
    const adminByCustomer = new Map();
    for (const entry of adminEntries) {
      if (!adminByCustomer.has(entry.custId)) {
        adminByCustomer.set(entry.custId, {
          name: entry.custName,
          entries: []
        });
      }
      adminByCustomer.get(entry.custId).entries.push(entry);
    }
    
    let adminRow = 2;
    adminDataLastRow = null;
    const sortedAdminCustomers = [...adminByCustomer.entries()].sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
    
    for (const [custId, custData] of sortedAdminCustomers) {
      // Customer header
      const custRow = ws.getRow(adminRow);
      custRow.getCell(7).value = custData.name;
      custRow.getCell(7).font = { bold: true };
      custRow.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
      ws.mergeCells(adminRow, 7, adminRow, 11);
      adminRow++;
      
      // Sort entries
      custData.entries.sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        return dateCmp !== 0 ? dateCmp : a.empName.localeCompare(b.empName);
      });
      
      // Add entries
      for (const entry of custData.entries) {
        const rate = rateFn(entry.empId, custId, entry.empName);
        const amount = round2(entry.hours * rate);
        
        const row = ws.getRow(adminRow);
        row.getCell(7).value = entry.date;
        row.getCell(8).value = entry.empName;
        row.getCell(9).value = rate;
        row.getCell(10).value = entry.hours;
        row.getCell(11).value = { formula: `I${adminRow}*J${adminRow}` };
        
        adminTotal += amount;
        adminDataLastRow = adminRow;
        adminRow++;
      }
      adminRow++; // Blank between customers
    }
    
    // Admin subtotal - reference employee timesheet L21 (total $) for cascade
    adminRow++;
    const adminSubtotalRow = ws.getRow(adminRow);
    adminSubtotalRow.getCell(7).value = "Subtotal (Office)";
    adminSubtotalRow.getCell(7).font = { bold: true };
    // Build formula from unique admin employee timesheets for this week
    const adminEmpIds = new Set();
    for (const entry of adminEntries) adminEmpIds.add(entry.empId);
    const adminL21Refs = [];
    for (const empId of adminEmpIds) {
      const sName = empSheetNameMap.get(empId);
      if (sName) {
        const pos = empPositionsMap.get(empId);
        const sTotalRow = pos ? pos.summaryTotal : 22;
        adminL21Refs.push(`'${sName}'!L${sTotalRow}`);
      }
    }
    if (adminL21Refs.length > 0) {
      adminSubtotalRow.getCell(11).value = { formula: adminL21Refs.join('+') };
    } else if (adminDataLastRow) {
      adminSubtotalRow.getCell(11).value = { formula: `SUMIF(H2:H${adminDataLastRow},"<>",K2:K${adminDataLastRow})` };
    } else {
      adminSubtotalRow.getCell(11).value = 0;
    }
    adminSubtotalRow.getCell(11).font = { bold: true };
    adminSubtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
    adminSubtotalRowNum = adminSubtotalRow.number;
  }
  
  // Add office subtotal row
  currentRow++;
  const officeRow = ws.addRow(["Office (Admin)", "", "", "", round2(adminTotal)]);
  if (adminSubtotalRowNum) {
    officeRow.getCell(5).value = { formula: `K${adminSubtotalRowNum}` };
  }
  officeRow.font = { bold: true };
  officeRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
  
  // Grand total for week (hourly + OT premium + admin)
  currentRow++;
  const weekTotal = round2(hourlyTotal + otPremiumTotal + adminTotal);
  const totalRow = ws.addRow(["WEEK TOTAL", "", "", "", weekTotal]);
  const weekTotalRow = ws.rowCount;
  totalRow.font = { bold: true, size: 12 };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  const hourlySumFormula = hourlySubtotalRowNum ? `E${hourlySubtotalRowNum}` : `0`;
  const otSumFormula = otPremiumSubtotalRowNum ? `E${otPremiumSubtotalRowNum}` : `0`;
  const adminSumFormula = adminSubtotalRowNum ? `K${adminSubtotalRowNum}` : `0`;
  totalRow.getCell(5).value = { formula: `${hourlySumFormula}+${otSumFormula}+${adminSumFormula}` };
  totalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

  try { formatSheet(ws); } catch (e) {}

  return { hourlyTotal: round2(hourlyTotal + otPremiumTotal), adminTotal: round2(adminTotal), weekTotal, weekTotalRow, otPremiumTotal: round2(otPremiumTotal), otPremiumSubtotalRowNum, cellPositions };
}

/**
 * Build the monthly summary sheet with formulas referencing weekly sheets
 * @param {Object} ws - ExcelJS worksheet
 * @param {Array} weeklyTotals - Array of {sheetName, hourlyTotalRow, adminTotalRow, weekTotalRow}
 * @param {string} month - Month string YYYY-MM
 */
function buildSummarySheet(ws, weeklyTotals, monthlyAgg, db, month) {
  // Set up same columns as weekly sheets for consistency
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 25;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 14;
  
  ws.getColumn(3).numFmt = '"$"#,##0.00';
  ws.getColumn(5).numFmt = '"$"#,##0.00';
  
  // Title
  const titleRow = ws.addRow([`Monthly Summary - ${month}`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, 5);
  
  ws.addRow([]);
  
  // Section 1: Weekly totals (Hourly vs Admin)
  ws.addRow([]);
  const weeklyTitle = ws.addRow([`Weekly Totals - ${month}`]);
  weeklyTitle.font = { bold: true, size: 12 };
  ws.mergeCells(weeklyTitle.number || ws.lastRow.number, 1, (weeklyTitle.number || ws.lastRow.number), 5);
  ws.addRow([]);
  const wtHeader = ws.addRow(["Week", "Hourly Total", "Admin Total", "Week Total"]);
  wtHeader.font = { bold: true };
  wtHeader.eachCell((c) => c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } });

  let monthlyHourly = 0, monthlyAdmin = 0, monthlyGrand = 0;
  for (const w of weeklyTotals) {
    const hr = round2(Number(w.hourlyTotal) || 0);
    const adm = round2(Number(w.adminTotal) || 0);
    const wk = round2(Number(w.weekTotal) || hr + adm);
    ws.addRow([w.sheetName, hr, adm, wk]);
    monthlyHourly += hr; monthlyAdmin += adm; monthlyGrand += wk;
  }
  // Monthly totals row
  const mrow = ws.addRow(["MONTH TOTAL", round2(monthlyHourly), round2(monthlyAdmin), round2(monthlyGrand)]);
  mrow.font = { bold: true };

  ws.addRow([]);

  // Section 2: Detailed breakdown by customer -> employee (keeps old behavior)
  const headerRow = ws.addRow(["Customer", "Employee", "$/hr", "Hr", "Total"]);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

  // Iterate customers in alphabetical order
  const customers = [...monthlyAgg.entries()].map(([custId, data]) => ({ custId, name: data.name, employees: data.employees }));
  customers.sort((a,b) => a.name.localeCompare(b.name));

  let totalMonthly = 0;
  for (const cust of customers) {
    // Customer header
    const custRow = ws.addRow([cust.name]);
    custRow.font = { bold: true };
    custRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
    ws.mergeCells(ws.lastRow.number, 1, ws.lastRow.number, 5);

    // Employees under customer
    const emps = [...cust.employees.entries()].map(([empId, e]) => ({ empId, name: e.name, hours: e.hours }));
    emps.sort((a,b) => a.name.localeCompare(b.name));

    for (const e of emps) {
      const rate = getBillRate(db, e.empId, cust.custId);
      const amount = round2(e.hours * rate);
      totalMonthly += amount;
      ws.addRow(["", e.name, rate, round2(e.hours), amount]);
    }

    // Blank row between customers
    ws.addRow([]);
  }

  // Monthly total row (detailed)
  const totalRow = ws.addRow(["MONTHLY TOTAL", "", "", "", totalMonthly]);
  totalRow.font = { bold: true, size: 12 };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(5).numFmt = '"$"#,##0.00';
}

// Helper functions
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
  const byEmpDate = new Map();
  for (const e of entries) {
    const key = `${e.emp_id || e.employee_id || ''}::${e.work_date}`;
    if (!byEmpDate.has(key)) byEmpDate.set(key, []);
    byEmpDate.get(key).push(e);
  }
  for (const dayEntries of byEmpDate.values()) {
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

function addLogoToSheet(ws, logoId, col = 9.2) {
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
    const max = colMax[idx + 1] || 10;
    col.width = Math.min(50, Math.max(12, Math.ceil(max + 2)));
  });
}

function buildTimesheetSheet(db, ws, entries, logoId, options = {}) {
  const weekComment = options.comment || "";
  const rowOffset = options.rowOffset || 0;
  const empName = options.empName || "";
  const wkStartYmd = options.weekStart || "";
  const wkEndYmd = options.weekEnd || "";
  const isFirst = options.isFirst !== false;

  // Only set columns on first section
  if (isFirst || rowOffset === 0) {
    ws.columns = [
      { width: 10 }, // Date
      { width: 22 }, // Client Name
      { width: 12 }, // Time Start
      { width: 10 }, // Lunch
      { width: 12 }, // Time Out
      { width: 14 }, // Hours Per Job
      { width: 24 }, // Notes
      { width: 3 },  // spacer
      { width: 22 }, // Client
      { width: 10 }, // Hours
      { width: 10 }, // Rate
      { width: 12 }, // Total
    ];
  }

  // Employee name + week date range title row
  const formatMdy = (d) => { const dt = typeof d === 'string' ? ymdToDate(d) : d; return `${dt.getMonth()+1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`; };
  const weekLabel = (wkStartYmd && wkEndYmd) ? `${formatMdy(wkStartYmd)} - ${formatMdy(wkEndYmd)}` : "";
  const titleText = empName ? `${empName}  —  ${weekLabel}` : weekLabel;
  const titleRow = ws.addRow([titleText]);
  titleRow.font = { bold: true, size: 14 };
  const titleRowNum = titleRow.number;
  try { ws.mergeCells(titleRowNum, 1, titleRowNum, 7); } catch(e) {}
  if (empName) {
    titleRow.getCell(9).value = empName;
    titleRow.getCell(9).font = { bold: true, size: 12 };
  }

  const headerRow = ws.addRow(["Date", "Client Name", "Time Start", "Lunch", "Time Out", "Hours Per Job", "Notes", "", "Client", "Hours", "Rate", "Total"]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, colNum) => {
    if ([1,2,3,4,5,6,7,9,10,11,12].includes(colNum)) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    }
  });
  const headerRowNum = headerRow.number;
  const dataStartRow = headerRowNum + 1; // first data row
  if (isFirst) addLogoToSheet(ws, logoId, 7.2);

  const entriesByDate = new Map();
  const dateOrder = [];
  for (const e of entries) {
    if (!entriesByDate.has(e.work_date)) {
      entriesByDate.set(e.work_date, []);
      dateOrder.push(e.work_date);
    }
    entriesByDate.get(e.work_date).push(e);
  }

  const summaryMap = new Map();
  let empTotalHours = 0;
  for (const date of dateOrder) {
    const dayEntries = entriesByDate.get(date) || [];
    const dayObj = new Date(date + "T12:00:00");
    const rawDay = dayObj.toLocaleDateString("en-US", { weekday: "short" });
    const dayName = rawDay === "Thu" ? "Thurs" : (rawDay === "Tue" ? "Tues" : rawDay);
    const dayNum = String(dayObj.getDate());

    let currentTime = 7.5;
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

    const grouped = [];
    const groupedMap = new Map();
    for (const entry of workEntries) {
      let type = "Regular";
      if (entry.notes?.toLowerCase().includes("holiday")) type = "Holiday";
      if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";
      const clientName = type === "PTO" ? "PTO" : (type === "Holiday" ? "Holiday Pay" : entry.customer_name);
      const key = `${clientName}`.toLowerCase();
      let bucket = groupedMap.get(key);
      if (!bucket) {
        bucket = {
          clientName,
          cust_id: entry.cust_id,
          emp_id: entry.emp_id,
          hours: 0,
          notes: []
        };
        groupedMap.set(key, bucket);
        grouped.push(bucket);
      }
      bucket.hours += Number(entry.hours || 0);
      if (entry.notes) bucket.notes.push(entry.notes);
    }

    for (let i = 0; i < grouped.length; i += 1) {
      const entry = grouped[i];
      const hours = Number(entry.hours);
      const rate = getBillRate(db, entry.emp_id, entry.cust_id);
      const clientName = entry.clientName;

      const dateLabel = idx === 0 ? `${dayName}-${dayNum}` : "";
      const applyLunch = (!lunchApplied && lunchHours !== "" && i === grouped.length - 1);
      const rowLunch = applyLunch ? lunchHours : "";
      const lunchExcel = rowLunch === "" ? "" : (Number(rowLunch) / 24);
      const row = ws.addRow([dateLabel, clientName, "", lunchExcel, "", "", (entry.notes || []).join("; "), "", "", "", "", ""]);
      row.getCell(6).value = Number(hours) - (applyLunch ? Number(lunchHours || 0) : 0);
      const netHours = applyLunch ? Math.max(0, hours - Number(lunchHours || 0)) : hours;
      empTotalHours += netHours;
      if (applyLunch) lunchApplied = true;

      const summaryName = clientName;
      const key = summaryName.toLowerCase();
      if (!summaryMap.has(key)) summaryMap.set(key, { name: summaryName, hours: 0, total: 0, rate });
      const agg = summaryMap.get(key);
      agg.hours += netHours;
      agg.total += round2(netHours * rate);
      agg.rate = rate;

      idx += 1;
    }
  }

  const desiredTotalRow = titleRowNum + 38; // title + header + 36 data/pad rows + total
  while (ws.rowCount < desiredTotalRow - 1) {
    ws.addRow(["", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  const totalRowObj = ws.addRow(["", "", "", "", "Total:", { formula: `SUM(F${dataStartRow}:F${desiredTotalRow - 1})` }, "", "", "", "", "", ""]);
  if (weekComment) {
    totalRowObj.getCell(7).value = "Comment:";
    totalRowObj.getCell(8).value = weekComment;
  }

  const preferredOrder = ["Hall", "Howard", "Lucas", "Richer", "", "PTO", "Holiday Pay"];
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

  let rIdx = dataStartRow; // summary panel starts at first data row
  const summaryTotalRow = dataStartRow + 19; // 20 summary rows
  for (const s of summaryRows) {
    if (rIdx >= summaryTotalRow) break;
    const row = ws.getRow(rIdx);
    row.getCell(9).value = s.name || "";
    row.getCell(10).value = { formula: `IF(I${rIdx}="","",SUMIF($B$${dataStartRow}:$B$${desiredTotalRow - 1},TRIM(I${rIdx}),$F$${dataStartRow}:$F$${desiredTotalRow - 1}))` };
    row.getCell(11).value = s.name ? s.rate : "";
    row.getCell(12).value = { formula: `IF(OR(J${rIdx}="",K${rIdx}=""),"",J${rIdx}*K${rIdx})` };
    rIdx++;
  }
  while (rIdx < summaryTotalRow) {
    const row = ws.getRow(rIdx);
    row.getCell(9).value = "";
    row.getCell(10).value = { formula: `IF(I${rIdx}="","",SUMIF($B$${dataStartRow}:$B$${desiredTotalRow - 1},TRIM(I${rIdx}),$F$${dataStartRow}:$F$${desiredTotalRow - 1}))` };
    row.getCell(11).value = "";
    row.getCell(12).value = { formula: `IF(OR(J${rIdx}="",K${rIdx}=""),"",J${rIdx}*K${rIdx})` };
    rIdx++;
  }
  const totalSummaryRow = ws.getRow(summaryTotalRow);
  totalSummaryRow.getCell(9).value = "TOTAL:";
  totalSummaryRow.getCell(10).value = { formula: `SUM(J${dataStartRow}:J${summaryTotalRow - 1})` };
  totalSummaryRow.getCell(11).value = singleRate;
  totalSummaryRow.getCell(12).value = { formula: `IF(OR(J${summaryTotalRow}="",K${summaryTotalRow}=""),"",J${summaryTotalRow}*K${summaryTotalRow})` };

  if (isFirst) {
    ws.getColumn(3).numFmt = 'h:mm AM/PM';
    ws.getColumn(4).numFmt = 'h:mm';
    ws.getColumn(5).numFmt = 'h:mm AM/PM';
    ws.getColumn(6).numFmt = '0.00';
    ws.getColumn(11).numFmt = '"$"#,##0.00';
    ws.getColumn(12).numFmt = '"$"#,##0.00';
  }
  // Don't call formatSheet for stacked sections (it resets frozen panes)
  if (isFirst) { try { formatSheet(ws); } catch (e) {} }

  // Return positions for cross-sheet references
  return {
    summaryStart: dataStartRow,
    summaryEnd: summaryTotalRow - 1,
    summaryTotal: summaryTotalRow,
    totalRow: desiredTotalRow,
    titleRow: titleRowNum,
    headerRow: headerRowNum
  };
}

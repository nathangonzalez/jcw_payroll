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
import { getEmployeeCategory } from "../classification.js";
import { weekStartYMD, ymdToDate } from "../time.js";

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
 * Return an array of payroll week-start strings (YYYY-MM-DD) that intersect the month range
 */
function getWeekStartsForMonth(monthStartStr, nextMonthStr) {
  const end = ymdToDate(nextMonthStr);
  const firstWeekStart = weekStartYMD(ymdToDate(monthStartStr));
  const weeks = [];
  for (let d = ymdToDate(firstWeekStart); d < end; d.setDate(d.getDate() + 7)) {
    weeks.push(formatYmd(d));
  }
  return weeks;
}

/**
 * Generate monthly payroll breakdown XLSX with weekly sheets
 */
export async function generateMonthlyExport({ db, month }) {
  // Calculate date range for the month
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  // Create output directory
  const baseDir = process.env.NODE_ENV === 'production' ? '/tmp/exports' : './exports';
  const outputDir = path.resolve(`${baseDir}/${month}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Query all non-deleted entries for the month (include SUBMITTED + APPROVED)
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.id as emp_id, c.name as customer_name, c.id as cust_id
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date < ?
      AND (te.status IS NULL OR te.status != 'DELETED')
    ORDER BY te.work_date ASC, te.created_at ASC
  `).all(monthStart, nextMonth);

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
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, []);
    byWeek.get(weekStart).push(row);

    // monthly aggregation: customer -> employee -> { empId, name, hours, category }
    if (!monthlyAgg.has(row.custId)) monthlyAgg.set(row.custId, { name: row.custName, employees: new Map() });
    const custBucket = monthlyAgg.get(row.custId);
    if (!custBucket.employees.has(row.empId)) custBucket.employees.set(row.empId, { empId: row.empId, name: row.empName, hours: 0, category: row.category });
    const empBucket = custBucket.employees.get(row.empId);
    empBucket.hours += row.hours;
  }

  // Build a list of all Sunday week-starts that intersect the month range
  const sortedWeeks = getWeekStartsForMonth(monthStart, nextMonth);

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const logoId = addLogoImage(workbook);

  // Track weekly totals for summary sheet formulas
  const weeklyTotals = [];

  // Create Monthly Breakdown sheet first (promote it to front)
  const monthlySheet = workbook.addWorksheet('Monthly Breakdown');
  addLogoToSheet(monthlySheet, logoId, 9.2);
  setupWeeklyColumns(monthlySheet);

  // Create a sheet for each week using the weekly sheet builder
  // Use reverse chronological order so latest week appears first
  const weeksDesc = [...sortedWeeks].reverse();
  const firstWeekStart = sortedWeeks[0];
  for (const weekSunday of weeksDesc) {
    const weekEntries = byWeek.get(weekSunday);
    const sheetName = formatWeekName(weekSunday);
    const ws = workbook.addWorksheet(sheetName);
    addLogoToSheet(ws, logoId, 7.2);
    setupWeeklyColumns(ws);
    const result = buildWeeklySheet(db, ws, weekEntries);
    // result contains weekTotal and weekTotalRow to reference in summary
    weeklyTotals.push({
      sheetName,
      weekTotalRow: result.weekTotalRow,
      hourlyTotal: result.hourlyTotal,
      adminTotal: result.adminTotal,
      weekTotal: result.weekTotal
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

  for (const cust of customers) {
    // Customer header: left and right
    const ch = monthlySheet.addRow([cust.name]);
    ch.font = { bold: true };
    ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    monthlySheet.mergeCells(ch.number, 1, ch.number, 5);
    monthlySheet.mergeCells(ch.number, 7, ch.number, 11);

    const emps = [...cust.employees.values()].sort((a,b) => a.name.localeCompare(b.name));
    for (const e of emps) {
      const rate = getBillRate(db, e.empId, cust.custId);
      const amount = round2(e.hours * rate);
      if ((e.category || '').toLowerCase() === 'admin') {
        // place in admin columns (G=7, H=8, I=9, J=10, K=11)
        const r = monthlySheet.addRow(['', '', '', '', '', '', '', e.name, rate, round2(e.hours), amount]);
        monthlyAdminTotal += amount;
      } else {
        // place in hourly columns (A=1, B=2, C=3, D=4, E=5)
        const r = monthlySheet.addRow(['', e.name, rate, round2(e.hours), amount]);
        monthlyHourlyTotal += amount;
      }
    }

    // blank row between customers
    monthlySheet.addRow([]);
  }

  // Totals
  monthlySheet.addRow(['Subtotal (Hourly)', '', '', '', round2(monthlyHourlyTotal)]).font = { bold: true };
  monthlySheet.addRow(['Subtotal (Admin)', '', '', '', '', '', '', '', '', '', round2(monthlyAdminTotal)]).font = { bold: true };
  // Grand total (Hourly + Admin)
  const monthlyGrandTotal = round2(monthlyHourlyTotal + monthlyAdminTotal);
  const grandRow = monthlySheet.addRow(['GRAND TOTAL', '', '', '', '', '', '', '', '', '', monthlyGrandTotal]);
  grandRow.font = { bold: true, size: 12 };
  grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  grandRow.getCell(11).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  // Ensure numeric formatting
  monthlySheet.getColumn(5).numFmt = '"$"#,##0.00';
  monthlySheet.getColumn(11).numFmt = '"$"#,##0.00';
  try { formatSheet(monthlySheet); } catch (e) {}

  // Add one sheet per employee in weekly timesheet format (first payroll week of the month)
  const byEmployee = new Map();
  for (const r of entries) {
    if (!byEmployee.has(r.emp_id)) byEmployee.set(r.emp_id, { id: r.emp_id, name: r.employee_name, entries: [] });
    byEmployee.get(r.emp_id).entries.push(r);
  }

  for (const [empId, empBucket] of byEmployee) {
    // Excel sheet names must be <=31 chars
    let sheetName = (empBucket.name || `Emp_${empId}`).slice(0, 28);
    // Ensure unique sheet name
    let suffix = 1;
    while (workbook.getWorksheet(sheetName)) {
      sheetName = `${(empBucket.name || `Emp_${empId}`).slice(0, 24)}_${suffix}`;
      suffix++;
    }
    const ws = workbook.addWorksheet(sheetName);
    addLogoToSheet(ws, logoId, 7.2);

    const weekEntries = empBucket.entries.filter(e => getPayrollWeekStart(e.work_date) === firstWeekStart);
    buildTimesheetSheet(db, ws, weekEntries);
  }

  // Note: Monthly Summary sheet removed. `Monthly Breakdown` has been populated above.

  // Save file (if target exists/locked, write to a timestamped filename)
  let filename = `Payroll_Breakdown_${month}.xlsx`;
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
function buildWeeklySheet(db, ws, entries = []) {
  let hourlyTotal = 0;
  let adminTotal = 0;
  let currentRow = 0;
  
  // Separate hourly and admin entries
  const hourlyEntries = entries.filter(e => e.category === "hourly");
  const adminEntries = entries.filter(e => e.category === "admin");
  
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
  for (const [custId, custData] of sortedCustomers) {
    // Customer header
    currentRow++;
    const custRow = ws.addRow([custData.name]);
    custRow.font = { bold: true };
    custRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
    ws.mergeCells(currentRow, 1, currentRow, 5);
    
    const firstDataRow = currentRow + 1;
    let customerTotal = 0;
    
    // Sort entries by date then employee
    custData.entries.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      return dateCmp !== 0 ? dateCmp : a.empName.localeCompare(b.empName);
    });
    
    // Add entry rows
    for (const entry of custData.entries) {
      const rate = getBillRate(db, entry.empId, custId);
      const amount = round2(entry.hours * rate);
      
      currentRow++;
      ws.addRow([entry.date, entry.empName, rate, entry.hours, { formula: `C${currentRow}*D${currentRow}` }]);
      
      customerTotal += amount;
      hourlyTotal += amount;
    }
    
    // Customer subtotal
    const lastDataRow = currentRow;
    currentRow++;
    const subtotalRow = ws.addRow(["", "", "", "", { formula: `SUM(E${firstDataRow}:E${lastDataRow})` }]);
    subtotalRow.font = { bold: true };
    subtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    
    // Blank row
    currentRow++;
    ws.addRow([]);
  }
  
  // Add hourly subtotal
  currentRow++;
  const hourlySubtotalRow = ws.addRow(["Subtotal (Hourly)", "", "", "", round2(hourlyTotal)]);
  hourlySubtotalRow.font = { bold: true };
  hourlySubtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  
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
        const rate = getBillRate(db, entry.empId, custId);
        const amount = round2(entry.hours * rate);
        
        const row = ws.getRow(adminRow);
        row.getCell(7).value = entry.date;
        row.getCell(8).value = entry.empName;
        row.getCell(9).value = rate;
        row.getCell(10).value = entry.hours;
        row.getCell(11).value = { formula: `I${adminRow}*J${adminRow}` };
        
        adminTotal += amount;
        adminRow++;
      }
      adminRow++; // Blank between customers
    }
    
    // Admin subtotal
    adminRow++;
    const adminSubtotalRow = ws.getRow(adminRow);
    adminSubtotalRow.getCell(7).value = "Subtotal (Office)";
    adminSubtotalRow.getCell(7).font = { bold: true };
    adminSubtotalRow.getCell(11).value = round2(adminTotal);
    adminSubtotalRow.getCell(11).font = { bold: true };
    adminSubtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
  }
  
  // Add office subtotal row
  currentRow++;
  const officeRow = ws.addRow(["Office (Admin)", "", "", "", round2(adminTotal)]);
  officeRow.font = { bold: true };
  officeRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
  
  // Grand total for week
  currentRow++;
  const weekTotal = round2(hourlyTotal + adminTotal);
  const totalRow = ws.addRow(["WEEK TOTAL", "", "", "", weekTotal]);
  const weekTotalRow = ws.rowCount; // Track this row number for summary formulas
  totalRow.font = { bold: true, size: 12 };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

  try { formatSheet(ws); } catch (e) {}

  return { hourlyTotal: round2(hourlyTotal), adminTotal: round2(adminTotal), weekTotal, weekTotalRow };
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

function buildTimesheetSheet(db, ws, entries) {
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

  const entriesByDate = new Map();
  const dateOrder = [];
  for (const e of entries) {
    if (!entriesByDate.has(e.work_date)) {
      entriesByDate.set(e.work_date, []);
      dateOrder.push(e.work_date);
    }
    entriesByDate.get(e.work_date).push(e);
  }

  const leftRows = [];
  const summaryMap = new Map();
  for (const date of dateOrder) {
    const dayEntries = entriesByDate.get(date) || [];
    const dayObj = new Date(date + "T12:00:00");
    const dayName = dayObj.toLocaleDateString("en-US", { weekday: "short" });
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
    for (const entry of dayEntries) {
      const hours = Number(entry.hours);
      const rate = getBillRate(db, entry.emp_id, entry.cust_id);
      let type = "Regular";
      if (entry.notes?.toLowerCase().includes("holiday")) type = "Holiday";
      if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";
      const clientName = type === "PTO" ? "PTO" : (type === "Holiday" ? "Holiday Pay" : entry.customer_name);

      const dateLabel = idx === 0 ? dayName : (idx === 1 ? dayNum : "");
      const timeStart = currentTime;
      const lunch = idx === lunchIndex ? 0.5 : "";
      const timeOut = timeStart + hours + (lunch === "" ? 0 : lunch);
      leftRows.push([dateLabel, clientName, round2(timeStart), lunch, round2(timeOut), hours, "", "", "", "", ""]);
      if (idx === 0 && dayEntries.length === 1) {
        leftRows.push([dayNum, "", "", "", "", hours, "", "", "", "", ""]);
      }
      currentTime = timeOut;

      const key = clientName.toLowerCase();
      if (!summaryMap.has(key)) summaryMap.set(key, { name: clientName, hours: 0, total: 0, rate });
      const agg = summaryMap.get(key);
      agg.hours += hours;
      agg.total += round2(hours * rate);
      agg.rate = rate;

      idx += 1;
    }
  }

  for (const r of leftRows) ws.addRow(r);
  const desiredTotalRow = 39;
  while (ws.rowCount < desiredTotalRow - 1) ws.addRow(["", "", "", "", "", "", "", "", "", "", ""]);
  ws.addRow(["", "", "", "", "Total:", { formula: `SUM(F2:F${desiredTotalRow - 1})` }, "", "", "", "", ""]);

  const summaryRows = [...summaryMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  let rIdx = 2;
  const summaryTotalRow = 21;
  const rateSet = new Set();
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
}

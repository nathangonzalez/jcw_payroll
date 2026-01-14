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
import { getBillRate } from "../billing.js";
import { getEmployeeCategory } from "../classification.js";

/**
 * Get the Sunday that starts the week containing a given date
 */
function getWeekSunday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 = Sunday
  date.setDate(date.getDate() - day);
  return formatYmd(date);
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

  // Query all approved entries for the month
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.id as emp_id, c.name as customer_name, c.id as cust_id
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date < ?
      AND te.status = 'APPROVED'
    ORDER BY te.work_date ASC, c.name ASC, e.name ASC
  `).all(monthStart, nextMonth);

  // Normalize DB rows to the shape expected by sheet builders and group by week (Sunday start)
  const byWeek = new Map();
  for (const r of entries) {
    const row = {
      // normalized fields expected by buildWeeklySheet
      date: r.work_date,
      empName: r.employee_name,
      empId: r.emp_id,
      custName: r.customer_name,
      custId: r.cust_id,
      hours: Number(r.hours),
      notes: r.notes || '',
      // assign category using classification helper
      category: getEmployeeCategory(r.employee_name)
    };

    const weekSunday = getWeekSunday(row.date);
    if (!byWeek.has(weekSunday)) byWeek.set(weekSunday, []);
    byWeek.get(weekSunday).push(row);
  }
  const sortedWeeks = [...byWeek.keys()].sort();

  // Create workbook
  const workbook = new ExcelJS.Workbook();

  // Track weekly totals for summary sheet formulas
  const weeklyTotals = [];

  // Create a sheet for each week using the weekly sheet builder
  for (const weekSunday of sortedWeeks) {
    const weekEntries = byWeek.get(weekSunday);
    const sheetName = formatWeekName(weekSunday);
    const ws = workbook.addWorksheet(sheetName);
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

  // Add the monthly summary as the last sheet with formulas referencing weekly sheets
  const summarySheet = workbook.addWorksheet("Monthly Summary");
  buildSummarySheet(summarySheet, weeklyTotals, month);

  // Save file
  const filename = `Payroll_Breakdown_${month}.xlsx`;
  const filepath = path.join(outputDir, filename);
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
function buildWeeklySheet(db, ws, entries) {
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
  
  return { hourlyTotal: round2(hourlyTotal), adminTotal: round2(adminTotal), weekTotal, weekTotalRow };
}

/**
 * Build the monthly summary sheet with formulas referencing weekly sheets
 * @param {Object} ws - ExcelJS worksheet
 * @param {Array} weeklyTotals - Array of {sheetName, hourlyTotalRow, adminTotalRow, weekTotalRow}
 * @param {string} month - Month string YYYY-MM
 */
function buildSummarySheet(ws, weeklyTotals, month) {
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
  
  // Header matching weekly sheets
  const headerRow = ws.addRow(["Week", "", "", "", "Total"]);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  
  // Weekly rows with formulas pointing to each week sheet's total
  const weekRowStart = 4;
  for (let i = 0; i < weeklyTotals.length; i++) {
    const week = weeklyTotals[i];
    // Reference the WEEK TOTAL cell from each weekly sheet
    const formula = `'${week.sheetName}'!E${week.weekTotalRow}`;
    const row = ws.addRow([week.sheetName, "", "", "", { formula }]);
    row.getCell(5).numFmt = '"$"#,##0.00';
  }
  
  ws.addRow([]);
  
  // Monthly grand total - SUM of all weekly totals
  const weekRowEnd = weekRowStart + weeklyTotals.length - 1;
  const totalRow = ws.addRow(["MONTHLY TOTAL", "", "", "", { formula: `SUM(E${weekRowStart}:E${weekRowEnd})` }]);
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

/**
 * Weekly XLSX Export Generator
 * Generates 1 workbook per employee per week
 * Filename: <EmployeeName>_<YYYY-MM-DD>.xlsx
 * Columns: Date, Client, Hours, Type (Regular|OT|PTO|Holiday), Rate, Total
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { getBillRate } from "../billing.js";
import { getEmployeeCategory, splitEntriesWithOT, calculatePayWithOT } from "../classification.js";
import { isHoliday } from "../holidays.js";

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
    const ws = workbook.addWorksheet("Weekly Timesheet");

    // Header row
    ws.addRow(["Date", "Client", "Hours", "Type", "Rate", "Total"]);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

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

    // Add data rows
    for (const entry of processedEntries) {
      const hours = Number(entry.hours);
      const rate = entry.rate;
      
      // Determine type: check for holiday first, then regular/OT
      let type = entry.type || "Regular";
      if (entry.holidayName) {
        type = "Holiday";
      }
      // Check notes for PTO indicator
      if (entry.notes?.toLowerCase().includes("pto")) {
        type = "PTO";
      }

      const otMultiplier = type === "OT" ? 1.5 : 1;
      const total = round2(hours * rate * otMultiplier);

      ws.addRow([
        entry.work_date,
        entry.customer_name,
        hours,
        type,
        rate,
        total,
      ]);

      empTotalHours += hours;
      if (type === "OT") {
        empOTHours += hours;
      } else {
        empRegularHours += hours;
      }
      empTotalAmount += total;
    }

    // Add subtotal row
    ws.addRow([]);
    const subtotalRow = ws.addRow([
      "SUBTOTAL",
      "",
      round2(empTotalHours),
      `Reg: ${round2(empRegularHours)} / OT: ${round2(empOTHours)}`,
      "",
      round2(empTotalAmount),
    ]);
    subtotalRow.font = { bold: true };
    subtotalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFE0B0" },
    };

    // Category info row
    ws.addRow([`Category: ${category.toUpperCase()}`, "", "", "", "", ""]);

    // Per-employee hourly/admin subtotals and grand total
    const empHourlyAmount = category === 'admin' ? 0 : round2(empTotalAmount);
    const empAdminAmount = category === 'admin' ? round2(empTotalAmount) : 0;
    const empGrandTotal = round2(empHourlyAmount + empAdminAmount);

    ws.addRow([]);
    const hourlyRow = ws.addRow(["HOURLY SUBTOTAL", "", "", "", "", empHourlyAmount]);
    const adminRow = ws.addRow(["ADMIN SUBTOTAL", "", "", "", "", empAdminAmount]);
    const grandRow = ws.addRow(["GRAND TOTAL", "", "", "", "", empGrandTotal]);
    hourlyRow.font = { bold: true };
    adminRow.font = { bold: true };
    grandRow.font = { bold: true, color: { argb: 'FF0000' } };
    hourlyRow.fill = adminRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFAF3E0" },
    };
    grandRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F8E0" },
    };
    // Ensure currency formatting for the totals column
    ws.getColumn(6).numFmt = '"$"#,##0.00';

    // Format columns
    ws.columns = [
      { width: 12 },  // Date
      { width: 25 },  // Client
      { width: 8 },   // Hours
      { width: 10 },  // Type
      { width: 8 },   // Rate
      { width: 12 },  // Total
    ];

    // Format currency columns
    ws.getColumn(5).numFmt = '"$"#,##0.00';
    ws.getColumn(6).numFmt = '"$"#,##0.00';

    // Save file
    const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${safeName}_${weekStart}.xlsx`;
    const filepath = path.join(outputDir, filename);
    // Also include a second sheet that matches the "Jason" schema requested
    const jasonSheet = workbook.addWorksheet("Jason Schema");
    // Jason schema: Employee, Employee ID, Date, Client, Hours, Rate, Total, Type, Notes
    jasonSheet.addRow(["Employee", "Employee ID", "Date", "Client", "Hours", "Rate", "Total", "Type", "Notes"]);
    jasonSheet.getRow(1).font = { bold: true };

    for (const entry of processedEntries) {
      const hours = Number(entry.hours);
      const rate = entry.rate;
      let type = entry.type || "Regular";
      if (entry.holidayName) type = "Holiday";
      if (entry.notes?.toLowerCase().includes("pto")) type = "PTO";
      const otMultiplier = type === "OT" ? 1.5 : 1;
      const total = round2(hours * rate * otMultiplier);

      jasonSheet.addRow([
        emp.name,
        empId,
        entry.work_date,
        entry.customer_name,
        hours,
        rate,
        total,
        type,
        entry.notes || "",
      ]);
    }

    // format columns for Jason sheet
    jasonSheet.columns = [
      { width: 20 }, // Employee
      { width: 18 }, // Employee ID
      { width: 12 }, // Date
      { width: 25 }, // Client
      { width: 8 },  // Hours
      { width: 10 }, // Rate
      { width: 12 }, // Total
      { width: 10 }, // Type
      { width: 30 }, // Notes
    ];
    jasonSheet.getColumn(6).numFmt = '"$"#,##0.00';
    jasonSheet.getColumn(7).numFmt = '"$"#,##0.00';

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

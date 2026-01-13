/**
 * Monthly Payroll Breakdown XLSX Generator
 * Generates 1 consolidated workbook for the entire month
 * 
 * PRIVACY: Admin employees (Chris J, Chris Z) are shown as a single "Admin" column
 * to hide their individual internal costs. Hourly employees' costs are shown individually.
 * 
 * Filename: Payroll_Breakdown_<YYYY-MM>.xlsx
 * Columns: Client | Hourly1 Hours/Rate/Amount | ... | Admin Hours/Amount | Row Total
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { getBillRate } from "../billing.js";
import { getEmployeeCategory, calculatePayWithOT } from "../classification.js";

/**
 * Generate monthly payroll breakdown XLSX
 * @param {Object} options
 * @param {Database} options.db - SQLite database instance
 * @param {string} options.month - Month in YYYY-MM format
 * @returns {Promise<{filepath: string, totals: Object}>}
 */
export async function generateMonthlyExport({ db, month }) {
  // Calculate date range for the month
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  // Create output directory
  const outputDir = path.resolve(`./exports/${month}`);
  ensureDir(outputDir);

  // Query all approved entries for the month
  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.id as emp_id, c.name as customer_name, c.id as cust_id
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date < ?
      AND te.status = 'APPROVED'
    ORDER BY c.name ASC, e.name ASC
  `).all(monthStart, nextMonth);

  // Get unique employees and split by category
  const allEmployees = [...new Set(entries.map((r) => r.employee_name))].sort();
  const employeeIds = new Map(entries.map((r) => [r.employee_name, r.emp_id]));
  
  // Separate hourly vs admin employees (admin internal costs are private)
  const hourlyEmployees = allEmployees.filter(name => getEmployeeCategory(name) === "hourly");
  const adminEmployees = allEmployees.filter(name => getEmployeeCategory(name) === "admin");
  const hasAdmins = adminEmployees.length > 0;

  // Aggregate by customer + employee
  const byCustomer = new Map();
  for (const row of entries) {
    if (!byCustomer.has(row.cust_id)) {
      byCustomer.set(row.cust_id, {
        id: row.cust_id,
        name: row.customer_name,
        byEmployee: new Map(),
      });
    }
    const cust = byCustomer.get(row.cust_id);
    if (!cust.byEmployee.has(row.employee_name)) {
      cust.byEmployee.set(row.employee_name, {
        hours: 0,
        empId: row.emp_id,
      });
    }
    cust.byEmployee.get(row.employee_name).hours += Number(row.hours);
  }

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Payroll Breakdown");

  // Build header row:
  // Client | Hourly1 Hours | Hourly1 Rate | Hourly1 Amount | ... | Admin Hours | Admin Amount | Row Total
  const header = ["Client"];
  for (const empName of hourlyEmployees) {
    header.push(`${empName} Hours`, `${empName} Rate`, `${empName} Amount`);
  }
  // Admin as single column (no rate shown for privacy)
  if (hasAdmins) {
    header.push("Admin Hours", "Admin Amount");
  }
  header.push("Row Total");
  ws.addRow(header);

  // Style header
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };

  // Track totals
  const hourlyTotals = new Map();
  for (const empName of hourlyEmployees) {
    hourlyTotals.set(empName, { hours: 0, amount: 0 });
  }
  let adminTotalHours = 0;
  let adminTotalAmount = 0;
  let grandTotal = 0;

  // Data rows - one per customer
  const sortedCustomers = [...byCustomer.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const cust of sortedCustomers) {
    const row = [cust.name];
    let rowTotal = 0;

    // Hourly employees - show individual detail
    for (const empName of hourlyEmployees) {
      const empData = cust.byEmployee.get(empName);
      const empId = employeeIds.get(empName);
      const hours = empData?.hours || 0;
      const rate = empId ? getBillRate(db, empId, cust.id) : 0;
      const amount = round2(hours * rate);

      row.push(hours || "", rate || "", amount || "");
      rowTotal += amount;

      const empTotals = hourlyTotals.get(empName);
      empTotals.hours += hours;
      empTotals.amount += amount;
    }

    // Admin employees - combine into single column (no rates shown)
    if (hasAdmins) {
      let adminHours = 0;
      let adminAmount = 0;
      for (const adminName of adminEmployees) {
        const empData = cust.byEmployee.get(adminName);
        const empId = employeeIds.get(adminName);
        const hours = empData?.hours || 0;
        const rate = empId ? getBillRate(db, empId, cust.id) : 0;
        adminHours += hours;
        adminAmount += round2(hours * rate);
      }
      row.push(adminHours || "", round2(adminAmount) || "");
      rowTotal += adminAmount;
      adminTotalHours += adminHours;
      adminTotalAmount += adminAmount;
    }

    row.push(round2(rowTotal));
    grandTotal += rowTotal;
    ws.addRow(row);
  }

  // Add totals row
  ws.addRow([]); // blank row
  const totalsRow = ["TOTALS"];
  for (const empName of hourlyEmployees) {
    const empTotals = hourlyTotals.get(empName);
    totalsRow.push(round2(empTotals.hours), "", round2(empTotals.amount));
  }
  if (hasAdmins) {
    totalsRow.push(round2(adminTotalHours), round2(adminTotalAmount));
  }
  totalsRow.push(round2(grandTotal));
  
  const totalsRowRef = ws.addRow(totalsRow);
  totalsRowRef.font = { bold: true };
  totalsRowRef.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFE0B0" },
  };

  // Add summary section
  ws.addRow([]);
  ws.addRow(["SUMMARY BY CATEGORY"]);
  ws.addRow(["Category", "Employees", "Total Hours", "Total Amount"]);
  
  // Hourly subtotal
  let hourlySubtotalHours = 0;
  let hourlySubtotalAmount = 0;
  for (const [name, totals] of hourlyTotals) {
    hourlySubtotalHours += totals.hours;
    hourlySubtotalAmount += totals.amount;
  }
  ws.addRow(["Hourly", hourlyEmployees.length, round2(hourlySubtotalHours), round2(hourlySubtotalAmount)]);
  
  // Admin subtotal
  if (hasAdmins) {
    ws.addRow(["Admin", adminEmployees.length, round2(adminTotalHours), round2(adminTotalAmount)]);
  }
  
  // Grand total
  const grandRow = ws.addRow(["GRAND TOTAL", allEmployees.length, round2(hourlySubtotalHours + adminTotalHours), round2(grandTotal)]);
  grandRow.font = { bold: true };

  // Set column widths
  ws.getColumn(1).width = 30; // Client column
  for (let i = 2; i <= header.length; i++) {
    ws.getColumn(i).width = 14;
  }

  // Format currency columns for hourly employees
  for (let i = 0; i < hourlyEmployees.length; i++) {
    const rateCol = 3 + i * 3; // Rate columns
    const amountCol = 4 + i * 3; // Amount columns
    ws.getColumn(rateCol).numFmt = '"$"#,##0.00';
    ws.getColumn(amountCol).numFmt = '"$"#,##0.00';
  }
  
  // Format Admin amount column
  if (hasAdmins) {
    const adminAmountCol = 2 + hourlyEmployees.length * 3 + 2; // Admin Amount column
    ws.getColumn(adminAmountCol).numFmt = '"$"#,##0.00';
  }
  
  // Row total column
  ws.getColumn(header.length).numFmt = '"$"#,##0.00';

  // Save file
  const filename = `Payroll_Breakdown_${month}.xlsx`;
  const filepath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filepath);

  // Build totals summary
  const totals = {
    month,
    customers: sortedCustomers.length,
    employees: allEmployees.length,
    hourlyEmployees: hourlyEmployees.length,
    adminEmployees: adminEmployees.length,
    hourlyTotal: round2(hourlySubtotalAmount),
    adminTotal: round2(adminTotalAmount),
    grandTotal: round2(grandTotal),
  };

  console.log(`[generateMonthly] Month ${month}: ${sortedCustomers.length} customers`);
  console.log(`[generateMonthly] Hourly: ${hourlyEmployees.length} employees, $${totals.hourlyTotal}`);
  console.log(`[generateMonthly] Admin: ${adminEmployees.length} employees, $${totals.adminTotal}`);
  console.log(`[generateMonthly] Grand Total: $${totals.grandTotal}`);

  return { filepath, filename, totals, outputDir };
}

// Helper functions
function getWeekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatYmd(date);
}

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

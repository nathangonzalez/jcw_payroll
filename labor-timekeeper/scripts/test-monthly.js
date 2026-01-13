#!/usr/bin/env node
/**
 * Test script for monthly export
 * Creates file with _TEST suffix to avoid lock issues
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import { getBillRate } from "../lib/billing.js";
import { getEmployeeCategory } from "../lib/classification.js";

const DB_PATH = path.resolve("./data/app.db");
const MONTH = "2026-01";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function main() {
  const db = new Database(DB_PATH);
  
  // Calculate date range for the month
  const monthStart = `${MONTH}-01`;
  const [y, m] = MONTH.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  // Create output directory
  const outputDir = path.resolve(`./exports/${MONTH}`);
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

  console.log(`Found ${entries.length} entries for ${MONTH}`);
  
  if (entries.length === 0) {
    console.log("No entries found - nothing to export");
    db.close();
    return;
  }

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
        category: getEmployeeCategory(row.employee_name),
      });
    }
    cust.byEmployee.get(row.employee_name).hours += Number(row.hours);
  }

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Payroll Breakdown");

  // Set column widths
  ws.columns = [
    { key: "name", width: 25 },
    { key: "rate", width: 10 },
    { key: "hours", width: 10 },
    { key: "total", width: 15 },
  ];

  let currentRow = 1;
  let hourlyGrandTotal = 0;
  let adminGrandTotal = 0;

  // Sort customers alphabetically
  const sortedCustomers = Array.from(byCustomer.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Process each customer
  for (const customer of sortedCustomers) {
    // Customer name header row
    const custRow = ws.getRow(currentRow);
    custRow.getCell(1).value = customer.name;
    custRow.getCell(1).font = { bold: true, size: 11 };
    custRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD3D3D3" }, // Light gray
    };
    currentRow++;

    let customerSubtotal = 0;
    const employeeStartRow = currentRow;

    // Employee rows (hourly only - admin excluded from customer sections)
    const hourlyEmployees = Array.from(customer.byEmployee.entries())
      .filter(([_, data]) => data.category === "hourly")
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [empName, data] of hourlyEmployees) {
      const rate = getBillRate(db, data.empId, customer.id);
      const row = ws.getRow(currentRow);
      row.getCell(1).value = empName;
      row.getCell(2).value = rate;
      row.getCell(2).numFmt = '"$"#,##0.00';
      row.getCell(3).value = round2(data.hours);
      // Formula: =B*C
      row.getCell(4).value = { formula: `B${currentRow}*C${currentRow}` };
      row.getCell(4).numFmt = '"$"#,##0.00';
      customerSubtotal += rate * data.hours;
      currentRow++;
    }

    // Track admin hours for this customer (for Office total)
    const adminEmployees = Array.from(customer.byEmployee.entries()).filter(
      ([_, data]) => data.category === "admin"
    );
    for (const [empName, data] of adminEmployees) {
      const rate = getBillRate(db, data.empId, customer.id);
      adminGrandTotal += rate * data.hours;
    }

    // Customer subtotal row
    const subtotalRow = ws.getRow(currentRow);
    subtotalRow.getCell(1).value = "Subtotal";
    subtotalRow.getCell(1).font = { italic: true };
    // SUM formula for this customer's employees
    if (employeeStartRow < currentRow) {
      subtotalRow.getCell(4).value = {
        formula: `SUM(D${employeeStartRow}:D${currentRow - 1})`,
      };
    } else {
      subtotalRow.getCell(4).value = 0;
    }
    subtotalRow.getCell(4).numFmt = '"$"#,##0.00';
    subtotalRow.getCell(4).font = { italic: true };
    hourlyGrandTotal += customerSubtotal;
    currentRow++;

    // Blank row between customers
    currentRow++;
  }

  // ===== GRAND TOTALS SECTION =====
  // Skip a row
  currentRow++;

  // "Subtotal" row (hourly grand total)
  const subtotalGrandRow = ws.getRow(currentRow);
  subtotalGrandRow.getCell(1).value = "Subtotal";
  subtotalGrandRow.getCell(1).font = { bold: true, size: 11 };
  subtotalGrandRow.getCell(4).value = round2(hourlyGrandTotal);
  subtotalGrandRow.getCell(4).numFmt = '"$"#,##0.00';
  subtotalGrandRow.getCell(4).font = { bold: true };
  currentRow++;

  // "Office" row (admin total)
  const officeRow = ws.getRow(currentRow);
  officeRow.getCell(1).value = "Office";
  officeRow.getCell(1).font = { bold: true, size: 11 };
  officeRow.getCell(4).value = round2(adminGrandTotal);
  officeRow.getCell(4).numFmt = '"$"#,##0.00';
  officeRow.getCell(4).font = { bold: true };
  currentRow++;

  // "Total payroll" row
  const grandTotal = round2(hourlyGrandTotal + adminGrandTotal);
  const totalRow = ws.getRow(currentRow);
  totalRow.getCell(1).value = "Total payroll";
  totalRow.getCell(4).value = grandTotal;
  totalRow.getCell(4).numFmt = '"$"#,##0.00';
  // Highlight total row
  totalRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" }, // Blue
  };
  totalRow.getCell(4).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" }, // Blue
  };
  totalRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  totalRow.getCell(4).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

  // Save file
  const filename = `Payroll_Breakdown_${MONTH}_v2.xlsx`;
  const filepath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filepath);

  console.log(`\n✅ Generated: ${filepath}`);
  console.log(`   Customers: ${sortedCustomers.length}`);
  console.log(`   Hourly Total: $${round2(hourlyGrandTotal)}`);
  console.log(`   Office (Admin) Total: $${round2(adminGrandTotal)}`);
  console.log(`   Grand Total: $${grandTotal}`);

  db.close();
}

main().catch(console.error);

import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { openDb, id as genId } from './db.js';

const db = openDb();

/**
 * Parse a weekly employee export file and extract time entries
 * Weekly exports have format: Date | Client | Hours | Type | Rate | Total
 * @param {string} filePath - Path to the XLSX file
 * @returns {Promise<Array>} Array of parsed time entries
 */
export async function parseWeeklyExport(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const entries = [];
  
  // Get the main sheet (first one, named "Weekly Timesheet")
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('No worksheet found in file');
  }
  
  // Extract employee name from filename (e.g., "Doug_Kinsey_2025-12-29.xlsx")
  const basename = path.basename(filePath, '.xlsx');
  const parts = basename.split('_');
  const weekStart = parts.pop(); // Last part is date
  const employeeName = parts.join(' ').replace(/_/g, ' ');
  
  // Look up employee (check name and aliases_json)
  let employee = db.prepare(`
    SELECT id FROM employees WHERE name = ?
  `).get(employeeName);
  
  // If not found by name, check aliases stored in JSON array
  if (!employee) {
    employee = db.prepare(`
      SELECT id FROM employees WHERE aliases_json LIKE ?
    `).get(`%"${employeeName}"%`);
  }
  
  if (!employee) {
    // Return empty - file from unknown employee
    console.warn(`Employee not found: ${employeeName}`);
    return entries;
  }
  
  // Parse rows - format: Date | Client | Hours | Type | Rate | Total
  let foundHeader = false;
  
  sheet.eachRow((row, rowNumber) => {
    const firstCell = String(row.getCell(1).value || '');
    
    // Skip until we find the header row
    if (firstCell === 'Date') {
      foundHeader = true;
      return;
    }
    
    // Skip until header found
    if (!foundHeader) return;
    
    // Skip summary rows and empty rows
    if (firstCell.startsWith('SUBTOTAL') || firstCell.startsWith('Category:') || !firstCell) return;
    
    // Parse date - could be a Date object or string
    let dateValue = row.getCell(1).value;
    let dateStr;
    if (dateValue instanceof Date) {
      dateStr = dateValue.toISOString().split('T')[0];
    } else if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      dateStr = dateValue.substring(0, 10);
    } else {
      // Skip non-date rows
      return;
    }
    
    // Get customer name (column B)
    let customerName = String(row.getCell(2).value || '').trim();
    if (!customerName) return;
    
    // Strip classification suffixes like "(Insp.)", "(AC)", "(Maint. Items)"
    customerName = customerName.replace(/\s*\([^)]+\)\s*$/, '').trim();
    
    // Get hours (column C)
    const hours = parseFloat(row.getCell(3).value) || 0;
    if (hours <= 0) return;
    
    // Look up customer (case-insensitive)
    let customer = db.prepare(`
      SELECT id, name FROM customers WHERE LOWER(name) = LOWER(?)
    `).get(customerName);
    
    // Also try with common name variations
    if (!customer && customerName.includes('/')) {
      // Try first part of split name like "Leixner/Smith" -> "Leixner"
      customer = db.prepare(`
        SELECT id, name FROM customers WHERE LOWER(name) = LOWER(?)
      `).get(customerName.split('/')[0]);
    }
    
    if (!customer) {
      console.warn(`Customer not found: "${customerName}"`);
      return;
    }
    
    entries.push({
      employee_id: employee.id,
      customer_id: customer.id,
      date: dateStr,
      hours: hours,
      employee_name: employeeName,
      customer_name: customer.name
    });
  });
  
  return entries;
}

/**
 * Import entries from a weekly export into the database
 * @param {string} filePath - Path to XLSX file
 * @param {Object} options - Import options
 * @param {boolean} options.dryRun - If true, don't actually insert
 * @param {boolean} options.replace - If true, delete existing entries for same date/employee/customer
 * @returns {Promise<Object>} Import results
 */
export async function importWeeklyExport(filePath, options = {}) {
  const { dryRun = false, replace = false } = options;
  
  const entries = await parseWeeklyExport(filePath);
  
  const results = {
    file: path.basename(filePath),
    parsed: entries.length,
    inserted: 0,
    skipped: 0,
    replaced: 0,
    errors: []
  };
  
  const insertStmt = db.prepare(`
    INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 'APPROVED', datetime('now'), datetime('now'))
  `);
  
  const checkStmt = db.prepare(`
    SELECT id FROM time_entries 
    WHERE employee_id = ? AND customer_id = ? AND work_date = ?
  `);
  
  const deleteStmt = db.prepare(`
    DELETE FROM time_entries 
    WHERE employee_id = ? AND customer_id = ? AND work_date = ?
  `);
  
  for (const entry of entries) {
    try {
      const existing = checkStmt.get(entry.employee_id, entry.customer_id, entry.date);
      
      if (existing) {
        if (replace) {
          if (!dryRun) {
            deleteStmt.run(entry.employee_id, entry.customer_id, entry.date);
          }
          results.replaced++;
        } else {
          results.skipped++;
          continue;
        }
      }
      
      if (!dryRun) {
        insertStmt.run(genId('te_'), entry.employee_id, entry.customer_id, entry.date, entry.hours);
      }
      results.inserted++;
    } catch (err) {
      results.errors.push(`${entry.date} ${entry.customer_name}: ${err.message}`);
    }
  }
  
  return results;
}

/**
 * Import all weekly exports for a given week
 * @param {string} weekStart - Week start date (YYYY-MM-DD, Monday)
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Aggregated import results
 */
export async function importWeek(weekStart, options = {}) {
  const exportDir = path.join(process.cwd(), 'exports');
  const yearMonth = weekStart.substring(0, 7);
  const weekDir = path.join(exportDir, yearMonth, weekStart);
  
  if (!fs.existsSync(weekDir)) {
    throw new Error(`Week directory not found: ${weekDir}`);
  }
  
  const files = fs.readdirSync(weekDir).filter(f => 
    f.endsWith('.xlsx') && !f.startsWith('Payroll_')
  );
  
  const results = {
    week: weekStart,
    files: files.length,
    totalParsed: 0,
    totalInserted: 0,
    totalSkipped: 0,
    totalReplaced: 0,
    fileResults: []
  };
  
  for (const file of files) {
    const filePath = path.join(weekDir, file);
    const fileResult = await importWeeklyExport(filePath, options);
    results.fileResults.push(fileResult);
    results.totalParsed += fileResult.parsed;
    results.totalInserted += fileResult.inserted;
    results.totalSkipped += fileResult.skipped;
    results.totalReplaced += fileResult.replaced;
  }
  
  return results;
}

/**
 * Import all exports for a given month
 * @param {string} yearMonth - Month (YYYY-MM)
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Aggregated import results
 */
export async function importMonth(yearMonth, options = {}) {
  const exportDir = path.join(process.cwd(), 'exports');
  const monthDir = path.join(exportDir, yearMonth);
  
  if (!fs.existsSync(monthDir)) {
    throw new Error(`Month directory not found: ${monthDir}`);
  }
  
  const weekDirs = fs.readdirSync(monthDir).filter(d => {
    const fullPath = path.join(monthDir, d);
    return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
  });
  
  const results = {
    month: yearMonth,
    weeks: weekDirs.length,
    totalParsed: 0,
    totalInserted: 0,
    totalSkipped: 0,
    totalReplaced: 0,
    weekResults: []
  };
  
  for (const weekDir of weekDirs.sort()) {
    const weekResult = await importWeek(weekDir, options);
    results.weekResults.push(weekResult);
    results.totalParsed += weekResult.totalParsed;
    results.totalInserted += weekResult.totalInserted;
    results.totalSkipped += weekResult.totalSkipped;
    results.totalReplaced += weekResult.totalReplaced;
  }
  
  return results;
}

export default {
  parseWeeklyExport,
  importWeeklyExport,
  importWeek,
  importMonth
};

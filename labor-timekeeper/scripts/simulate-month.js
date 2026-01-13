#!/usr/bin/env node
/**
 * Full Month Simulation Script for Labor Timekeeper
 * Generates realistic time entries for an entire month
 * 
 * Usage:
 *   node scripts/simulate-month.js                    # Generate January 2026
 *   node scripts/simulate-month.js 2026-02            # Generate February 2026
 *   node scripts/simulate-month.js 2026-01 --reset    # Reset DB first
 *   node scripts/simulate-month.js 2026-01 --export   # Also generate exports
 */

import { openDb, id } from "../lib/db.js";
import { generateWeeklyExports } from "../lib/export/generateWeekly.js";
import { generateMonthlyExport } from "../lib/export/generateMonthly.js";
import { getHolidaysInRange } from "../lib/holidays.js";

const args = process.argv.slice(2);
const MONTH = args.find(a => /^\d{4}-\d{2}$/.test(a)) || "2026-01";
const RESET = args.includes("--reset");
const EXPORT = args.includes("--export");

const db = openDb();

// Employee work patterns - realistic hours per week
const EMPLOYEE_PATTERNS = [
  // Admins - varied schedules, multiple customers per day sometimes
  { name: "Chris Jacobi", avgHoursPerDay: 8, variance: 2, daysPerWeek: 5 },
  { name: "Chris Zavesky", avgHoursPerDay: 8, variance: 2, daysPerWeek: 5 },
  
  // Hourly employees - full schedules, likely to hit OT
  { name: "Doug Kinsey", avgHoursPerDay: 9, variance: 2, daysPerWeek: 5 },
  { name: "Boban Abbate", avgHoursPerDay: 8, variance: 2, daysPerWeek: 4 },
];

// Customer distribution - weighted by likelihood of being selected
const CUSTOMER_WEIGHTS = {
  "McGill": 15,
  "Hall": 12,
  "Hopkins": 10,
  "Welles": 8,
  "Smith": 8,
  "Jones": 7,
  "Davis": 7,
  "Campbell": 6,
  "Hunter": 6,
  "Keevil": 5,
  "Lucas": 5,
  "Lynn": 5,
  "Moulton": 4,
  "O'Connor": 4,
  "Patton": 4,
  "Regan": 4,
  "Walsh": 3,
  "Ward": 3,
};

async function main() {
  console.log("=".repeat(60));
  console.log("Labor Timekeeper - Full Month Simulation");
  console.log("=".repeat(60));
  console.log(`Month: ${MONTH}`);
  console.log(`Options: RESET=${RESET}, EXPORT=${EXPORT}`);
  console.log();

  // Calculate month date range
  const [year, monthNum] = MONTH.split("-").map(Number);
  const firstDay = new Date(year, monthNum - 1, 1);
  const lastDay = new Date(year, monthNum, 0); // Last day of month
  const monthStart = formatYmd(firstDay);
  const monthEnd = formatYmd(lastDay);
  
  console.log(`Date Range: ${monthStart} to ${monthEnd}`);
  console.log(`Days in month: ${lastDay.getDate()}`);
  console.log();

  // Get holidays in this month
  const holidays = getHolidaysInRange(monthStart, monthEnd);
  const holidayDates = new Set(holidays.map(h => h.date));
  console.log(`Holidays in ${MONTH}:`);
  holidays.forEach(h => console.log(`  • ${h.date}: ${h.name}`));
  if (holidays.length === 0) console.log("  (none)");
  console.log();

  // Reset if requested
  if (RESET) {
    console.log("[RESET] Clearing time entries for this month...");
    const nextMonth = monthNum === 12 
      ? `${year + 1}-01-01` 
      : `${year}-${String(monthNum + 1).padStart(2, "0")}-01`;
    db.prepare("DELETE FROM time_entries WHERE work_date >= ? AND work_date < ?")
      .run(monthStart, nextMonth);
    console.log("[RESET] Done.\n");
  }

  // Load employees and customers
  const employees = db.prepare("SELECT * FROM employees").all();
  const customers = db.prepare("SELECT * FROM customers").all();
  
  const empMap = new Map(employees.map(e => [e.name, e]));
  const custMap = new Map(customers.map(c => [c.name, c]));
  
  // Build weighted customer list
  const weightedCustomers = [];
  for (const [name, weight] of Object.entries(CUSTOMER_WEIGHTS)) {
    const cust = custMap.get(name);
    if (cust) {
      for (let i = 0; i < weight; i++) {
        weightedCustomers.push(cust);
      }
    }
  }
  // Add remaining customers with weight 1
  for (const cust of customers) {
    if (!CUSTOMER_WEIGHTS[cust.name]) {
      weightedCustomers.push(cust);
    }
  }

  console.log(`Loaded ${employees.length} employees, ${customers.length} customers`);
  console.log();

  // Generate entries for each employee
  let totalEntries = 0;
  let totalHours = 0;

  for (const pattern of EMPLOYEE_PATTERNS) {
    const emp = empMap.get(pattern.name);
    if (!emp) {
      console.log(`[SKIP] Employee not found: ${pattern.name}`);
      continue;
    }

    console.log(`[${pattern.name}] Generating entries...`);
    
    let empEntries = 0;
    let empHours = 0;
    
    // Iterate through each day of the month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, monthNum - 1, day);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      const dateYmd = formatYmd(date);
      
      // Skip weekends
      if (dow === 0 || dow === 6) continue;
      
      // Skip holidays (unless occasional work)
      if (holidayDates.has(dateYmd)) {
        // 20% chance of working on holiday
        if (Math.random() > 0.2) continue;
      }
      
      // Random chance of working this day based on pattern
      const workChance = pattern.daysPerWeek / 5;
      if (Math.random() > workChance) continue;
      
      // Calculate hours for this day
      const variance = (Math.random() - 0.5) * 2 * pattern.variance;
      const hours = Math.max(4, Math.min(12, Math.round((pattern.avgHoursPerDay + variance) * 2) / 2));
      
      // Pick a random customer (weighted)
      const customer = weightedCustomers[Math.floor(Math.random() * weightedCustomers.length)];
      
      // Check if entry exists
      const existing = db.prepare(`
        SELECT id FROM time_entries 
        WHERE employee_id = ? AND customer_id = ? AND work_date = ?
      `).get(emp.id, customer.id, dateYmd);
      
      if (existing) continue;
      
      // Create entry (directly as APPROVED for export testing)
      db.prepare(`
        INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', datetime('now'), datetime('now'))
      `).run(id("te_"), emp.id, customer.id, dateYmd, hours, "", );
      
      empEntries++;
      empHours += hours;
    }
    
    console.log(`  Created ${empEntries} entries, ${empHours} hours`);
    totalEntries += empEntries;
    totalHours += empHours;
  }

  console.log();
  console.log(`[TOTAL] Generated ${totalEntries} entries, ${totalHours} hours`);
  console.log();

  // Run exports if requested
  if (EXPORT) {
    console.log("[EXPORT] Generating XLSX exports...\n");
    
    // Get all unique week starts in this month
    const weekStarts = new Set();
    let current = new Date(firstDay);
    while (current <= lastDay) {
      const ws = getWeekStart(formatYmd(current));
      weekStarts.add(ws);
      current.setDate(current.getDate() + 7);
    }
    
    // Generate weekly exports
    console.log("--- Weekly Exports ---");
    for (const weekStart of [...weekStarts].sort()) {
      try {
        const result = await generateWeeklyExports({ db, weekStart });
        if (result.files.length > 0) {
          console.log(`\n${weekStart}:`);
          console.log(`  ${result.files.length} files in ${result.outputDir}`);
          result.files.forEach(f => {
            console.log(`    • ${f.filename}: ${f.hours}hrs ($${f.amount})`);
          });
        }
      } catch (err) {
        console.log(`  ${weekStart}: (no approved entries)`);
      }
    }
    console.log();
    
    // Generate monthly export
    console.log("--- Monthly Export ---");
    const monthResult = await generateMonthlyExport({ db, month: MONTH });
    console.log(`Generated: ${monthResult.filename}`);
    console.log(`Path: ${monthResult.filepath}`);
    console.log(`Totals:`);
    console.log(`  Customers: ${monthResult.totals.customers}`);
    console.log(`  Employees: ${monthResult.totals.employees}`);
    console.log(`  Hourly Total: $${monthResult.totals.hourlyTotal}`);
    console.log(`  Admin Total: $${monthResult.totals.adminTotal}`);
    console.log(`  Grand Total: $${monthResult.totals.grandTotal}`);
    console.log();
  }

  // Summary
  const counts = db.prepare(`
    SELECT status, COUNT(*) as cnt, SUM(hours) as hours FROM time_entries 
    WHERE work_date >= ? AND work_date <= ?
    GROUP BY status
  `).all(monthStart, monthEnd);
  
  console.log("[SUMMARY] Time Entries for " + MONTH + ":");
  counts.forEach(c => console.log(`  ${c.status}: ${c.cnt} entries, ${c.hours} hours`));
  
  console.log("\n" + "=".repeat(60));
  console.log("Simulation complete!");
  console.log("=".repeat(60));
}

// Helper: get Monday of the week for a date
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

main().catch(err => {
  console.error("Simulation failed:", err);
  process.exit(1);
});

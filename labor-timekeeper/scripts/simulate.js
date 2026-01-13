#!/usr/bin/env node
/**
 * Simulation Script for Labor Timekeeper
 * Generates sample time entries and runs the export pipeline
 * 
 * Usage:
 *   npm run simulate                    # Generate and export
 *   npm run simulate -- --reset         # Reset DB first
 *   npm run simulate -- --submit        # Auto-submit entries
 *   npm run simulate -- --approve       # Auto-approve entries
 *   npm run simulate -- --reset --submit --approve  # Full pipeline
 */

import { openDb, id } from "../lib/db.js";
import { weekStartYMD, todayYMD } from "../lib/time.js";
import { generateWeeklyExports } from "../lib/export/generateWeekly.js";
import { generateMonthlyExport } from "../lib/export/generateMonthly.js";
import { getHolidaysForYear } from "../lib/holidays.js";

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const SUBMIT = args.includes("--submit");
const APPROVE = args.includes("--approve");

const db = openDb();

// Sample data for simulation - using actual seeded customers
const SAMPLE_ENTRIES = [
  // Chris Jacobi - Admin (no OT)
  { employee: "Chris Jacobi", customer: "McGill", hours: 8, dayOffset: 0 },
  { employee: "Chris Jacobi", customer: "Hall", hours: 8, dayOffset: 1 },
  { employee: "Chris Jacobi", customer: "McGill", hours: 8, dayOffset: 2 },
  { employee: "Chris Jacobi", customer: "Bryan", hours: 10, dayOffset: 3 },
  { employee: "Chris Jacobi", customer: "McGill", hours: 8, dayOffset: 4 },
  
  // Chris Z - Admin (no OT)
  { employee: "Chris Z", customer: "Hall", hours: 9, dayOffset: 0 },
  { employee: "Chris Z", customer: "Bryan", hours: 8, dayOffset: 1 },
  { employee: "Chris Z", customer: "McGill", hours: 7, dayOffset: 2 },
  { employee: "Chris Z", customer: "Hall", hours: 8, dayOffset: 3 },
  { employee: "Chris Z", customer: "Bryan", hours: 10, dayOffset: 4 },
  
  // Doug Kinsey - Hourly (gets OT)
  { employee: "Doug Kinsey", customer: "McGill", hours: 10, dayOffset: 0 },
  { employee: "Doug Kinsey", customer: "Hall", hours: 10, dayOffset: 1 },
  { employee: "Doug Kinsey", customer: "Bryan", hours: 10, dayOffset: 2 },
  { employee: "Doug Kinsey", customer: "McGill", hours: 10, dayOffset: 3 },
  { employee: "Doug Kinsey", customer: "Hall", hours: 8, dayOffset: 4 }, // 48 total -> 8 OT
  
  // Jafid Osorio - Hourly
  { employee: "Jafid Osorio", customer: "Bryan", hours: 8, dayOffset: 0 },
  { employee: "Jafid Osorio", customer: "McGill", hours: 8, dayOffset: 1 },
  { employee: "Jafid Osorio", customer: "Hall", hours: 8, dayOffset: 2 },
  { employee: "Jafid Osorio", customer: "Bryan", hours: 8, dayOffset: 3 },
  { employee: "Jafid Osorio", customer: "McGill", hours: 8, dayOffset: 4 }, // 40 total, no OT
];

async function main() {
  console.log("=".repeat(60));
  console.log("Labor Timekeeper - Simulation Script");
  console.log("=".repeat(60));
  console.log(`Options: RESET=${RESET}, SUBMIT=${SUBMIT}, APPROVE=${APPROVE}`);
  console.log();

  // Get current week info
  const weekStart = weekStartYMD();
  const today = todayYMD();
  const month = today.slice(0, 7);
  
  console.log(`Week Start: ${weekStart}`);
  console.log(`Today: ${today}`);
  console.log(`Month: ${month}`);
  console.log();

  // Reset if requested
  if (RESET) {
    console.log("[RESET] Clearing existing time entries...");
    db.prepare("DELETE FROM time_entries").run();
    console.log("[RESET] Done.\n");
  }

  // Generate sample entries
  console.log("[GENERATE] Creating sample time entries...");
  
  const employees = db.prepare("SELECT * FROM employees").all();
  const customers = db.prepare("SELECT * FROM customers").all();
  
  const empMap = new Map(employees.map(e => [e.name, e]));
  const custMap = new Map(customers.map(c => [c.name, c]));
  
  let created = 0;
  for (const entry of SAMPLE_ENTRIES) {
    const emp = empMap.get(entry.employee);
    const cust = custMap.get(entry.customer);
    
    if (!emp || !cust) {
      console.log(`  [SKIP] Missing emp=${entry.employee} or cust=${entry.customer}`);
      continue;
    }
    
    // Calculate work date based on week start + offset
    const [y, m, d] = weekStart.split("-").map(Number);
    const workDate = new Date(y, m - 1, d + entry.dayOffset);
    const workDateYmd = formatYmd(workDate);
    
    // Check if entry already exists
    const existing = db.prepare(`
      SELECT id FROM time_entries 
      WHERE employee_id = ? AND customer_id = ? AND work_date = ?
    `).get(emp.id, cust.id, workDateYmd);
    
    if (existing) {
      console.log(`  [SKIP] Entry exists: ${entry.employee} @ ${entry.customer} on ${workDateYmd}`);
      continue;
    }
    
    const status = APPROVE ? "APPROVED" : (SUBMIT ? "SUBMITTED" : "DRAFT");
    
    db.prepare(`
      INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(id("te_"), emp.id, cust.id, workDateYmd, entry.hours, "", status);
    
    created++;
    console.log(`  [CREATE] ${entry.employee} @ ${entry.customer}: ${entry.hours}hrs on ${workDateYmd} [${status}]`);
  }
  
  console.log(`[GENERATE] Created ${created} entries.\n`);

  // Show holidays for reference
  const year = parseInt(today.slice(0, 4), 10);
  const holidays = getHolidaysForYear(year);
  console.log(`[HOLIDAYS] ${year}:`);
  holidays.forEach(h => console.log(`  • ${h.date}: ${h.name}`));
  console.log();

  // If entries are approved, run exports
  if (APPROVE) {
    console.log("[EXPORT] Generating XLSX exports...\n");
    
    // Weekly exports
    console.log("--- Weekly Exports ---");
    const weekResult = await generateWeeklyExports({ db, weekStart });
    console.log(`Generated ${weekResult.files.length} files in ${weekResult.outputDir}`);
    weekResult.files.forEach(f => {
      console.log(`  • ${f.filename}: ${f.hours}hrs ($${f.amount}) [${f.category}]`);
    });
    console.log(`Totals: ${weekResult.totals.totalHours}hrs = $${weekResult.totals.totalAmount}`);
    console.log();
    
    // Monthly export
    console.log("--- Monthly Export ---");
    const monthResult = await generateMonthlyExport({ db, month });
    console.log(`Generated: ${monthResult.filename}`);
    console.log(`Grand Total: $${monthResult.totals.grandTotal}`);
    console.log();
  } else {
    console.log("[INFO] Run with --approve to generate exports.\n");
  }

  // Summary
  const counts = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM time_entries GROUP BY status
  `).all();
  
  console.log("[SUMMARY] Time Entry Status:");
  counts.forEach(c => console.log(`  ${c.status}: ${c.cnt}`));
  
  console.log("\n" + "=".repeat(60));
  console.log("Simulation complete!");
  console.log("=".repeat(60));
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

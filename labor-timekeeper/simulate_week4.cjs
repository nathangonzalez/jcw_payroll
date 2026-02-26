/**
 * Simulate Week 4 (Feb 18-24) entries for all employees
 * Based on actual patterns from weeks 1-3
 * Uses cloned prod DB - no impact to production
 */
const Database = require('better-sqlite3');
const db = new Database('data/test_clone.db');

const WEEK4_START = '2026-02-18';
const WEEK4_END = '2026-02-24';
const WEEK4_DATES = ['2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-23','2026-02-24'];
// Feb 22 is Sunday - skip

// Get all employees
const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();

// Get week 3 entries as template (most recent complete week)
function getWeek3Pattern(empId) {
  return db.prepare(`
    SELECT te.*, c.name as customer_name 
    FROM time_entries te
    JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ? AND te.work_date >= '2026-02-11' AND te.work_date <= '2026-02-17'
    ORDER BY te.work_date
  `).all(empId);
}

// Check existing week 4 entries
function getExistingWeek4(empId) {
  return db.prepare(`
    SELECT te.*, c.name as customer_name 
    FROM time_entries te
    JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ? AND te.work_date >= ? AND te.work_date <= ?
    ORDER BY te.work_date
  `).all(empId, WEEK4_START, WEEK4_END);
}

const insert = db.prepare(`
  INSERT INTO time_entries (employee_id, customer_id, work_date, hours, status, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'SUBMITTED', ?, datetime('now'), datetime('now'))
`);

let totalInserted = 0;
let totalSkipped = 0;

console.log('=== Simulating Week 4 Entries ===\n');

for (const emp of employees) {
  const existing = getExistingWeek4(emp.id);
  const existingKeys = new Set(existing.map(e => `${e.work_date}|${e.customer_id}`));
  const pattern = getWeek3Pattern(emp.id);
  
  if (pattern.length === 0) {
    console.log(`${emp.name}: No week 3 pattern - skipping`);
    continue;
  }
  
  // Map week 3 dates to week 4 dates (shift by 7 days)
  const dayMap = {};
  const w3Dates = [...new Set(pattern.map(e => e.work_date))].sort();
  const w4Dates = WEEK4_DATES.slice(0, w3Dates.length);
  w3Dates.forEach((d, i) => {
    if (i < w4Dates.length) dayMap[d] = w4Dates[i];
  });
  
  let empInserted = 0;
  let empHours = 0;
  
  for (const entry of pattern) {
    const newDate = dayMap[entry.work_date];
    if (!newDate) continue;
    if (existingKeys.has(`${newDate}|${entry.customer_id}`)) {
      totalSkipped++;
      continue;
    }
    
    // Vary hours slightly (+/- 0.5h randomly)
    let hours = Number(entry.hours);
    const variance = (Math.random() - 0.5); // -0.5 to +0.5
    hours = Math.round((hours + variance) * 2) / 2; // round to 0.5
    hours = Math.max(0.5, Math.min(12, hours));
    
    const isLunch = entry.customer_name.toLowerCase().includes('lunch');
    if (isLunch) hours = 0.5; // Keep lunch consistent
    
    try {
      insert.run(emp.id, entry.customer_id, newDate, hours, `Simulated from week 3 pattern`);
      empInserted++;
      if (!isLunch) empHours += hours;
      existingKeys.add(`${newDate}|${entry.customer_id}`); // prevent duplicates within same run
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  totalInserted += empInserted;
  const otFlag = empHours > 40 ? '⚠️ OT!' : '';
  console.log(`${emp.name}: +${empInserted} entries, ${empHours}h work ${otFlag}`);
}

console.log(`\n=== Summary ===`);
console.log(`Inserted: ${totalInserted} entries`);
console.log(`Skipped (already existed): ${totalSkipped}`);

// Verify week 4 totals
console.log('\n=== Week 4 Final Totals ===');
const totals = db.prepare(`
  SELECT e.name, 
    SUM(CASE WHEN c.name != 'Lunch' THEN te.hours ELSE 0 END) as work_hours,
    SUM(CASE WHEN c.name = 'Lunch' THEN te.hours ELSE 0 END) as lunch_hours,
    COUNT(*) as entries,
    GROUP_CONCAT(DISTINCT te.status) as statuses
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
  GROUP BY e.name
  ORDER BY e.name
`).all();

totals.forEach(t => {
  const ot = t.work_hours > 40 ? `⚠️ OT: ${(t.work_hours - 40).toFixed(1)}h` : '';
  console.log(`  ${t.name.padEnd(20)} | ${t.work_hours}h work | ${t.lunch_hours}h lunch | ${t.entries} entries | ${t.statuses} ${ot}`);
});

db.close();
console.log('\nDone! Test DB updated at data/test_clone.db');

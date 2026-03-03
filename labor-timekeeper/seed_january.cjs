/**
 * Seed January 2026 entries from PDF payroll reports (source of truth)
 * 
 * PDFs: Batch 904 (12/30), 727 (1/6), 730 (1/14), 732 (1/21)
 * Derives exact hours from gross wages using known pay rates
 */
const Database = require('better-sqlite3');
const db = new Database('data/test_clone.db');

// Pay rates from PDFs
const RATES = {
  'Boban Abbate': 42.50,
  'Thomas Brinson': 35.00,
  'Jason Green': 35.00,
  'Phil Henderson': 30.00,
  'Doug Kinsey': 30.00,
  'Sean Matthew': 20.00,
};

// PDF gross wages per week
const PDF_DATA = [
  { 
    name: 'Week Dec 30', weekStart: '2025-12-29', dates: ['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02'],
    wages: { 'Boban Abbate': 1700, 'Thomas Brinson': 1400, 'Jason Green': 1400, 'Phil Henderson': 1200, 'Doug Kinsey': 1200, 'Sean Matthew': 800 }
  },
  {
    name: 'Week Jan 6', weekStart: '2026-01-05', dates: ['2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09'],
    wages: { 'Boban Abbate': 1700, 'Thomas Brinson': 1426.25, 'Jason Green': 1400, 'Phil Henderson': 1200, 'Doug Kinsey': 1200, 'Sean Matthew': 480 }
  },
  {
    name: 'Week Jan 14', weekStart: '2026-01-12', dates: ['2026-01-12','2026-01-13','2026-01-14','2026-01-15','2026-01-16'],
    wages: { 'Boban Abbate': 1700, 'Thomas Brinson': 1465.63, 'Jason Green': 1400, 'Phil Henderson': 1290, 'Doug Kinsey': 1211.25, 'Sean Matthew': 795 }
  },
  {
    name: 'Week Jan 21', weekStart: '2026-01-19', dates: ['2026-01-19','2026-01-20','2026-01-21','2026-01-22','2026-01-23'],
    wages: { 'Boban Abbate': 1700, 'Thomas Brinson': 1505, 'Jason Green': 1400, 'Phil Henderson': 1200, 'Doug Kinsey': 1185, 'Sean Matthew': 740 }
  }
];

// Derive hours from gross wages
function hoursFromGross(gross, rate) {
  const otRate = rate * 1.5;
  if (gross <= rate * 40) {
    return { total: gross / rate, regular: gross / rate, ot: 0 };
  }
  const regularPay = rate * 40;
  const otPay = gross - regularPay;
  const otHours = otPay / otRate;
  return { total: 40 + otHours, regular: 40, ot: otHours };
}

// Distribute hours across workdays
function distributeHours(totalHours, numDays) {
  const baseHours = Math.floor(totalHours / numDays * 2) / 2; // round to 0.5
  const result = Array(numDays).fill(baseHours);
  let remaining = totalHours - result.reduce((a, b) => a + b, 0);
  // Add remaining to last day
  result[result.length - 1] = Math.round((result[result.length - 1] + remaining) * 2) / 2;
  return result;
}

// Get employee IDs
const employees = db.prepare('SELECT id, name FROM employees').all();
const empMap = {};
employees.forEach(e => { empMap[e.name] = e.id; });

// Get a customer for each employee (use their most common customer from Feb data)
const custMap = {};
for (const [name, id] of Object.entries(empMap)) {
  if (!RATES[name]) continue;
  const topCust = db.prepare(`
    SELECT c.id, c.name, COUNT(*) as cnt
    FROM time_entries te JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ? AND c.name != 'Lunch'
    GROUP BY c.id ORDER BY cnt DESC LIMIT 1
  `).get(id);
  custMap[name] = topCust ? topCust.id : null;
}

// Get lunch customer ID
const lunchCust = db.prepare("SELECT id FROM customers WHERE LOWER(name) = 'lunch'").get();

const insert = db.prepare(`
  INSERT INTO time_entries (employee_id, customer_id, work_date, hours, status, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'APPROVED', ?, datetime('now'), datetime('now'))
`);

// Clear existing January entries
const deleted = db.prepare(`
  DELETE FROM time_entries WHERE work_date >= '2025-12-29' AND work_date <= '2026-01-23'
`).run();
console.log(`Cleared ${deleted.changes} existing January entries\n`);

let totalInserted = 0;

for (const week of PDF_DATA) {
  console.log(`=== ${week.name} (${week.weekStart}) ===`);
  
  for (const [empName, gross] of Object.entries(week.wages)) {
    const rate = RATES[empName];
    const empId = empMap[empName];
    const custId = custMap[empName];
    
    if (!empId || !custId) {
      console.log(`  ${empName}: skipped (no ID)`);
      continue;
    }
    
    const { total, regular, ot } = hoursFromGross(gross, rate);
    const dailyHours = distributeHours(total, week.dates.length);
    
    let weekInserted = 0;
    for (let i = 0; i < week.dates.length; i++) {
      const date = week.dates[i];
      const hours = dailyHours[i];
      if (hours <= 0) continue;
      
      // Insert work entry
      insert.run(empId, custId, date, hours, `Seeded from PDF: $${gross} gross`);
      weekInserted++;
      
      // Add lunch (0.5h) for days with 8+ hours
      if (hours >= 8 && lunchCust) {
        insert.run(empId, lunchCust.id, date, 0.5, 'Lunch break');
        weekInserted++;
      }
    }
    
    totalInserted += weekInserted;
    const otFlag = ot > 0 ? ` ⚠️ ${ot.toFixed(1)}h OT` : '';
    console.log(`  ${empName.padEnd(20)} $${gross.toFixed(2).padStart(8)} → ${total.toFixed(1)}h (${regular}h reg${otFlag}) | ${weekInserted} entries`);
  }
  console.log();
}

console.log(`\n=== Total: ${totalInserted} entries seeded ===`);

// Verify totals
console.log('\n=== January Verification ===');
const janTotals = db.prepare(`
  SELECT e.name,
    SUM(CASE WHEN c.name != 'Lunch' THEN te.hours ELSE 0 END) as work_hours,
    COUNT(*) as entries
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date >= '2025-12-29' AND te.work_date <= '2026-01-23'
  GROUP BY e.name ORDER BY e.name
`).all();

janTotals.forEach(t => {
  const rate = RATES[t.name] || 0;
  const regularHours = Math.min(t.work_hours, 160); // 4 weeks × 40h
  console.log(`  ${t.name.padEnd(20)} | ${t.work_hours.toFixed(1)}h total | ${t.entries} entries | ~$${(t.work_hours * rate).toFixed(2)} gross`);
});

db.close();

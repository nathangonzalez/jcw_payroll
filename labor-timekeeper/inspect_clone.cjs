const Database = require('better-sqlite3');
const db = new Database('data/test_clone.db', { readonly: true });

console.log('=== DB Stats ===');
const stats = {
  employees: db.prepare('SELECT COUNT(*) as n FROM employees').get().n,
  customers: db.prepare('SELECT COUNT(*) as n FROM customers').get().n,
  entries: db.prepare('SELECT COUNT(*) as n FROM time_entries').get().n,
};
console.log(stats);

console.log('\n=== Employees ===');
const emps = db.prepare('SELECT id, name, default_bill_rate FROM employees ORDER BY name').all();
emps.forEach(e => console.log(`  ${e.id}: ${e.name} (bill: $${e.default_bill_rate})`));

console.log('\n=== Entries by Week ===');
const weeks = db.prepare(`
  SELECT 
    CASE
      WHEN work_date >= '2026-01-28' AND work_date <= '2026-02-03' THEN 'Week 1 (1/28-2/3)'
      WHEN work_date >= '2026-02-04' AND work_date <= '2026-02-10' THEN 'Week 2 (2/4-2/10)'
      WHEN work_date >= '2026-02-11' AND work_date <= '2026-02-17' THEN 'Week 3 (2/11-2/17)'
      WHEN work_date >= '2026-02-18' AND work_date <= '2026-02-24' THEN 'Week 4 (2/18-2/24)'
      ELSE 'Other'
    END as week,
    COUNT(*) as entries,
    COUNT(DISTINCT employee_id) as employees,
    SUM(hours) as total_hours,
    GROUP_CONCAT(DISTINCT status) as statuses
  FROM time_entries
  WHERE work_date >= '2026-01-28'
  GROUP BY week
  ORDER BY week
`).all();
weeks.forEach(w => console.log(`  ${w.week}: ${w.entries} entries, ${w.employees} emps, ${w.total_hours}h [${w.statuses}]`));

console.log('\n=== Phil Henderson - All Entries ===');
const phil = db.prepare("SELECT id FROM employees WHERE name LIKE '%Phil Henderson%'").get();
if (phil) {
  const philEntries = db.prepare(`
    SELECT te.work_date, c.name as customer, te.hours, te.status, te.notes
    FROM time_entries te
    JOIN customers c ON c.id = te.customer_id
    WHERE te.employee_id = ?
    ORDER BY te.work_date, c.name
  `).all(phil.id);
  
  let weekTotal = 0;
  let currentWeek = '';
  philEntries.forEach(e => {
    const week = e.work_date <= '2026-02-03' ? 'W1' : 
                 e.work_date <= '2026-02-10' ? 'W2' : 
                 e.work_date <= '2026-02-17' ? 'W3' : 'W4';
    if (week !== currentWeek) {
      if (currentWeek) console.log(`  --- ${currentWeek} total: ${weekTotal}h ${weekTotal > 40 ? '⚠️ OT!' : ''}`);
      currentWeek = week;
      weekTotal = 0;
    }
    const isLunch = e.customer.toLowerCase().includes('lunch');
    if (!isLunch) weekTotal += Number(e.hours);
    console.log(`  ${e.work_date} | ${e.customer.padEnd(30)} | ${e.hours}h | ${e.status} ${isLunch ? '(lunch)' : ''}`);
  });
  if (currentWeek) console.log(`  --- ${currentWeek} total: ${weekTotal}h ${weekTotal > 40 ? '⚠️ OT!' : ''}`);
} else {
  console.log('  Phil Henderson not found!');
}

db.close();

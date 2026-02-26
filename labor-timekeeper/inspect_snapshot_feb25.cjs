const Database = require('better-sqlite3');
const db = new Database('./data/snapshot_feb25.db', { readonly: true });

console.log('=== SNAPSHOT INSPECTION (Feb 25 daily) ===\n');

// Overall counts
const stats = {
  entries: db.prepare('SELECT COUNT(*) as n FROM time_entries').get().n,
  approved: db.prepare("SELECT COUNT(*) as n FROM time_entries WHERE status='APPROVED'").get().n,
  submitted: db.prepare("SELECT COUNT(*) as n FROM time_entries WHERE status='SUBMITTED'").get().n,
  draft: db.prepare("SELECT COUNT(*) as n FROM time_entries WHERE status='DRAFT'").get().n,
  customers: db.prepare('SELECT COUNT(*) as n FROM customers').get().n,
  employees: db.prepare('SELECT COUNT(*) as n FROM employees').get().n,
};
console.log('Stats:', JSON.stringify(stats, null, 2));

// Entries by employee for week of Feb 18
console.log('\n=== Week of Feb 18 entries by employee ===');
const weekEntries = db.prepare(`
  SELECT e.name, COUNT(*) as count, SUM(te.hours) as total_hours, te.status
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  WHERE te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
  GROUP BY e.name, te.status
  ORDER BY e.name
`).all();
for (const r of weekEntries) {
  console.log(`  ${r.name}: ${r.count} entries, ${r.total_hours}h (${r.status})`);
}

// Chris Zavesky specifically
console.log('\n=== Chris Zavesky entries (Feb 18-24) ===');
const chrisZ = db.prepare(`
  SELECT te.work_date, te.hours, c.name as customer, te.notes, te.status
  FROM time_entries te
  JOIN customers c ON c.id = te.customer_id
  JOIN employees e ON e.id = te.employee_id
  WHERE e.name = 'Chris Zavesky' AND te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
  ORDER BY te.work_date
`).all();
if (chrisZ.length === 0) console.log('  (NONE)');
for (const r of chrisZ) {
  console.log(`  ${r.work_date} | ${r.hours}h | ${r.customer} | ${r.notes} | ${r.status}`);
}

// Jason Green specifically
console.log('\n=== Jason Green entries (Feb 18-24) ===');
const jason = db.prepare(`
  SELECT te.work_date, te.hours, c.name as customer, te.notes, te.status
  FROM time_entries te
  JOIN customers c ON c.id = te.customer_id
  JOIN employees e ON e.id = te.employee_id
  WHERE e.name = 'Jason Green' AND te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
  ORDER BY te.work_date
`).all();
if (jason.length === 0) console.log('  (NONE)');
for (const r of jason) {
  console.log(`  ${r.work_date} | ${r.hours}h | ${r.customer} | ${r.notes} | ${r.status}`);
}

// Phil Henderson specifically
console.log('\n=== Phil Henderson entries (Feb 18-24) ===');
const phil = db.prepare(`
  SELECT te.work_date, te.hours, c.name as customer, te.notes, te.status
  FROM time_entries te
  JOIN customers c ON c.id = te.customer_id
  JOIN employees e ON e.id = te.employee_id
  WHERE e.name = 'Phil Henderson' AND te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
  ORDER BY te.work_date
`).all();
if (phil.length === 0) console.log('  (NONE)');
for (const r of phil) {
  console.log(`  ${r.work_date} | ${r.hours}h | ${r.customer} | ${r.notes} | ${r.status}`);
}

db.close();

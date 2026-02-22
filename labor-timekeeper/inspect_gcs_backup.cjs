const Database = require('better-sqlite3');
const db = new Database('data/gcs_backup_2026-02-20.db', { readonly: true });

console.log('=== GCS Backup 2026-02-20 ===');

const empCount = db.prepare('SELECT COUNT(*) as n FROM employees').get();
console.log('Employees:', empCount.n);

const custCount = db.prepare('SELECT COUNT(*) as n FROM customers').get();
console.log('Customers:', custCount.n);

const total = db.prepare('SELECT COUNT(*) as n, SUM(hours) as hours FROM time_entries').get();
console.log('Entries:', total.n, 'hours:', total.hours);

const byWeek = db.prepare(`
  SELECT 
    CASE 
      WHEN work_date BETWEEN '2026-01-28' AND '2026-02-03' THEN 'Week1'
      WHEN work_date BETWEEN '2026-02-04' AND '2026-02-10' THEN 'Week2'
      WHEN work_date BETWEEN '2026-02-11' AND '2026-02-17' THEN 'Week3'
      WHEN work_date BETWEEN '2026-02-18' AND '2026-02-24' THEN 'Week4'
      ELSE 'Other'
    END as week,
    COUNT(*) as n,
    SUM(hours) as hours
  FROM time_entries
  GROUP BY week
  ORDER BY week
`).all();
console.log('\nBy week:');
byWeek.forEach(r => console.log(`  ${r.week}: ${r.n} entries, ${r.hours}h`));

db.close();

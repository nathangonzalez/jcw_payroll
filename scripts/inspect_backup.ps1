$ErrorActionPreference = 'Continue'
Set-Location c:\Users\natha\dev\repos\jcw_payroll\labor-timekeeper
node -e "
const Database = require('better-sqlite3');
const db = new Database('..\\data\\backups\\snapshot_2026-02-20.db', { readonly: true });
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
const empCount = db.prepare('SELECT COUNT(*) as n FROM employees').get();
console.log('Employees:', empCount.n);
const custCount = db.prepare('SELECT COUNT(*) as n FROM customers').get();
console.log('Customers:', custCount.n);
const byStatus = db.prepare('SELECT status, COUNT(*) as n, SUM(hours) as hours FROM time_entries GROUP BY status').all();
console.log('By status:', JSON.stringify(byStatus, null, 2));
const byWeek = db.prepare(\`
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
\`).all();
console.log('By week:', JSON.stringify(byWeek, null, 2));
db.close();
"
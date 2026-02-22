const Database = require('better-sqlite3');
const files = [
  './data/gcs_backup_2026-02-20.db',
  './data/snapshot_2026-02-20.db',
];

for (const f of files) {
  console.log('\n===', f, '===');
  const db = new Database(f, { readonly: true });
  const total = db.prepare('SELECT COUNT(*) as n FROM time_entries').get();
  console.log('Total entries:', total.n);
  
  const rows = db.prepare(`
    SELECT e.name as emp, c.name as cust, te.work_date, te.hours, te.status
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= '2026-02-18'
    ORDER BY te.work_date, e.name
  `).all();
  
  console.log('Current week (2/18+) entries:', rows.length);
  rows.forEach(r => console.log(' ', r.work_date, r.emp, r.cust, r.hours + 'h', r.status));
  db.close();
}

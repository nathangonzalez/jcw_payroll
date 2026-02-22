import Database from 'better-sqlite3';

// Check both snapshots for current week entries
const files = [
  './labor-timekeeper/data/gcs_backup_2026-02-20.db',
  './labor-timekeeper/data/snapshot_2026-02-20.db',
];

for (const f of files) {
  console.log(`\n=== ${f} ===`);
  try {
    const db = new Database(f, { readonly: true });
    
    // Total entries
    const total = db.prepare('SELECT COUNT(*) as n FROM time_entries').get();
    console.log(`Total entries: ${total.n}`);
    
    // Current week entries (2/18+)
    const currentWeek = db.prepare(`
      SELECT e.name as emp, c.name as cust, te.work_date, te.hours, te.status, te.notes
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      JOIN customers c ON c.id = te.customer_id
      WHERE te.work_date >= '2026-02-18'
      ORDER BY te.work_date, e.name
    `).all();
    
    console.log(`Current week (2/18+) entries: ${currentWeek.length}`);
    for (const r of currentWeek) {
      console.log(`  ${r.work_date} | ${r.emp} | ${r.cust} | ${r.hours}h | ${r.status} | ${r.notes || ''}`);
    }
    
    // Also check 2/19 entries
    const feb19 = db.prepare(`
      SELECT e.name as emp, c.name as cust, te.work_date, te.hours, te.status
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      JOIN customers c ON c.id = te.customer_id
      WHERE te.work_date = '2026-02-19'
      ORDER BY e.name
    `).all();
    if (feb19.length > 0) {
      console.log(`\n  Feb 19 entries: ${feb19.length}`);
    }
    
    db.close();
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}

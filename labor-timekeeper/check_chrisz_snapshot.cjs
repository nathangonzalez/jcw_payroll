const Database = require('better-sqlite3');
for (const snap of ['snapshot_feb08', 'snapshot_feb25']) {
  try {
    const db = new Database(`./data/${snap}.db`, {readonly:true});
    console.log(`\n=== ${snap} ===`);
    const rows = db.prepare(`
      SELECT te.work_date, te.hours, c.name as customer
      FROM time_entries te
      JOIN customers c ON c.id=te.customer_id
      JOIN employees e ON e.id=te.employee_id
      WHERE e.name='Chris Zavesky'
        AND te.work_date>='2026-01-28' AND te.work_date<='2026-02-03'
        AND LOWER(c.name)!='lunch'
      ORDER BY te.work_date
    `).all();
    if(!rows.length) console.log('  No Chris Z entries for Jan 28 week');
    else rows.forEach(r => console.log(`  ${r.work_date} ${r.customer} ${r.hours}h`));
    db.close();
  } catch(e) { console.log(`  Error: ${e.message}`); }
}

const Database = require('better-sqlite3');
const db = new Database('data/app.db');

// Get Phil Henderson's employee ID
const emp = db.prepare('SELECT * FROM employees WHERE name LIKE ?').get('%Phil Henderson%');
console.log('=== Phil Henderson Employee Record ===');
console.log(emp);

console.log('\n=== Recent Time Entries for Phil Henderson ===');
const entries = db.prepare(`
  SELECT * FROM time_entries 
  WHERE employee_id = ? 
  ORDER BY date DESC, created_at DESC 
  LIMIT 20
`).all(emp.id);
console.log(JSON.stringify(entries, null, 2));

console.log('\n=== Entries by Week (last 4 weeks) ===');
const byWeek = db.prepare(`
  SELECT 
    strftime('%Y-%W', date) as week,
    SUM(hours) as total_hours,
    COUNT(*) as days
  FROM time_entries 
  WHERE employee_id = ?
  GROUP BY week
  ORDER BY week DESC
  LIMIT 4
`).all(emp.id);
console.log(JSON.stringify(byWeek, null, 2));

db.close();

import { openDb } from '../lib/db.js';
const db = openDb();
try {
  console.log('about to delete time_entries for 2026-01');
  const nextMonth = '2026-02-01';
  db.prepare("DELETE FROM time_entries WHERE work_date >= ? AND work_date < ?").run('2026-01-01', nextMonth);
  console.log('delete succeeded');
} catch (e) {
  console.error('delete failed:', e.message);
}
try {
  console.log('select employees...');
  const emps = db.prepare('SELECT * FROM employees').all();
  console.log('employees count:', emps.length);
} catch (e) {
  console.error('select employees failed:', e.message);
}
try {
  console.log('select customers...');
  const custs = db.prepare('SELECT * FROM customers').all();
  console.log('customers count:', custs.length);
} catch (e) {
  console.error('select customers failed:', e.message);
}

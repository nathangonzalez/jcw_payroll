import { openDb } from '../lib/db.js';

const db = openDb();
try {
  const r = db.prepare("DELETE FROM employees WHERE lower(name) LIKE '%jafid%'").run();
  const rows = db.prepare('SELECT id,name FROM employees ORDER BY name').all();
  console.log(JSON.stringify({ deleted: r.changes, rows }, null, 2));
} catch (err) {
  console.error('error', err?.message || err);
  process.exit(1);
}

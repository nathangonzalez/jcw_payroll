import { openDb } from '../lib/db.js';
const db = openDb();
const rows = db.prepare('SELECT id, name, default_bill_rate, default_pay_rate, is_admin FROM employees ORDER BY name ASC').all();
console.log(JSON.stringify(rows, null, 2));
process.exit(0);

const Database = require('better-sqlite3');
const db = new Database('data/prod/app.db', { readonly: true });
const te = db.prepare('SELECT COUNT(*) as n FROM time_entries').get();
const c = db.prepare('SELECT COUNT(*) as n FROM customers').get();
const e = db.prepare('SELECT COUNT(*) as n FROM employees').get();
console.log('entries:', te.n, 'customers:', c.n, 'employees:', e.n);
db.close();

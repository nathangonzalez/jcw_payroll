const Database = require('better-sqlite3');
const db = new Database('../tmp_verify_gcs.db');
const r = db.prepare('SELECT count(*) as c FROM time_entries').get();
console.log('GCS backup entries: ' + r.c);
const e = db.prepare('SELECT count(*) as c FROM employees').get();
console.log('GCS backup employees: ' + e.c);
db.close();

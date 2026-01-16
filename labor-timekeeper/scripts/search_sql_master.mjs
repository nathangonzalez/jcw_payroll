import Database from 'better-sqlite3';
const db = new Database('data/app.db', { readonly: true });
const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql LIKE '%employees_old%'").all();
console.log(rows);

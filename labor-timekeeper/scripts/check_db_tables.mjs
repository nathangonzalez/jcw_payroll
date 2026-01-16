import Database from 'better-sqlite3';
const db = new Database('data/app.db', { readonly: true });
console.log('Tables:');
const rows = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name").all();
for (const r of rows) console.log(r.type, r.name);
console.log('\nPRAGMA table_info(employees):');
try { console.log(db.prepare("PRAGMA table_info(employees)").all()); } catch (e) { console.error('employees pragma failed:', e.message); }
console.log('\nPRAGMA table_info(employees_old):');
try { console.log(db.prepare("PRAGMA table_info(employees_old)").all()); } catch (e) { console.error('employees_old pragma failed:', e.message); }

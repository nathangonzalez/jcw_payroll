import Database from 'better-sqlite3';
const db = new Database('data/app.db', { readonly: true });
const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'").all();
console.log(triggers);

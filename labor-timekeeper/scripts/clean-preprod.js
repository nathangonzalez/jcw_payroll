import fs from 'fs';
import path from 'path';
import { openDb } from '../lib/db.js';

function resolveDbPath() {
  const env = process.env.DATABASE_PATH;
  if (env) return path.resolve(env);
  return path.resolve('./data/app.db');
}

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  console.error('DB file not found at', dbPath);
  process.exit(1);
}

// Backup DB
const backupDir = path.resolve('./data/backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `app.db.backup.${timestamp}.sqlite`);
fs.copyFileSync(dbPath, backupPath);
console.log('Backed up DB to', backupPath);

const db = openDb();

const before = {
  time_entries: db.prepare('SELECT COUNT(*) as n FROM time_entries').get().n,
  rate_overrides: db.prepare('SELECT COUNT(*) as n FROM rate_overrides').get().n,
  sessions: db.prepare('SELECT COUNT(*) as n FROM sessions').get().n,
};

console.log('Counts before cleanup:', before);

// Perform cleanup in a transaction
const tx = db.transaction(() => {
  db.prepare('DELETE FROM time_entries').run();
  db.prepare('DELETE FROM rate_overrides').run();
  db.prepare('DELETE FROM sessions').run();
});
tx();

const after = {
  time_entries: db.prepare('SELECT COUNT(*) as n FROM time_entries').get().n,
  rate_overrides: db.prepare('SELECT COUNT(*) as n FROM rate_overrides').get().n,
  sessions: db.prepare('SELECT COUNT(*) as n FROM sessions').get().n,
};

console.log('Counts after cleanup:', after);
console.log('Cleanup complete. Employees and customers preserved.');

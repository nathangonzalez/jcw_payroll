import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const DEFAULT_DB_PATH = "./data/app.db";

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function openDb() {
  const dbPath = process.env.DATABASE_PATH || DEFAULT_DB_PATH;
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  default_bill_rate REAL NOT NULL DEFAULT 0,
  default_pay_rate REAL NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  address TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
  `);

  // Backward compatible migration: add address column if it doesn't exist
  try {
    const cols = db.prepare("PRAGMA table_info(customers)").all();
    const hasAddress = cols.some(c => c.name === 'address');
    if (!hasAddress) {
      db.exec("ALTER TABLE customers ADD COLUMN address TEXT DEFAULT ''");
      console.log('[migrate] Added address column to customers table');
    }
  } catch (e) {
    // Column might already exist, ignore
  }

  // Migration: remove legacy `pin_hash` column from employees if present
  try {
    const empCols = db.prepare("PRAGMA table_info(employees)").all();
    const hasPinHash = empCols.some(c => c.name === 'pin_hash');
    if (hasPinHash) {
      console.log('[migrate] Removing legacy pin_hash column from employees');
      db.exec('BEGIN');
      // Rename old table
      db.exec('ALTER TABLE employees RENAME TO employees_old');
      // Create new employees table without pin_hash
      db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  default_bill_rate REAL NOT NULL DEFAULT 0,
  default_pay_rate REAL NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
      `);
      // Copy data across (preserve ids)
      db.exec(`INSERT INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
        SELECT id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at FROM employees_old`);
      // Drop old table
      db.exec('DROP TABLE IF EXISTS employees_old');
      db.exec('COMMIT');
      console.log('[migrate] pin_hash column removed');
    }
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch(e){}
    console.warn('[migrate] failed to remove pin_hash column', err?.message || err);
  }

  // Purge known test/admin account 'Jafid' if present
  try {
    const del = db.prepare("DELETE FROM employees WHERE lower(name) LIKE '%jafid%'");
    const r = del.run();
    if (r.changes && r.changes > 0) console.log('[migrate] Removed Jafid employee(s):', r.changes);
  } catch (err) {
    console.warn('[migrate] failed to delete Jafid', err?.message || err);
  }

  db.exec(`

CREATE TABLE IF NOT EXISTS rate_overrides (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  bill_rate REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(employee_id, customer_id),
  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  work_date TEXT NOT NULL, -- YYYY-MM-DD (America/New_York)
  hours REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | SUBMITTED | APPROVED
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_emp_date ON time_entries(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_cust_date ON time_entries(customer_id, work_date);
  `);
}

export function id(prefix = "") {
  return prefix + nanoid(16);
}

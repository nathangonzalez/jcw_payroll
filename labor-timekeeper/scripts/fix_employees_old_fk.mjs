#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('data/app.db');
try {
  console.log('Disabling foreign_keys to perform migration...');
  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN');

  // Fix rate_overrides
  const rr = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rate_overrides'").get();
  if (rr && rr.sql && rr.sql.includes('employees_old')) {
    console.log('Patching table rate_overrides');
    db.exec(`
      CREATE TABLE rate_overrides_new (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        bill_rate REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(employee_id, customer_id),
        FOREIGN KEY(employee_id) REFERENCES employees(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
    `);
    db.exec("INSERT INTO rate_overrides_new(id,employee_id,customer_id,bill_rate,created_at) SELECT id,employee_id,customer_id,bill_rate,created_at FROM rate_overrides;");
    db.exec('DROP TABLE rate_overrides');
    db.exec('ALTER TABLE rate_overrides_new RENAME TO rate_overrides');
  }

  // Fix sessions
  const rs = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (rs && rs.sql && rs.sql.includes('employees_old')) {
    console.log('Patching table sessions');
    db.exec(`
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(employee_id) REFERENCES employees(id)
      );
    `);
    db.exec("INSERT INTO sessions_new(id,employee_id,created_at,expires_at) SELECT id,employee_id,created_at,expires_at FROM sessions;");
    db.exec('DROP TABLE sessions');
    db.exec('ALTER TABLE sessions_new RENAME TO sessions');
  }

  // Fix time_entries
  const rt = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entries'").get();
  if (rt && rt.sql && rt.sql.includes('employees_old')) {
    console.log('Patching table time_entries');
    db.exec(`
      CREATE TABLE time_entries_new (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        work_date TEXT NOT NULL,
        hours REAL NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        entry_type TEXT NOT NULL DEFAULT 'REGULAR',
        FOREIGN KEY(employee_id) REFERENCES employees(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
    `);
    db.exec("INSERT INTO time_entries_new(id,employee_id,customer_id,work_date,hours,notes,status,created_at,updated_at,entry_type) SELECT id,employee_id,customer_id,work_date,hours,notes,status,created_at,updated_at,entry_type FROM time_entries;");
    db.exec('DROP TABLE time_entries');
    db.exec('ALTER TABLE time_entries_new RENAME TO time_entries');
  }

  // Recreate indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_time_entries_emp_date ON time_entries(employee_id, work_date);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_time_entries_cust_date ON time_entries(customer_id, work_date);');

  db.exec('COMMIT');
  db.pragma('foreign_keys = ON');
  console.log('Migration complete.');
} catch (err) {
  try { db.exec('ROLLBACK'); } catch(e){}
  console.error('Migration failed:', err.message);
  process.exit(1);
}

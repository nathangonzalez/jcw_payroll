import fs from 'fs';
import path from 'path';

// Migration helper to ensure columns exist and seed customers if missing
export async function migrate(db) {
  // Ensure columns
  await ensureColumn(db, 'customers', 'address', "TEXT DEFAULT ''");
  await ensureColumn(db, 'time_entries', 'entry_type', "TEXT NOT NULL DEFAULT 'REGULAR'");
  await ensureColumn(db, 'employees', 'role', "TEXT NOT NULL DEFAULT 'hourly'");
  await ensureColumn(db, 'employees', 'aliases_json', "TEXT DEFAULT '[]'");

  // If customers table is empty, seed from seed/customers.json if present
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM customers').get();
    const count = row?.n ?? 0;
    const seedPath = path.resolve(process.cwd(), 'seed', 'customers.json');
    // Only seed customers if the table is empty
    if (fs.existsSync(seedPath) && count === 0) {
      const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      const now = new Date().toISOString();
      const insert = db.prepare('INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)');
      const update = db.prepare('UPDATE customers SET address = ? WHERE id = ?');
      const find = db.prepare('SELECT id, address FROM customers WHERE LOWER(name) = LOWER(?)');
      const { nanoid } = await import('nanoid');
      for (const c of data) {
        const name = typeof c === 'string' ? c : c.name || '';
        const address = typeof c === 'string' ? '' : (c.address || '');
        const existing = find.get(name);
        if (existing) {
          if ((!existing.address || existing.address === '') && address) {
            update.run(address, existing.id);
          }
        } else {
          insert.run(nanoid(16), name, address, now);
        }
      }
      console.log('[migrate] Applied customer seeds (insert/update) from seed/customers.json');
    }
  } catch (e) {
    console.error('[migrate] Seed check failed:', String(e));
  }
}

async function ensureColumn(db, table, col, decl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some(c => c.name === col);
    if (exists) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    console.log(`[migrate] Added column ${col} to ${table}`);
  } catch (e) {
    if (!String(e).toLowerCase().includes('duplicate column')) throw e;
  }
}

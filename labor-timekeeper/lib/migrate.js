import fs from 'fs';
import path from 'path';

// Migration helper to ensure columns exist and seed customers if missing
export async function migrate(db) {
  // Ensure columns
  await ensureColumn(db, 'customers', 'address', "TEXT DEFAULT ''");
  await ensureColumn(db, 'time_entries', 'entry_type', "TEXT NOT NULL DEFAULT 'REGULAR'");
  await ensureColumn(db, 'time_entries', 'start_time', "TEXT DEFAULT ''");
  await ensureColumn(db, 'time_entries', 'end_time', "TEXT DEFAULT ''");
  await ensureColumn(db, 'employees', 'role', "TEXT NOT NULL DEFAULT 'hourly'");
  await ensureColumn(db, 'employees', 'aliases_json', "TEXT DEFAULT '[]'");
  await ensureColumn(db, 'employees', 'client_bill_rate', "REAL DEFAULT NULL");
  await ensureColumn(db, 'time_entries', 'archived', "INTEGER NOT NULL DEFAULT 0");

  // Seed client_bill_rate for existing employees if NULL
  await seedClientBillRates(db);
  await ensureAdminCustomerRateOverrides(db);
  await mergeJcwOfficeShopCustomer(db);
  await mergeCustomerAliases(db, 'Ueltschi', [
    'Ueltschi',
    'Ultchei',
    'Ueltchi',
    'Ueltschii',
    'Ueltschi ',
  ]);
  await mergeCustomerAliases(db, 'Tubergen', [
    'Tubergen',
    'Tubergen\'s',
    'Tubergan',
    'Tuburgen',
    'Tubergen ',
  ]);

  // Ensure weekly comments table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_comments (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(employee_id, week_start)
    );
  `);

  // If customers table is empty, seed from seed/customers.json if present
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM customers').get();
    const count = row?.n ?? 0;
    const seedPath = path.resolve(process.cwd(), 'seed', 'customers.json');
    if (count === 0 && fs.existsSync(seedPath)) {
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

function normalizeCustomerKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function mergeJcwOfficeShopCustomer(db) {
  const CANONICAL_NAME = 'JCW Shop/Office';
  const CANONICAL_KEY = normalizeCustomerKey(CANONICAL_NAME);
  const aliasKeys = new Set([
    'jcw',
    'office',
    'shop',
    'jcwoffice',
    'jcwshop',
    'shopoffice',
    'jcwofficeshop',
    CANONICAL_KEY,
  ]);

  try {
    const rows = db.prepare('SELECT id, name, address FROM customers').all();
    const candidates = rows.filter((r) => aliasKeys.has(normalizeCustomerKey(r.name)));
    if (candidates.length === 0) return;

    // Prefer an existing canonical name row, otherwise prefer the historic "JCW" row.
    let canonical = candidates.find((r) => normalizeCustomerKey(r.name) === CANONICAL_KEY)
      || candidates.find((r) => normalizeCustomerKey(r.name) === 'jcw')
      || candidates[0];
    if (!canonical) return;

    const addressFallback = candidates.find((r) => String(r.address || '').trim())?.address || '';

    const tx = db.transaction(() => {
      // Normalize canonical customer label.
      db.prepare('UPDATE customers SET name = ?, address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?')
        .run(CANONICAL_NAME, addressFallback, canonical.id);

      const selectAliasOverrides = db.prepare(`
        SELECT id, employee_id, bill_rate
        FROM rate_overrides
        WHERE customer_id = ?
      `);
      const findCanonicalOverride = db.prepare(`
        SELECT id, bill_rate
        FROM rate_overrides
        WHERE employee_id = ? AND customer_id = ?
      `);
      const updateOverrideCustomer = db.prepare('UPDATE rate_overrides SET customer_id = ? WHERE id = ?');
      const updateCanonicalRate = db.prepare('UPDATE rate_overrides SET bill_rate = ? WHERE id = ?');
      const deleteOverride = db.prepare('DELETE FROM rate_overrides WHERE id = ?');
      const moveTimeEntries = db.prepare('UPDATE time_entries SET customer_id = ? WHERE customer_id = ?');
      const deleteCustomer = db.prepare('DELETE FROM customers WHERE id = ?');

      for (const row of candidates) {
        if (row.id === canonical.id) continue;

        // Move approved/draft/submitted time entries to canonical customer.
        moveTimeEntries.run(canonical.id, row.id);

        // Merge per-employee overrides without violating UNIQUE(employee_id, customer_id).
        const aliasOverrides = selectAliasOverrides.all(row.id);
        for (const override of aliasOverrides) {
          const existing = findCanonicalOverride.get(override.employee_id, canonical.id);
          if (!existing) {
            updateOverrideCustomer.run(canonical.id, override.id);
            continue;
          }
          // If canonical override is still default-ish, prefer explicit alias value.
          const canonicalRate = Number(existing.bill_rate || 0);
          const aliasRate = Number(override.bill_rate || 0);
          if ((canonicalRate === 0 || canonicalRate === 100) && aliasRate > 0 && aliasRate !== canonicalRate) {
            updateCanonicalRate.run(aliasRate, existing.id);
          }
          deleteOverride.run(override.id);
        }

        deleteCustomer.run(row.id);
      }
    });

    tx();
    console.log(`[migrate] Merged JCW/Office/Shop into "${CANONICAL_NAME}"`);
  } catch (e) {
    console.error('[migrate] mergeJcwOfficeShopCustomer failed:', String(e));
  }
}

async function mergeCustomerAliases(db, canonicalName, aliases) {
  const canonicalKey = normalizeCustomerKey(canonicalName);
  const aliasKeys = new Set((aliases || []).map((name) => normalizeCustomerKey(name)));
  aliasKeys.add(canonicalKey);

  try {
    const rows = db.prepare('SELECT id, name, address FROM customers').all();
    const candidates = rows.filter((r) => aliasKeys.has(normalizeCustomerKey(r.name)));
    if (candidates.length <= 1) {
      if (candidates.length === 1) {
        db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(canonicalName, candidates[0].id);
      }
      return;
    }

    let canonical = candidates.find((r) => normalizeCustomerKey(r.name) === canonicalKey) || candidates[0];
    const addressFallback = candidates.find((r) => String(r.address || '').trim())?.address || '';

    const tx = db.transaction(() => {
      db.prepare('UPDATE customers SET name = ?, address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?')
        .run(canonicalName, addressFallback, canonical.id);

      const selectAliasOverrides = db.prepare(`
        SELECT id, employee_id, bill_rate
        FROM rate_overrides
        WHERE customer_id = ?
      `);
      const findCanonicalOverride = db.prepare(`
        SELECT id, bill_rate
        FROM rate_overrides
        WHERE employee_id = ? AND customer_id = ?
      `);
      const updateOverrideCustomer = db.prepare('UPDATE rate_overrides SET customer_id = ? WHERE id = ?');
      const updateCanonicalRate = db.prepare('UPDATE rate_overrides SET bill_rate = ? WHERE id = ?');
      const deleteOverride = db.prepare('DELETE FROM rate_overrides WHERE id = ?');
      const moveTimeEntries = db.prepare('UPDATE time_entries SET customer_id = ? WHERE customer_id = ?');
      const deleteCustomer = db.prepare('DELETE FROM customers WHERE id = ?');

      for (const row of candidates) {
        if (row.id === canonical.id) continue;

        moveTimeEntries.run(canonical.id, row.id);

        const aliasOverrides = selectAliasOverrides.all(row.id);
        for (const override of aliasOverrides) {
          const existing = findCanonicalOverride.get(override.employee_id, canonical.id);
          if (!existing) {
            updateOverrideCustomer.run(canonical.id, override.id);
            continue;
          }
          const canonicalRate = Number(existing.bill_rate || 0);
          const aliasRate = Number(override.bill_rate || 0);
          if ((canonicalRate === 0 || canonicalRate === 100) && aliasRate > 0 && aliasRate !== canonicalRate) {
            updateCanonicalRate.run(aliasRate, existing.id);
          }
          deleteOverride.run(override.id);
        }

        deleteCustomer.run(row.id);
      }
    });

    tx();
    console.log(`[migrate] Merged customer aliases into "${canonicalName}"`);
  } catch (e) {
    console.error(`[migrate] mergeCustomerAliases failed for ${canonicalName}:`, String(e));
  }
}

/**
 * Seed client_bill_rate for employees that don't have one set yet.
 * These are the client-facing billing rates (what JCW charges customers),
 * distinct from default_bill_rate (what JCW pays employees internally).
 *
 * Rate hierarchy:
 *   - default_bill_rate = internal pay rate (payroll reports)
 *   - client_bill_rate  = client-facing rate (billing reports)
 *   - rate_overrides    = per-customer per-employee overrides (both reports)
 */
async function seedClientBillRates(db) {
  const CLIENT_RATES = {
    "Boban Abbate": 90,
    "Chris Zavesky": 100,
    "Chris Jacobi": 100,
    "Thomas Brinson": 90,
    "Phil Henderson": 90,
    "Jason Green": 75,
    "Doug Kinsey": 65,
    "Sean Matthew": 40,
  };

  try {
    const update = db.prepare(
      "UPDATE employees SET client_bill_rate = ? WHERE LOWER(name) = LOWER(?) AND client_bill_rate IS NULL"
    );
    const updateAdminLegacy = db.prepare(
      "UPDATE employees SET client_bill_rate = ? WHERE LOWER(name) = LOWER(?) AND (client_bill_rate IS NULL OR ABS(client_bill_rate - 90) < 0.001)"
    );
    let count = 0;
    for (const [name, rate] of Object.entries(CLIENT_RATES)) {
      const result = update.run(rate, name);
      if (result.changes > 0) count++;
    }
    // Artifact-based admin default correction:
    // CJ/CZ billing sheets in "Admin_Monthly_Payroll (Feb) - r1.xlsx" are consistently $100.
    for (const adminName of ["Chris Jacobi", "Chris Zavesky"]) {
      const result = updateAdminLegacy.run(100, adminName);
      if (result.changes > 0) count++;
    }
    if (count > 0) {
      console.log(`[migrate] Seeded client_bill_rate for ${count} employees`);
    }
  } catch (e) {
    console.error('[migrate] seedClientBillRates failed:', String(e));
  }
}

/**
 * Ensure CJ/CZ have explicit per-customer billing rates for customers they touch.
 * If an override is missing, seed it to 100 (artifact default), while preserving
 * any existing non-100 negotiated override already in rate_overrides.
 */
async function ensureAdminCustomerRateOverrides(db) {
  try {
    const admins = db.prepare(
      "SELECT id, name FROM employees WHERE LOWER(name) IN ('chris jacobi', 'chris zavesky', 'chris z')"
    ).all();
    if (!admins.length) return;

    const customerRowsStmt = db.prepare(`
      SELECT DISTINCT te.customer_id AS customer_id
      FROM time_entries te
      WHERE te.employee_id = ?
        AND te.customer_id IS NOT NULL
    `);
    const upsert = db.prepare(`
      INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, customer_id) DO NOTHING
    `);

    const now = new Date().toISOString();
    let seeded = 0;
    const tx = db.transaction(() => {
      for (const admin of admins) {
        const customerRows = customerRowsStmt.all(admin.id);
        for (const row of customerRows) {
          const rid = `ro_seed_${admin.id}_${row.customer_id}`;
          const result = upsert.run(rid, admin.id, row.customer_id, 100, now);
          if (result.changes > 0) seeded++;
        }
      }
    });
    tx();

    if (seeded > 0) {
      console.log(`[migrate] Seeded ${seeded} CJ/CZ per-customer rate_overrides at $100 default`);
    }
  } catch (e) {
    console.error("[migrate] ensureAdminCustomerRateOverrides failed:", String(e));
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

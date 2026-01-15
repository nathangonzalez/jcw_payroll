import { DEFAULT_EMPLOYEES } from './defaultEmployees.js';

function safeJsonArray(s) {
  try {
    const x = JSON.parse(s || '[]');
    return Array.isArray(x) ? x : [];
  } catch (err) {
    return [];
  }
}

export function ensureEmployees(db) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM employees').get();
    if ((row?.n ?? 0) > 0) return { ok: true, inserted: 0 };

    let inserted = 0;
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const e of DEFAULT_EMPLOYEES) {
      const id = 'emp_' + Math.random().toString(36).slice(2, 10);
      insert.run(id, e.name, 0, 0, e.role === 'admin' ? 1 : 0, JSON.stringify(e.aliases || []), now);
      inserted++;
    }
    return { ok: true, inserted };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export function getEmployeesDBOrDefault(db) {
  try {
    const rows = db.prepare('SELECT id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json FROM employees ORDER BY name ASC').all();
    if (rows && rows.length) {
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        default_bill_rate: r.default_bill_rate || 0,
        default_pay_rate: r.default_pay_rate || 0,
        role: r.is_admin ? 'admin' : 'hourly',
        aliases: safeJsonArray(r.aliases_json)
      }));
    }
  } catch (err) {
    // ignore and fallback
  }
  return DEFAULT_EMPLOYEES.map((e, idx) => ({ id: `-d${idx+1}`, name: e.name, default_bill_rate: 0, default_pay_rate: 0, role: e.role, aliases: e.aliases }));
}

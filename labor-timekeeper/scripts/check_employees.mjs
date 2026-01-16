import Database from 'better-sqlite3';

const db = new Database('data/app.db', { readonly: true });

const rows = db.prepare('SELECT id, name, default_bill_rate, default_pay_rate, is_admin FROM employees ORDER BY name ASC').all();
for (const r of rows) {
  console.log(`${r.id}\t${r.name}\tbill:${r.default_bill_rate}\tpay:${r.default_pay_rate}\tadmin:${r.is_admin}`);
}
console.log('Total:', rows.length);

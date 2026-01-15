#!/usr/bin/env node
import { openDb } from '../lib/db.js';

const db = openDb();
const month = process.argv[2] || '2026-01';
const [y, m] = month.split('-').map(Number);
const first = `${y}-${String(m).padStart(2,'0')}-01`;
const last = new Date(y, m, 0);
const lastYmd = `${y}-${String(m).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;

const rows = db.prepare(`
  SELECT e.name, e.id, COUNT(te.id) AS entries, COALESCE(SUM(te.hours),0) AS hours
  FROM employees e
  LEFT JOIN time_entries te ON te.employee_id = e.id AND te.work_date BETWEEN ? AND ?
  GROUP BY e.id
  ORDER BY entries ASC, e.name ASC
`).all(first, lastYmd);

console.log(`Entries for ${month} (${first} to ${lastYmd}):`);
for (const r of rows) {
  console.log(`- ${r.name}: ${r.entries} entries, ${r.hours} hours`);
}

const zero = rows.filter(r => r.entries === 0);
if (zero.length) {
  console.log('\nEmployees with ZERO entries:');
  zero.forEach(z => console.log(`* ${z.name} (${z.id})`));
} else {
  console.log('\nAll employees have at least one entry.');
}

process.exit(0);

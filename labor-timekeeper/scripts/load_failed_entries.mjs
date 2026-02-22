#!/usr/bin/env node
/**
 * Load ONLY the 22 entries that failed from the backup (customers now exist)
 */
import Database from 'better-sqlite3';

const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const SECRET = '7707';

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', 'x-admin-secret': SECRET, ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

// Failed customers from the backup load
const FAILED_CUSTOMERS = ['pto', 'turbergen', 'mulvoy', 'office', 'doctor', 'brooke', 'gonzalez', 'nathan'];

const db = new Database('./data/gcs_backup_2026-02-20.db', { readonly: true });

const employees = await api('/api/employees');
const customers = await api('/api/customers');
const empMap = new Map(employees.map(e => [e.name.toLowerCase(), e.id]));
const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));

// Get only the entries that would have failed (for the missing customers)
const entries = db.prepare(`
  SELECT e.name as emp_name, c.name as cust_name, te.work_date, te.hours, te.notes
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date BETWEEN '2026-01-28' AND '2026-02-17'
  ORDER BY te.work_date
`).all();

const failedEntries = entries.filter(e => FAILED_CUSTOMERS.includes(e.cust_name.toLowerCase()));
console.log(`Found ${failedEntries.length} previously-failed entries to load`);

let loaded = 0;
for (const entry of failedEntries) {
  const empId = empMap.get(entry.emp_name.toLowerCase());
  const custId = custMap.get(entry.cust_name.toLowerCase());
  
  if (!empId || !custId) {
    console.log(`  Skip: ${entry.emp_name} ${entry.cust_name} (emp=${!!empId} cust=${!!custId})`);
    continue;
  }

  try {
    await api('/api/time-entries', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: empId,
        customer_id: custId,
        work_date: entry.work_date,
        hours: entry.hours,
        notes: entry.notes || '',
      })
    });
    console.log(`  ✅ ${entry.emp_name} ${entry.work_date} ${entry.cust_name} ${entry.hours}h`);
    loaded++;
  } catch (e) {
    console.log(`  ❌ ${entry.emp_name} ${entry.work_date} ${entry.cust_name}: ${e.message}`);
  }
}

console.log(`\nLoaded ${loaded}/${failedEntries.length}`);
const health = await api('/api/health');
console.log(`Health: ${JSON.stringify(health)}`);
db.close();

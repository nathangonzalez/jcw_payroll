#!/usr/bin/env node
/**
 * Load ALL entries from backup file to prod
 */
import Database from 'better-sqlite3';

const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const ADMIN_SECRET = '7707';

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

const db = new Database('./data/gcs_backup_2026-02-20.db', { readonly: true });

// Get employees and customers
const employees = await api('/api/employees');
const customers = await api('/api/customers');

const empMap = new Map(employees.map(e => [e.name.toLowerCase(), e.id]));
const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));

// Get all time entries from backup
const entries = db.prepare(`
  SELECT e.name as emp_name, c.name as cust_name, te.work_date, te.hours, te.notes
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date BETWEEN '2026-01-28' AND '2026-02-17'
  ORDER BY te.work_date
`).all();

console.log(`Found ${entries.length} entries in backup`);
console.log(`Employees: ${employees.length}, Customers: ${customers.length}`);

let loaded = 0;
let failed = 0;

for (const entry of entries) {
  const empId = empMap.get(entry.emp_name.toLowerCase());
  let custId = custMap.get(entry.cust_name.toLowerCase());
  
  if (!empId) {
    console.log(`  Skip: unknown employee ${entry.emp_name}`);
    continue;
  }
  
    if (!custId) {
    console.log(`  Creating customer: ${entry.cust_name}`);
    try {
      const created = await api('/api/customers/find-or-create', { 
        method: 'POST', 
        body: JSON.stringify({ name: entry.cust_name }) 
      });
      custId = created.customer?.id || created.id;
      custMap.set(entry.cust_name.toLowerCase(), custId);
    } catch (e) {
      console.log(`  Failed to create customer ${entry.cust_name}: ${e.message}`);
      failed++;
      continue;
    }
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
        status: 'APPROVED'
      })
    });
    loaded++;
    if (loaded % 20 === 0) console.log(`  Loaded ${loaded}...`);
  } catch (e) {
    console.log(`  Failed: ${entry.emp_name} ${entry.work_date} ${entry.cust_name}: ${e.message}`);
    failed++;
  }
}

console.log(`\nDone: ${loaded} loaded, ${failed} failed`);
db.close();

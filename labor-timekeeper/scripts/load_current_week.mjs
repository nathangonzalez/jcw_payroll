#!/usr/bin/env node
/**
 * Load current week entries (2/18+) from backup into prod
 */
import Database from 'better-sqlite3';

const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const ADMIN_SECRET = '7707';

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET, ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

const db = new Database('./data/gcs_backup_2026-02-20.db', { readonly: true });

const employees = await api('/api/employees');
const customers = await api('/api/customers');
const empMap = new Map(employees.map(e => [e.name.toLowerCase(), e.id]));
const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));

// Get current week entries from backup
const entries = db.prepare(`
  SELECT e.name as emp_name, c.name as cust_name, te.work_date, te.hours, te.notes, te.status,
         te.start_time, te.end_time
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date >= '2026-02-18'
  ORDER BY te.work_date
`).all();

console.log(`Found ${entries.length} current-week entries in backup`);

let loaded = 0;
for (const entry of entries) {
  const empId = empMap.get(entry.emp_name.toLowerCase());
  const custId = custMap.get(entry.cust_name.toLowerCase());
  
  if (!empId || !custId) {
    console.log(`  Skip: ${entry.emp_name} ${entry.cust_name} (missing employee or customer)`);
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
        start_time: entry.start_time || '',
        end_time: entry.end_time || '',
      })
    });
    console.log(`  ✅ ${entry.work_date} | ${entry.emp_name} | ${entry.cust_name} | ${entry.hours}h | was ${entry.status}`);
    loaded++;
  } catch (e) {
    console.log(`  ❌ ${entry.emp_name} ${entry.work_date} ${entry.cust_name}: ${e.message}`);
  }
}

console.log(`\nLoaded ${loaded}/${entries.length} current-week entries`);

// Now submit the 2/18 week for Chris Zavesky (those were SUBMITTED in backup)
const czId = empMap.get('chris zavesky');
if (czId) {
  try {
    await api('/api/submit-week', {
      method: 'POST',
      body: JSON.stringify({ employee_id: czId, week_start: '2026-02-18' })
    });
    console.log('Submitted Chris Zavesky week 2/18');
  } catch (e) {
    console.log(`Submit failed: ${e.message}`);
  }
}

const health = await api('/api/health');
console.log(`Health: ${JSON.stringify(health)}`);
db.close();

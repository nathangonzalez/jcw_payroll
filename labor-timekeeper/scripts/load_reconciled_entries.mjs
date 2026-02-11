#!/usr/bin/env node
/**
 * Load reconciled entries from 2/4 manual timesheets into prod.
 * Based on RECONCILE_2_4.md analysis.
 * 
 * Usage: node scripts/load_reconciled_entries.mjs [--dry-run] [--target jcw1|prod]
 */

const DRY_RUN = process.argv.includes('--dry-run');
const target = process.argv.includes('--target') 
  ? process.argv[process.argv.indexOf('--target') + 1] 
  : 'jcw1';

const BASES = {
  prod: 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
  jcw1: 'https://jcw1-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
};
const BASE = BASES[target] || BASES.jcw1;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '7707';

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

async function getEmployeeId(name) {
  const employees = await api('/api/employees');
  const emp = employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!emp) throw new Error(`Employee not found: ${name}`);
  return emp.id;
}

async function getCustomerId(name) {
  const customers = await api('/api/customers');
  const cust = customers.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!cust) {
    console.log(`  ⚠️ Customer "${name}" not found. Creating...`);
    if (DRY_RUN) return 'DRY_RUN_ID';
    const created = await api('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    return created.id;
  }
  return cust.id;
}

async function submitEntry(empId, custId, workDate, hours, notes = '') {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would submit: empId=${empId}, custId=${custId}, date=${workDate}, hours=${hours}, notes=${notes}`);
    return { id: 'dry-run' };
  }
  return api('/api/time-entries', {
    method: 'POST',
    body: JSON.stringify({
      employee_id: empId,
      customer_id: custId,
      work_date: workDate,
      hours,
      notes,
      status: 'APPROVED'
    })
  });
}

async function deleteEntry(entryId, empId) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete entry: ${entryId}`);
    return;
  }
  return api(`/api/time-entries/${entryId}`, { 
    method: 'DELETE',
    body: JSON.stringify({ employee_id: empId })
  });
}

async function getWeekEntries(empId, weekStart) {
  return api(`/api/time-entries?employee_id=${empId}&week_start=${weekStart}`);
}

// ============================================================
// RECONCILED ENTRIES TO LOAD
// ============================================================

const ENTRIES_TO_ADD = [
  // === BOBAN ABBATE ===
  // Mon 2/9: Boyle 7h, Walsh-Maint 1h
  { employee: 'Boban Abbate', customer: 'Boyle', date: '2026-02-09', hours: 7, notes: 'Reconciled from manual' },
  { employee: 'Boban Abbate', customer: 'Walsh', date: '2026-02-09', hours: 1, notes: 'Walsh-Maint - Reconciled from manual' },
  { employee: 'Boban Abbate', customer: 'Lunch', date: '2026-02-09', hours: 0.5, notes: 'Lunch' },
  // Tue 2/10: Boyle 7h, Sweeney 1h (replacing McGill 7h DRAFT)
  { employee: 'Boban Abbate', customer: 'Boyle', date: '2026-02-10', hours: 7, notes: 'Reconciled from manual (was McGill)' },
  { employee: 'Boban Abbate', customer: 'Sweeney', date: '2026-02-10', hours: 1, notes: 'Reconciled from manual' },
  { employee: 'Boban Abbate', customer: 'Lunch', date: '2026-02-10', hours: 0.5, notes: 'Lunch' },

  // === PHIL HENDERSON ===
  // Mon 2/9: Watkins 8h
  { employee: 'Phil Henderson', customer: 'Watkins', date: '2026-02-09', hours: 8.5, notes: 'Reconciled from manual', start_time: '07:30', end_time: '16:30' },
  { employee: 'Phil Henderson', customer: 'Lunch', date: '2026-02-09', hours: 0.5, notes: 'Lunch' },
  // Tue 2/10: Watkins 8h
  { employee: 'Phil Henderson', customer: 'Watkins', date: '2026-02-10', hours: 8.5, notes: 'Reconciled from manual', start_time: '07:30', end_time: '16:30' },
  { employee: 'Phil Henderson', customer: 'Lunch', date: '2026-02-10', hours: 0.5, notes: 'Lunch' },

  // === SEAN MATTHEW ===
  // Fri 2/6: PTO 8h
  { employee: 'Sean Matthew', customer: 'PTO', date: '2026-02-06', hours: 8, notes: 'PTO - Reconciled from manual' },
  // Mon 2/9: Boyle 8h
  { employee: 'Sean Matthew', customer: 'Boyle', date: '2026-02-09', hours: 8, notes: 'Reconciled from manual', start_time: '07:30', end_time: '16:00' },
  { employee: 'Sean Matthew', customer: 'Lunch', date: '2026-02-09', hours: 0.5, notes: 'Lunch' },
  // Tue 2/10: Boyle 8h
  { employee: 'Sean Matthew', customer: 'Boyle', date: '2026-02-10', hours: 8, notes: 'Reconciled from manual', start_time: '07:30', end_time: '16:00' },
  { employee: 'Sean Matthew', customer: 'Lunch', date: '2026-02-10', hours: 0.5, notes: 'Lunch' },

  // === THOMAS BRINSON ===
  // Mon 2/9: Landy 2h, Boyle 2.5h, Landy 1h, Boyle 1h, Landy 1.5h = 8h
  { employee: 'Thomas Brinson', customer: 'Landy', date: '2026-02-09', hours: 2, notes: 'Reconciled from manual', start_time: '07:30', end_time: '09:30' },
  { employee: 'Thomas Brinson', customer: 'Boyle', date: '2026-02-09', hours: 2.5, notes: 'Reconciled from manual', start_time: '09:30', end_time: '12:00' },
  { employee: 'Thomas Brinson', customer: 'Lunch', date: '2026-02-09', hours: 0.5, notes: 'Lunch', start_time: '12:00', end_time: '12:30' },
  { employee: 'Thomas Brinson', customer: 'Landy', date: '2026-02-09', hours: 1, notes: 'Reconciled from manual', start_time: '12:30', end_time: '13:30' },
  { employee: 'Thomas Brinson', customer: 'Boyle', date: '2026-02-09', hours: 1, notes: 'Reconciled from manual', start_time: '13:30', end_time: '14:30' },
  { employee: 'Thomas Brinson', customer: 'Landy', date: '2026-02-09', hours: 1.5, notes: 'Reconciled from manual', start_time: '14:30', end_time: '16:00' },
  // Tue 2/10: Boyle 1h, Landy 6.5h, PTO 0.5h = 8h (7.5 + PTO 0.5)
  { employee: 'Thomas Brinson', customer: 'Boyle', date: '2026-02-10', hours: 1, notes: 'Reconciled from manual', start_time: '07:30', end_time: '08:30' },
  { employee: 'Thomas Brinson', customer: 'Landy', date: '2026-02-10', hours: 6.5, notes: 'Reconciled from manual', start_time: '08:30', end_time: '15:30' },
  { employee: 'Thomas Brinson', customer: 'Lunch', date: '2026-02-10', hours: 0.5, notes: 'Lunch', start_time: '12:00', end_time: '12:30' },
  { employee: 'Thomas Brinson', customer: 'PTO', date: '2026-02-10', hours: 0.5, notes: 'PTO - Reconciled from manual' },
];

// Entries to DELETE (wrong data)
const ENTRIES_TO_DELETE = [
  // Boban Tue 2/10: McGill 7h DRAFT
  { employee: 'Boban Abbate', date: '2026-02-10', customer: 'McGill' },
];

// Doug Kinsey: Delete JCW entries on Fri 2/6 (keep PTO)
const DOUG_FRI_DELETES = [
  { employee: 'Doug Kinsey', date: '2026-02-06', customer: 'JCW' },
];

async function main() {
  console.log(`\n=== LOAD RECONCILED ENTRIES ===`);
  console.log(`Target: ${target} (${BASE})`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Pre-fetch employee and customer IDs
  const empCache = new Map();
  const custCache = new Map();

  // Step 1: Delete wrong entries
  console.log('--- Step 1: Delete wrong entries ---');
  for (const del of [...ENTRIES_TO_DELETE, ...DOUG_FRI_DELETES]) {
    const empId = empCache.get(del.employee) || await getEmployeeId(del.employee);
    empCache.set(del.employee, empId);
    const week = await getWeekEntries(empId, '2026-02-04');
    const entries = week.entries || [];
    const matches = entries.filter(e => 
      e.work_date === del.date && 
      (e.customer_name || '').toLowerCase().includes(del.customer.toLowerCase())
    );
    for (const m of matches) {
      console.log(`  DELETE: ${del.employee} | ${del.date} | ${m.customer_name} ${m.hours}h [${m.status}] (id: ${m.id})`);
      try {
        await deleteEntry(m.id, empId);
        console.log(`    ✅ Deleted`);
      } catch (err) {
        console.log(`    ⚠️ Could not delete (${err.message}) — may need admin unapprove first`);
      }
    }
    if (matches.length === 0) {
      console.log(`  (no match found for ${del.employee} ${del.date} ${del.customer})`);
    }
  }

  // Step 2: Add reconciled entries
  console.log('\n--- Step 2: Add reconciled entries ---');
  let addedCount = 0;
  for (const entry of ENTRIES_TO_ADD) {
    const empId = empCache.get(entry.employee) || await getEmployeeId(entry.employee);
    empCache.set(entry.employee, empId);
    const custId = custCache.get(entry.customer) || await getCustomerId(entry.customer);
    custCache.set(entry.customer, custId);

    console.log(`  ADD: ${entry.employee} | ${entry.date} | ${entry.customer} ${entry.hours}h`);
    try {
      await submitEntry(empId, custId, entry.date, entry.hours, entry.notes);
      addedCount++;
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
    }
  }

  console.log(`\n=== DONE: ${addedCount} entries added ===\n`);

  // Step 3: Verify totals
  console.log('--- Step 3: Verify totals ---');
  const verifyEmployees = ['Boban Abbate', 'Phil Henderson', 'Sean Matthew', 'Thomas Brinson', 'Doug Kinsey'];
  for (const name of verifyEmployees) {
    const empId = empCache.get(name) || await getEmployeeId(name);
    const week = await getWeekEntries(empId, '2026-02-04');
    const entries = (week.entries || []).filter(e => !(e.customer_name || '').toLowerCase().includes('lunch'));
    const total = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
    console.log(`  ${name}: ${total}h (${entries.length} entries)`);
  }
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});

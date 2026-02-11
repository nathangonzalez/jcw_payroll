#!/usr/bin/env node
/**
 * Import exact payroll test entries for week of 2026-01-28.
 * Inserts via API as SUBMITTED status, ready for admin approval.
 * 
 * Usage: node scripts/import_test_entries.mjs
 * Set BASE_URL env var to target prod/patch (default: http://localhost:3000)
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '7707';

// Exact entries from the user's payroll spreadsheet (week of 2026-01-28)
const ENTRIES = [
  // --- Behrens ---
  { date: '2026-01-28', employee: 'Boban Abbate',    customer: 'Behrens',   hours: 3 },
  { date: '2026-01-29', employee: 'Boban Abbate',    customer: 'Behrens',   hours: 2 },
  { date: '2026-01-30', employee: 'Boban Abbate',    customer: 'Behrens',   hours: 1 },

  // --- Boyle ---
  { date: '2026-01-28', employee: 'Boban Abbate',    customer: 'Boyle',     hours: 3.5 },
  { date: '2026-01-29', employee: 'Boban Abbate',    customer: 'Boyle',     hours: 6 },
  { date: '2026-01-29', employee: 'Doug Kinsey',     customer: 'Boyle',     hours: 7 },
  { date: '2026-01-29', employee: 'Sean Matthew',    customer: 'Boyle',     hours: 5.5 },
  { date: '2026-01-29', employee: 'Thomas Brinson',  customer: 'Boyle',     hours: 3.5 },
  { date: '2026-01-29', employee: 'Thomas Brinson',  customer: 'Boyle',     hours: 1 },
  { date: '2026-01-30', employee: 'Boban Abbate',    customer: 'Boyle',     hours: 7 },
  { date: '2026-01-30', employee: 'Jason Green',     customer: 'Boyle',     hours: 4.5 },
  { date: '2026-01-30', employee: 'Sean Matthew',    customer: 'Boyle',     hours: 4.5 },
  { date: '2026-02-02', employee: 'Boban Abbate',    customer: 'Boyle',     hours: 7.5 },
  { date: '2026-02-02', employee: 'Doug Kinsey',     customer: 'Boyle',     hours: 4 },
  { date: '2026-02-02', employee: 'Doug Kinsey',     customer: 'Boyle',     hours: 2.5 },
  { date: '2026-02-02', employee: 'Jason Green',     customer: 'Boyle',     hours: 1.5 },
  { date: '2026-02-02', employee: 'Jason Green',     customer: 'Boyle',     hours: 4 },
  { date: '2026-02-02', employee: 'Sean Matthew',    customer: 'Boyle',     hours: 8 },
  { date: '2026-02-02', employee: 'Thomas Brinson',  customer: 'Boyle',     hours: 2.5 },
  { date: '2026-02-02', employee: 'Thomas Brinson',  customer: 'Boyle',     hours: 1.5 },
  { date: '2026-02-03', employee: 'Boban Abbate',    customer: 'Boyle',     hours: 8 },
  { date: '2026-02-03', employee: 'Doug Kinsey',     customer: 'Boyle',     hours: 4.5 },
  { date: '2026-02-03', employee: 'Doug Kinsey',     customer: 'Boyle',     hours: 1.5 },
  { date: '2026-02-03', employee: 'Sean Matthew',    customer: 'Boyle',     hours: 7 },

  // --- Gee ---
  { date: '2026-02-02', employee: 'Jason Green',     customer: 'Gee',       hours: 0.5 },

  // --- Landy ---
  { date: '2026-01-28', employee: 'Jason Green',     customer: 'Landy',     hours: 7.5 },
  { date: '2026-01-28', employee: 'Sean Matthew',    customer: 'Landy',     hours: 8 },
  { date: '2026-01-28', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 4.5 },
  { date: '2026-01-28', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 3.5 },
  { date: '2026-01-29', employee: 'Doug Kinsey',     customer: 'Landy',     hours: 1.5 },
  { date: '2026-01-29', employee: 'Jason Green',     customer: 'Landy',     hours: 8 },
  { date: '2026-01-29', employee: 'Sean Matthew',    customer: 'Landy',     hours: 2.5 },
  { date: '2026-01-29', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 1.5 },
  { date: '2026-01-29', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 2.5 },
  { date: '2026-01-30', employee: 'Doug Kinsey',     customer: 'Landy',     hours: 5 },
  { date: '2026-01-30', employee: 'Jason Green',     customer: 'Landy',     hours: 3.5 },
  { date: '2026-01-30', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 4.5 },
  { date: '2026-01-30', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 3.5 },
  { date: '2026-02-02', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 1 },
  { date: '2026-02-02', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 1 },
  { date: '2026-02-02', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 1.5 },
  { date: '2026-02-03', employee: 'Jason Green',     customer: 'Landy',     hours: 8 },
  { date: '2026-02-03', employee: 'Sean Matthew',    customer: 'Landy',     hours: 1 },
  { date: '2026-02-03', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 4.5 },
  { date: '2026-02-03', employee: 'Thomas Brinson',  customer: 'Landy',     hours: 3.5 },

  // --- Lucas ---
  { date: '2026-02-02', employee: 'Jason Green',     customer: 'Lucas',     hours: 1 },

  // --- Lynn ---
  { date: '2026-01-30', employee: 'Doug Kinsey',     customer: 'Lynn',      hours: 2 },
  { date: '2026-02-02', employee: 'Doug Kinsey',     customer: 'Lynn',      hours: 1.5 },
  { date: '2026-02-03', employee: 'Doug Kinsey',     customer: 'Lynn',      hours: 2 },

  // --- O'Connor ---
  { date: '2026-01-28', employee: 'Jason Green',     customer: "O'Connor",  hours: 0.5 },

  // --- PTO ---
  { date: '2026-01-28', employee: 'Doug Kinsey',     customer: 'PTO',       hours: 8 },

  // --- Schroeder ---
  { date: '2026-02-02', employee: 'Jason Green',     customer: 'Schroeder', hours: 1 },

  // --- Theobald ---
  { date: '2026-01-28', employee: 'Boban Abbate',    customer: 'Theobald',  hours: 1.5 },

  // --- Walsh ---
  { date: '2026-02-02', employee: 'Boban Abbate',    customer: 'Walsh',     hours: 0.5 },

  // --- Watkins ---
  { date: '2026-01-28', employee: 'Phil Henderson',  customer: 'Watkins',   hours: 8 },
  { date: '2026-01-29', employee: 'Phil Henderson',  customer: 'Watkins',   hours: 8 },
  { date: '2026-01-30', employee: 'Phil Henderson',  customer: 'Watkins',   hours: 9 },
  { date: '2026-01-30', employee: 'Doug Kinsey',     customer: 'Watkins',   hours: 1.75 },
  { date: '2026-01-30', employee: 'Sean Matthew',    customer: 'Watkins',   hours: 3.5 },
  { date: '2026-02-02', employee: 'Doug Kinsey',     customer: 'Watkins',   hours: 0.5 },
  { date: '2026-02-02', employee: 'Phil Henderson',  customer: 'Watkins',   hours: 8 },
  { date: '2026-02-03', employee: 'Phil Henderson',  customer: 'Watkins',   hours: 8 },
];

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { ...opts.headers };
  if (ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  console.log(`Importing ${ENTRIES.length} payroll entries for week of 2026-01-28`);
  console.log(`Target: ${BASE}\n`);

  // Get employees and customers from DB
  const employees = await api('/api/employees');
  const customers = await api('/api/customers');
  
  console.log(`Found ${employees.length} employees, ${customers.length} customers\n`);

  // Build lookup maps (case-insensitive)
  const empMap = new Map();
  for (const e of employees) empMap.set(e.name.toLowerCase(), e);
  
  const custMap = new Map();
  for (const c of customers) custMap.set(c.name.toLowerCase(), c);

  let created = 0, skipped = 0, errors = 0;
  const newCustomers = new Set();

  for (const entry of ENTRIES) {
    const emp = empMap.get(entry.employee.toLowerCase());
    if (!emp) {
      console.log(`  ✗ Employee not found: ${entry.employee}`);
      errors++;
      continue;
    }

    // Find or create customer
    let cust = custMap.get(entry.customer.toLowerCase());
    if (!cust) {
      if (!newCustomers.has(entry.customer.toLowerCase())) {
        try {
          const res = await api('/api/customers/find-or-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: entry.customer, address: '' })
          });
          cust = res.customer;
          custMap.set(entry.customer.toLowerCase(), cust);
          newCustomers.add(entry.customer.toLowerCase());
          console.log(`  + Created customer: ${entry.customer}`);
        } catch (err) {
          console.log(`  ✗ Failed to create customer ${entry.customer}: ${err.message}`);
          errors++;
          continue;
        }
      } else {
        cust = custMap.get(entry.customer.toLowerCase());
      }
    }

    if (!cust) {
      console.log(`  ✗ Customer not found/created: ${entry.customer}`);
      errors++;
      continue;
    }

    try {
      await api('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: emp.id,
          customer_id: cust.id,
          work_date: entry.date,
          hours: entry.hours,
          start_time: '',
          end_time: '',
          notes: ''
        })
      });
      created++;
    } catch (err) {
      console.log(`  ✗ ${entry.date} ${entry.employee} ${entry.customer}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Created: ${created}`);
  console.log(`Errors: ${errors}`);

  // Now submit all entries for each employee
  console.log(`\nSubmitting entries for each employee...`);
  const WEEK_START = '2026-01-28';
  const uniqueEmps = [...new Set(ENTRIES.map(e => e.employee))];
  
  for (const empName of uniqueEmps) {
    const emp = empMap.get(empName.toLowerCase());
    if (!emp) continue;
    try {
      await api('/api/submit-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: emp.id,
          week_start: WEEK_START,
          comment: ''
        })
      });
      console.log(`  ✓ Submitted week for ${empName}`);
    } catch (err) {
      console.log(`  ⚠ ${empName}: ${err.message}`);
    }
  }

  // Show summary
  const approvals = await api(`/api/approvals?week_start=${WEEK_START}`);
  console.log(`\n=== Pending Approvals for ${WEEK_START} ===`);
  console.log(`Submitted entries: ${approvals.submitted?.length || 0}`);
  if (approvals.submitted?.length > 0) {
    const totalHours = approvals.submitted.reduce((sum, e) => sum + Number(e.hours), 0);
    console.log(`Total hours: ${totalHours}`);
  }
  
  console.log(`\nDone! Entries are SUBMITTED and ready for admin approval.`);
  console.log(`Open admin panel and approve, then download Monthly Report for 2026-02.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Submit time entries for each employee.
 * Run: node scripts/submit_entries.mjs
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '7707';
const WEEK_START = '2026-01-28';

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
  console.log(`Submitting entries for week ${WEEK_START}`);
  console.log(`Base URL: ${BASE}\n`);

  // Get employees
  const employees = await api('/api/employees');
  console.log(`Found ${employees.length} employees\n`);

  // Submit for each employee
  for (const emp of employees) {
    try {
      await api('/api/submit-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: emp.id,
          week_start: WEEK_START,
          comment: 'Test import'
        })
      });
      console.log(`✓ Submitted week for ${emp.name}`);
    } catch (err) {
      console.log(`⚠ ${emp.name}: ${err.message}`);
    }
  }

  // Check approvals
  const approvals = await api(`/api/approvals?week_start=${WEEK_START}`);
  console.log(`\n=== Approvals for ${WEEK_START} ===`);
  console.log(`Submitted entries: ${approvals.submitted.length}`);
  
  if (approvals.submitted.length > 0) {
    const totalHours = approvals.submitted.reduce((sum, e) => sum + Number(e.hours), 0);
    console.log(`Total hours: ${totalHours}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

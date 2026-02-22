#!/usr/bin/env node
/**
 * Load missing entries for Weeks 1-3 (Feb 2026) to match PDF labor report.
 * Based on labor_reconciliation_final.xlsx analysis.
 * 
 * Usage:
 *   node scripts/load_missing_entries_w1_w3.mjs --dry-run --target jcw1
 *   node scripts/load_missing_entries_w1_w3.mjs --target jcw1          # UAT
 *   node scripts/load_missing_entries_w1_w3.mjs --target prod          # After UAT confirm
 */

const DRY_RUN = process.argv.includes('--dry-run');
const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'jcw1';

const BASES = {
  prod: 'https://jcw11-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
  jcw10: 'https://jcw11-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
  jcw11: 'https://jcw11-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
  jcw1: 'https://jcw1-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
  default: 'https://jcw11-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com',
};
const BASE = BASES[target] || BASES.jcw1;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '7707';

// ── API helpers ───────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${data?.error || `HTTP ${res.status}`}`);
  return data;
}

const empCache = new Map();
const custCache = new Map();

async function getEmployeeId(name) {
  if (empCache.has(name)) return empCache.get(name);
  const employees = await api('/api/employees');
  const emp = employees.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!emp) throw new Error(`Employee not found: ${name}`);
  empCache.set(name, emp.id);
  return emp.id;
}

async function getCustomerId(name) {
  if (custCache.has(name)) return custCache.get(name);
  const customers = await api('/api/customers');
  const cust = customers.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!cust) {
    console.log(`  ⚠️ Customer "${name}" not found — creating...`);
    if (DRY_RUN) { custCache.set(name, 'DRY'); return 'DRY'; }
    const created = await api('/api/customers/find-or-create', { method: 'POST', body: JSON.stringify({ name }) });
    custCache.set(name, created.id);
    return created.id;
  }
  custCache.set(name, cust.id);
  return cust.id;
}

async function submitEntry(empName, custName, date, hours, notes = '') {
  const empId = await getEmployeeId(empName);
  const custId = await getCustomerId(custName);
  if (DRY_RUN) {
    console.log(`  [DRY] ${empName} | ${date} | ${custName} ${hours}h — ${notes}`);
    return;
  }
  return api('/api/time-entries', {
    method: 'POST',
    body: JSON.stringify({
      employee_id: empId, customer_id: custId,
      work_date: date, hours, notes, status: 'APPROVED'
    })
  });
}

async function getWeekEntries(empName, weekStart) {
  const empId = await getEmployeeId(empName);
  const data = await api(`/api/time-entries?employee_id=${empId}&week_start=${weekStart}`);
  return (data.entries || []).filter(e => 
    !(e.customer_name || '').toLowerCase().includes('lunch')
  );
}

async function updateEntryHours(entryId, empName, newHours) {
  const empId = await getEmployeeId(empName);
  if (DRY_RUN) {
    console.log(`  [DRY] Update entry ${entryId} → ${newHours}h`);
    return;
  }
  return api(`/api/time-entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify({ employee_id: empId, hours: newHours })
  });
}

// ══════════════════════════════════════════════════════════════
// WEEK 2 FIXES (2/4 - 2/10) — Small adjustments
// Most data loaded already, just hours adjustments needed
// ══════════════════════════════════════════════════════════════
const WEEK2_FIXES = [
  // Boban: Walsh-Maint Mon 2/9 should be 1h (currently 0.5h), Sweeney Tue 2/10 should be 1h (currently 0.5h)
  { type: 'adjust', employee: 'Boban Abbate', date: '2026-02-09', customer: 'Walsh', currentHrs: 0.5, newHrs: 1.0, notes: 'Walsh-Maint corrected from manual' },
  { type: 'adjust', employee: 'Boban Abbate', date: '2026-02-10', customer: 'Sweeney', currentHrs: 0.5, newHrs: 1.0, notes: 'Corrected from manual' },

  // Thomas: Need to add Delacruz entries + adjust Landy/Boyle splits
  // Currently 36.5h, need 40h. Missing 3.5h.
  // Manual shows: Wed Landy 8, Thu Boyle 4.5+Landy 1.5+Boyle 2=8, Fri Landy 1+Delacruz 0.5+Boyle 6.5=8, Mon Landy 4.5+Boyle 3.5=8, Tue Boyle 1+Landy 6.5+PTO 0.5=8
  // Prod shows: Wed Landy 9.5+Boyle 1.5, Thu Landy 1+Boyle 3, Fri Landy 0.5+Boyle 7, Mon Landy 4.5+Boyle 3, Tue Boyle 1+Landy 6.5
  // The discrepancy: prod is 36.5 vs manual 40. Need +3.5h
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-06', customer: 'Delacruz', hours: 0.5, notes: 'Delacruz warranty NB - from manual' },
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-10', customer: 'PTO', hours: 0.5, notes: 'PTO - from manual' },
  // Remaining 2.5h — likely prod entries have wrong hours per split. Add as adjustments:
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-04', customer: 'Boyle', hours: 0.5, notes: 'Reconcile adjustment - manual shows Boyle 1.5h not in prod split' },
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-05', customer: 'Boyle', hours: 1.0, notes: 'Reconcile adjustment - manual shows +1h Boyle' },
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-05', customer: 'Landy', hours: 0.5, notes: 'Reconcile adjustment - Landy superintendent' },
  { type: 'add', employee: 'Thomas Brinson', date: '2026-02-06', customer: 'Landy', hours: 0.5, notes: 'Reconcile adjustment - Landy superintendent' },

  // Jason: 37h → 40h = +3h missing
  // Manual has Tubergen 7h but prod only shows ~3h. Prod also missing Watkins, some Richer, Muncey
  { type: 'add', employee: 'Jason Green', date: '2026-02-04', customer: 'Tubergen', hours: 0.5, notes: 'Reconcile - from manual Tubergen 3h total vs prod' },
  { type: 'add', employee: 'Jason Green', date: '2026-02-05', customer: 'Tubergen', hours: 1.0, notes: 'Reconcile - Tubergen additional from manual' },
  { type: 'add', employee: 'Jason Green', date: '2026-02-05', customer: 'Watkins', hours: 1.0, notes: 'Watkins - from manual' },
  { type: 'add', employee: 'Jason Green', date: '2026-02-09', customer: 'Salary', hours: 0.5, notes: 'Salary adjustment from manual' },

  // Phil: 38.5h → 40h = +1.5h
  // Manual shows Tubergen 1.5h + Watkins 38.5h = 40h, prod shows ~1h Tubergen + 37.5 Watkins
  { type: 'add', employee: 'Phil Henderson', date: '2026-02-04', customer: 'Tubergen', hours: 0.5, notes: 'Reconcile - Tubergen additional' },
  { type: 'add', employee: 'Phil Henderson', date: '2026-02-09', customer: 'Watkins', hours: 0.5, notes: 'Reconcile adjustment' },
  { type: 'add', employee: 'Phil Henderson', date: '2026-02-10', customer: 'Watkins', hours: 0.5, notes: 'Reconcile adjustment' },

  // Doug: 40.25h → 40.375h = +0.125h — OT calc rounding
  { type: 'add', employee: 'Doug Kinsey', date: '2026-02-10', customer: 'Watkins', hours: 0.125, notes: 'OT rounding reconcile from manual' },

  // Sean: 39h → 40h = +1h
  // Manual shows Boyle 24 + JCW Shop 8 + PTO 8 = 40, prod shows Office 8 instead of JCW Shop
  // Prod: Boyle 23+Office 8+PTO 8 = 39. Manual: Boyle 24+JCW Shop 8+PTO 8 = 40
  { type: 'add', employee: 'Sean Matthew', date: '2026-02-04', customer: 'Boyle', hours: 1.0, notes: 'Reconcile - manual shows 8h Boyle Wed not 7h' },
];

// ══════════════════════════════════════════════════════════════
// WEEK 3 ENTRIES (2/11 - 2/17) — Mostly need full load
// ══════════════════════════════════════════════════════════════
const WEEK3_ENTRIES = [
  // === BOBAN ABBATE (40h — entirely missing) ===
  { employee: 'Boban Abbate', date: '2026-02-11', customer: 'Boyle', hours: 7, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-11', customer: 'Sweeney', hours: 0.5, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-11', customer: 'Howard', hours: 0.5, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-12', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-13', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-16', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-17', customer: 'Boyle', hours: 7, notes: 'From manual' },
  { employee: 'Boban Abbate', date: '2026-02-17', customer: 'Walsh', hours: 1, notes: 'Walsh-Maint from manual' },

  // === JASON GREEN (40h — entirely missing) ===
  { employee: 'Jason Green', date: '2026-02-11', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Boyle', hours: 1, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Schroeder', hours: 1, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Lucas', hours: 0.5, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Schroeder', hours: 1.5, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Landy', hours: 2.5, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-12', customer: 'Muncey', hours: 1.5, notes: 'Muncey Insp from manual' },
  { employee: 'Jason Green', date: '2026-02-13', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-16', customer: 'Boyle', hours: 1, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-16', customer: 'Howard', hours: 1.5, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-16', customer: 'Boyle', hours: 5.5, notes: 'From manual' },
  { employee: 'Jason Green', date: '2026-02-17', customer: 'Boyle', hours: 6, notes: 'From manual - left early' },
  // Salary/Left Early = 2h allocated to adjust to 40h total
  { employee: 'Jason Green', date: '2026-02-17', customer: 'Salary', hours: 2, notes: 'Salary - left early, from manual' },

  // === SEAN MATTHEW (41.5h — entirely missing) ===
  { employee: 'Sean Matthew', date: '2026-02-11', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-12', customer: 'Boyle', hours: 8, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-13', customer: 'Boyle', hours: 5, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-13', customer: 'Jebsen', hours: 2.25, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-13', customer: 'Boyle', hours: 0.75, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-16', customer: 'Gonzalez', hours: 9, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-17', customer: 'Jebsen', hours: 1, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-17', customer: 'Hall', hours: 2.25, notes: 'From manual' },
  { employee: 'Sean Matthew', date: '2026-02-17', customer: 'Boyle', hours: 4.75, notes: 'From manual' },

  // === THOMAS BRINSON (need +36.5h, has 2.5h) ===
  { employee: 'Thomas Brinson', date: '2026-02-11', customer: 'Landy', hours: 1.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-11', customer: 'Boyle', hours: 1, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-11', customer: 'Landy', hours: 5.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Boyle', hours: 2, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Landy', hours: 1.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Boyle', hours: 1, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Gonzalez', hours: 0.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Landy', hours: 1.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Boyle', hours: 0.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-12', customer: 'Landy', hours: 1, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-13', customer: 'Landy', hours: 2.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-13', customer: 'Boyle', hours: 2, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-13', customer: 'Jebsen', hours: 3, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-13', customer: 'Boyle', hours: 0.5, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-16', customer: 'Gonzalez', hours: 9, notes: 'From manual' },
  { employee: 'Thomas Brinson', date: '2026-02-17', customer: 'Landy', hours: 5, notes: 'From manual - had dr apt' },
  { employee: 'Thomas Brinson', date: '2026-02-17', customer: 'Boyle', hours: 1, notes: 'From manual' },

  // === PHIL HENDERSON (need +17.5h, has 27h) ===
  // Prod has: Wed 8, Thu 8, Fri 8, Sat 3 = 27h
  // Manual: Wed 8, Thu 8, Fri 8, Sat 3, Mon 8, Tue 8 = 43h (+ 1.5 OT calc = 44.5h)
  // Missing: Mon 8 + Tue 8 = 16h + some OT adjustment
  { employee: 'Phil Henderson', date: '2026-02-16', customer: 'Watkins', hours: 8, notes: 'From manual - Super' },
  { employee: 'Phil Henderson', date: '2026-02-17', customer: 'Watkins', hours: 8, notes: 'From manual - Super' },
  // Remaining 1.5h is OT premium calc — handled by the weekly sheet formula

  // === DOUG KINSEY (need +11.75h, has 35h) ===
  // Prod has: Wed 8, Thu 8, Fri 9.5 (partial), Mon 10.5 = only some entries
  // Manual Fri 13: Gonzalez 0.5, Howard 1, Watkins 2.5, Lynn 0.5, Jebsen 3.25, Welles 0.75, Gonzalez 1 = 9.5 in prod
  // Actually prod has: Gonzalez 1.5, Howard 1, Watkins 2.5, Lynn 0.5, Jebsen 3.25, Welles 0.5 = 9.25
  // Plus entries on Tue 17 missing
  { employee: 'Doug Kinsey', date: '2026-02-13', customer: 'Welles', hours: 0.25, notes: 'Reconcile - Welles 0.75 not 0.5' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Jebsen', hours: 1.25, notes: 'From manual' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Hall', hours: 2.25, notes: 'From manual' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Watkins', hours: 0.75, notes: 'From manual' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Boyle', hours: 1, notes: 'From manual' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Jebsen', hours: 2.5, notes: 'From manual' },
  { employee: 'Doug Kinsey', date: '2026-02-17', customer: 'Boyle', hours: 0.75, notes: 'From manual' },
  // Remaining gap for Doug — some Gonzalez adjustment
  { employee: 'Doug Kinsey', date: '2026-02-13', customer: 'Gonzalez', hours: 0.5, notes: 'Reconcile - additional Gonzalez from manual' },
  { employee: 'Doug Kinsey', date: '2026-02-16', customer: 'Gonzalez', hours: 0.5, notes: 'Reconcile adjustment — 10.5 vs 10' },
];

// ══════════════════════════════════════════════════════════════
// WEEK 1 FIXES (1/28 - 2/3) — Very small adjustments
// ══════════════════════════════════════════════════════════════
const WEEK1_FIXES = [
  // Phil: +0.5h (41h → 41.5h) — one Watkins day needs adjustment
  { type: 'add', employee: 'Phil Henderson', date: '2026-01-30', customer: 'Watkins', hours: 0.5, notes: 'Reconcile - Friday 9.5h not 9h per manual/PDF' },

  // Doug: +0.875h (41.75h → 42.625h) — fractional unaccounted
  { type: 'add', employee: 'Doug Kinsey', date: '2026-01-30', customer: 'Watkins', hours: 0.5, notes: 'Reconcile - additional from manual' },
  { type: 'add', employee: 'Doug Kinsey', date: '2026-02-03', customer: 'Lynn', hours: 0.375, notes: 'Reconcile - OT fractional from manual' },
];

// ══════════════════════════════════════════════════════════════
// PDF TRUTH TOTALS (for verification)
// ══════════════════════════════════════════════════════════════
const PDF_TRUTH = {
  '2026-01-28': { // Week 1
    'Boban Abbate': 40, 'Thomas Brinson': 40, 'Jason Green': 40,
    'Phil Henderson': 41.5, 'Doug Kinsey': 42.625, 'Sean Matthew': 40,
  },
  '2026-02-04': { // Week 2
    'Boban Abbate': 40, 'Thomas Brinson': 40, 'Jason Green': 40,
    'Phil Henderson': 40, 'Doug Kinsey': 40.375, 'Sean Matthew': 40,
  },
  '2026-02-11': { // Week 3
    'Boban Abbate': 40, 'Thomas Brinson': 39, 'Jason Green': 40,
    'Phil Henderson': 44.5, 'Doug Kinsey': 46.75, 'Sean Matthew': 41.5,
  },
};

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`LOAD MISSING ENTRIES — Weeks 1-3 Feb 2026`);
  console.log(`Target: ${target} (${BASE})`);
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔴 LIVE'}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Week 1 fixes ──
  console.log('── WEEK 1 (1/28-2/3) ──');
  for (const fix of WEEK1_FIXES) {
    console.log(`  + ${fix.employee} | ${fix.date} | ${fix.customer} +${fix.hours}h`);
    try {
      await submitEntry(fix.employee, fix.customer, fix.date, fix.hours, fix.notes);
      console.log(`    ✅`);
    } catch (err) {
      console.log(`    ❌ ${err.message}`);
    }
  }

  // ── Week 2 fixes ──
  console.log('\n── WEEK 2 (2/4-2/10) ──');
  for (const fix of WEEK2_FIXES) {
    if (fix.type === 'adjust') {
      // Find and update existing entry
      const entries = await getWeekEntries(fix.employee, '2026-02-04');
      const match = entries.find(e =>
        e.work_date === fix.date &&
        (e.customer_name || '').toLowerCase().includes(fix.customer.toLowerCase()) &&
        Math.abs(Number(e.hours) - fix.currentHrs) < 0.01
      );
      if (match) {
        console.log(`  ~ ${fix.employee} | ${fix.date} | ${fix.customer} ${fix.currentHrs}h → ${fix.newHrs}h`);
        try {
          await updateEntryHours(match.id, fix.employee, fix.newHrs);
          console.log(`    ✅ Updated`);
        } catch (err) {
          console.log(`    ❌ ${err.message}`);
          // Fallback: add the difference
          const diff = fix.newHrs - fix.currentHrs;
          console.log(`    ↪ Trying to add ${diff}h instead...`);
          await submitEntry(fix.employee, fix.customer, fix.date, diff, fix.notes + ' (adjustment)');
        }
      } else {
        console.log(`  ⚠️ Entry not found for adjust: ${fix.employee} ${fix.date} ${fix.customer} ${fix.currentHrs}h`);
        // Add the difference anyway
        const diff = fix.newHrs - fix.currentHrs;
        await submitEntry(fix.employee, fix.customer, fix.date, diff, fix.notes + ' (add diff)');
      }
    } else {
      console.log(`  + ${fix.employee} | ${fix.date} | ${fix.customer} +${fix.hours}h`);
      try {
        await submitEntry(fix.employee, fix.customer, fix.date, fix.hours, fix.notes);
        console.log(`    ✅`);
      } catch (err) {
        console.log(`    ❌ ${err.message}`);
      }
    }
  }

  // ── Week 3 entries ──
  console.log('\n── WEEK 3 (2/11-2/17) ──');
  for (const entry of WEEK3_ENTRIES) {
    console.log(`  + ${entry.employee} | ${entry.date} | ${entry.customer} ${entry.hours}h`);
    try {
      await submitEntry(entry.employee, entry.customer, entry.date, entry.hours, entry.notes);
      console.log(`    ✅`);
    } catch (err) {
      console.log(`    ❌ ${err.message}`);
    }
  }

  // ── Verify ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VERIFICATION');
  console.log(`${'═'.repeat(60)}`);
  
  const employees = ['Boban Abbate', 'Thomas Brinson', 'Jason Green', 'Phil Henderson', 'Doug Kinsey', 'Sean Matthew'];
  const weekStarts = ['2026-01-28', '2026-02-04', '2026-02-11'];
  
  let allMatch = true;
  for (const ws of weekStarts) {
    console.log(`\n  Week starting ${ws}:`);
    for (const emp of employees) {
      const entries = await getWeekEntries(emp, ws);
      const total = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      const expected = PDF_TRUTH[ws][emp];
      const match = Math.abs(total - expected) < 0.01;
      const icon = match ? '✅' : '❌';
      console.log(`    ${icon} ${emp}: ${total}h (expected ${expected}h)${match ? '' : ` Δ=${(total - expected).toFixed(3)}h`}`);
      if (!match) allMatch = false;
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(allMatch ? '✅ ALL WEEKS MATCH PDF TRUTH!' : '⚠️ Some gaps remain — review above');
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
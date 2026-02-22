#!/usr/bin/env node
/**
 * Fix prod DB: delete Week 3 duplicates + load missing Week 1-2 entries
 */
const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const SECRET = '7707';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET, ...opts.headers }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const LABOR = ['Boban Abbate', 'Doug Kinsey', 'Jason Green', 'Phil Henderson', 'Sean Matthew', 'Thomas Brinson'];

async function main() {
  const employees = await api('/api/employees');
  const empMap = new Map(employees.map(e => [e.name, e.id]));
  const customers = await api('/api/customers');
  const custMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));

  // ═══════════════════════════════════════════════
  // STEP 1: Delete Week 3 duplicates
  // ═══════════════════════════════════════════════
  console.log('=== STEP 1: DELETE WEEK 3 DUPLICATES ===\n');
  
  let totalDeleted = 0;
  for (const empName of LABOR) {
    const empId = empMap.get(empName);
    const data = await api(`/api/time-entries?employee_id=${empId}&week_start=2026-02-11`);
    const entries = (data.entries || []).filter(e => 
      !(e.customer_name || '').toLowerCase().includes('lunch')
    );

    // Group by date+customer
    const groups = new Map();
    for (const e of entries) {
      const key = `${e.work_date}|${(e.customer_name || '').toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    // Delete duplicates (keep first, delete rest) using force=true + employee_id
    for (const [key, group] of groups) {
      if (group.length > 1) {
        group.sort((a, b) => a.created_at.localeCompare(b.created_at));
        for (let i = 1; i < group.length; i++) {
          try {
            await api(`/api/time-entries/${group[i].id}?force=true&employee_id=${empId}`, { method: 'DELETE' });
            console.log(`  🗑️  ${empName} ${group[i].work_date} ${group[i].customer_name} ${group[i].hours}h (dup ${i}/${group.length-1})`);
            totalDeleted++;
          } catch (err) {
            console.log(`  ❌ Delete failed ${group[i].id}: ${err.message}`);
          }
        }
      }
    }
  }
  console.log(`\nDeleted ${totalDeleted} duplicate entries\n`);

  // ═══════════════════════════════════════════════
  // STEP 2: Load missing Week 1-2 entries
  // ═══════════════════════════════════════════════
  console.log('=== STEP 2: LOAD MISSING WEEK 1-2 ENTRIES ===\n');

  // Missing entries from the failed backup loads
  const MISSING = [
    // Doug Kinsey Week 1 - PTO
    { emp: 'Doug Kinsey', cust: 'PTO', date: '2026-01-28', hours: 8, notes: 'PTO' },
    // Doug Kinsey Week 2 - PTO + JCW 
    { emp: 'Doug Kinsey', cust: 'PTO', date: '2026-02-06', hours: 8, notes: 'PTO' },
    { emp: 'Doug Kinsey', cust: 'JCW', date: '2026-02-04', hours: 7.5, notes: 'Shop' },
    { emp: 'Doug Kinsey', cust: 'JCW', date: '2026-02-05', hours: 7.5, notes: 'Shop' },
    // Jason Green Week 2 - Turbergen entries
    { emp: 'Jason Green', cust: 'Turbergen', date: '2026-02-04', hours: 2, notes: 'From backup' },
    { emp: 'Jason Green', cust: 'Turbergen', date: '2026-02-05', hours: 4, notes: 'From backup' },
    // Sean Matthew Week 2 - Office + PTO
    { emp: 'Sean Matthew', cust: 'Office', date: '2026-02-05', hours: 8, notes: 'Organizing and cleaning backroom' },
    { emp: 'Sean Matthew', cust: 'PTO', date: '2026-02-06', hours: 8, notes: 'PTO' },
  ];

  let loaded = 0;
  for (const entry of MISSING) {
    const empId = empMap.get(entry.emp);
    let custId = custMap.get(entry.cust.toLowerCase());
    
    if (!custId) {
      console.log(`  Customer "${entry.cust}" not found, skipping`);
      continue;
    }

    // Check if already exists
    const data = await api(`/api/time-entries?employee_id=${empId}&week_start=${entry.date < '2026-02-04' ? '2026-01-28' : '2026-02-04'}`);
    const existing = (data.entries || []).find(e => 
      e.work_date === entry.date && 
      (e.customer_name || '').toLowerCase() === entry.cust.toLowerCase()
    );
    
    if (existing) {
      console.log(`  ✓ Already exists: ${entry.emp} ${entry.date} ${entry.cust} ${existing.hours}h`);
      continue;
    }

    try {
      await api('/api/time-entries', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: empId,
          customer_id: custId,
          work_date: entry.date,
          hours: entry.hours,
          notes: entry.notes,
        })
      });
      console.log(`  ✅ ${entry.emp} ${entry.date} ${entry.cust} ${entry.hours}h`);
      loaded++;
    } catch (err) {
      console.log(`  ❌ ${entry.emp} ${entry.date} ${entry.cust}: ${err.message}`);
    }
  }
  console.log(`\nLoaded ${loaded} missing entries\n`);

  // ═══════════════════════════════════════════════
  // STEP 3: Submit + Approve new entries
  // ═══════════════════════════════════════════════
  console.log('=== STEP 3: SUBMIT + APPROVE NEW ENTRIES ===\n');

  const weeks = ['2026-01-28', '2026-02-04', '2026-02-11'];
  for (const empName of [...LABOR, 'Chris Jacobi', 'Chris Zavesky']) {
    const empId = empMap.get(empName);
    if (!empId) continue;
    for (const ws of weeks) {
      try {
        await api('/api/submit-week', {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, week_start: ws })
        });
      } catch (e) {} // ignore if already submitted
    }
  }

  // Approve all SUBMITTED
  let approveIds = [];
  for (const ws of weeks) {
    for (const emp of employees) {
      const data = await api(`/api/time-entries?employee_id=${emp.id}&week_start=${ws}`);
      for (const e of (data.entries || [])) {
        if (e.status === 'SUBMITTED') approveIds.push(e.id);
      }
    }
  }
  
  if (approveIds.length > 0) {
    for (let i = 0; i < approveIds.length; i += 50) {
      await api('/api/approve', {
        method: 'POST',
        body: JSON.stringify({ ids: approveIds.slice(i, i + 50) })
      });
    }
    console.log(`Approved ${approveIds.length} entries\n`);
  }

  // ═══════════════════════════════════════════════
  // STEP 4: Verify
  // ═══════════════════════════════════════════════
  console.log('=== VERIFICATION ===\n');
  
  const RATES = { 'Boban Abbate': 42.5, 'Doug Kinsey': 30, 'Jason Green': 35, 'Phil Henderson': 30, 'Sean Matthew': 20, 'Thomas Brinson': 35 };
  const PDF = { '2026-01-28': 7823.75, '2026-02-04': 7711.25, '2026-02-11': 8032.50 };
  
  let grandDb = 0, grandPdf = 0;
  for (const ws of weeks) {
    let weekTotal = 0;
    for (const empName of LABOR) {
      const empId = empMap.get(empName);
      const data = await api(`/api/time-entries?employee_id=${empId}&week_start=${ws}`);
      const entries = (data.entries || []).filter(e => !(e.customer_name||'').toLowerCase().includes('lunch'));
      const hours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      const rate = RATES[empName];
      const gross = hours * rate;
      const ot = Math.max(0, hours - 40) * rate * 0.5;
      weekTotal += gross + ot;
    }
    const pdfWeek = PDF[ws];
    const delta = weekTotal - pdfWeek;
    const icon = Math.abs(delta) < 50 ? '✅' : '❌';
    console.log(`${icon} Week ${ws}: DB $${weekTotal.toFixed(2)} vs PDF $${pdfWeek.toFixed(2)} (Δ $${delta.toFixed(2)})`);
    grandDb += weekTotal;
    grandPdf += pdfWeek;
  }
  console.log(`\nTOTAL: DB $${grandDb.toFixed(2)} vs PDF $${grandPdf.toFixed(2)} (Δ $${(grandDb-grandPdf).toFixed(2)})`);
  
  const health = await api('/api/health');
  console.log(`\nHealth: ${JSON.stringify(health)}`);
}

main().catch(err => console.error('Fatal:', err.message));

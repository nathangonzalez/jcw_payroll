#!/usr/bin/env node
/**
 * Clean up duplicate/excess entries to match PDF truth
 * Uses force-delete (jcw12 required)
 */
const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const SECRET = '7707';

async function api(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', 'x-admin-secret': SECRET, ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const PDF_HOURS = {
  '2026-01-28': { 'Boban Abbate': 40, 'Doug Kinsey': 41.75, 'Jason Green': 40, 'Phil Henderson': 41, 'Sean Matthew': 40, 'Thomas Brinson': 40 },
  '2026-02-04': { 'Boban Abbate': 40, 'Doug Kinsey': 40.25, 'Jason Green': 40, 'Phil Henderson': 40, 'Sean Matthew': 40, 'Thomas Brinson': 40 },
  '2026-02-11': { 'Boban Abbate': 40, 'Doug Kinsey': 44.5, 'Jason Green': 40, 'Phil Henderson': 44.5, 'Sean Matthew': 41.5, 'Thomas Brinson': 39 },
};

const LABOR = ['Boban Abbate', 'Doug Kinsey', 'Jason Green', 'Phil Henderson', 'Sean Matthew', 'Thomas Brinson'];

async function main() {
  const employees = await api('/api/employees');
  const empMap = new Map(employees.map(e => [e.name, e.id]));

  let totalDeleted = 0;

  for (const ws of ['2026-02-04', '2026-02-11']) {
    console.log(`\n── Week ${ws} ──`);
    
    for (const empName of LABOR) {
      const empId = empMap.get(empName);
      const targetHours = PDF_HOURS[ws][empName];
      
      const data = await api(`/api/time-entries?employee_id=${empId}&week_start=${ws}`);
      const entries = (data.entries || []).filter(e => 
        !(e.customer_name || '').toLowerCase().includes('lunch')
      );
      
      const currentHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      const excess = currentHours - targetHours;
      
      if (excess <= 0.01) continue;
      
      console.log(`  ${empName}: ${currentHours}h (target ${targetHours}h, excess ${excess.toFixed(2)}h)`);
      
      // Sort by created_at DESC (newest first = most likely duplicates)
      const sorted = [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at));
      
      let remaining = excess;
      for (const entry of sorted) {
        if (remaining <= 0.01) break;
        const hrs = Number(entry.hours || 0);
        if (hrs <= remaining + 0.01) {
          try {
            await api(`/api/time-entries/${entry.id}?force=true&employee_id=${empId}`, { method: 'DELETE' });
            console.log(`    🗑️ Deleted: ${entry.work_date} ${entry.customer_name} ${hrs}h`);
            remaining -= hrs;
            totalDeleted++;
          } catch (err) {
            console.log(`    ❌ ${entry.id}: ${err.message}`);
          }
        }
      }
      
      if (remaining > 0.01) {
        console.log(`    ⚠️ Still ${remaining.toFixed(2)}h excess (entries too large to remove individually)`);
      }
    }
  }

  console.log(`\nDeleted ${totalDeleted} excess entries`);
  
  // Re-submit + approve anything that went to DRAFT
  console.log('\nRe-submitting + approving...');
  for (const empName of [...LABOR, 'Chris Jacobi', 'Chris Zavesky']) {
    const empId = empMap.get(empName);
    if (!empId) continue;
    for (const ws of ['2026-01-28', '2026-02-04', '2026-02-11']) {
      try { await api('/api/submit-week', { method: 'POST', body: JSON.stringify({ employee_id: empId, week_start: ws }) }); } catch(e) {}
    }
  }
  
  let approveIds = [];
  for (const ws of ['2026-01-28', '2026-02-04', '2026-02-11']) {
    for (const emp of employees) {
      const data = await api(`/api/time-entries?employee_id=${emp.id}&week_start=${ws}`);
      for (const e of (data.entries || [])) {
        if (e.status === 'SUBMITTED') approveIds.push(e.id);
      }
    }
  }
  if (approveIds.length > 0) {
    for (let i = 0; i < approveIds.length; i += 50) {
      await api('/api/approve', { method: 'POST', body: JSON.stringify({ ids: approveIds.slice(i, i + 50) }) });
    }
    console.log(`Approved ${approveIds.length} entries`);
  }

  // Verify
  console.log('\n── VERIFICATION ──');
  const RATES = { 'Boban Abbate': 42.5, 'Doug Kinsey': 30, 'Jason Green': 35, 'Phil Henderson': 30, 'Sean Matthew': 20, 'Thomas Brinson': 35 };
  const PDF_GROSS = { '2026-01-28': 7823.75, '2026-02-04': 7711.25, '2026-02-11': 8032.50 };
  
  let grandDb = 0, grandPdf = 0;
  for (const ws of ['2026-01-28', '2026-02-04', '2026-02-11']) {
    let weekTotal = 0;
    for (const empName of LABOR) {
      const empId = empMap.get(empName);
      const data = await api(`/api/time-entries?employee_id=${empId}&week_start=${ws}`);
      const entries = (data.entries || []).filter(e => !(e.customer_name||'').toLowerCase().includes('lunch'));
      const hours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      const rate = RATES[empName];
      weekTotal += hours * rate + Math.max(0, hours - 40) * rate * 0.5;
    }
    const delta = weekTotal - PDF_GROSS[ws];
    console.log(`${Math.abs(delta) < 50 ? '✅' : '❌'} Week ${ws}: DB $${weekTotal.toFixed(2)} vs PDF $${PDF_GROSS[ws]} (Δ $${delta.toFixed(2)})`);
    grandDb += weekTotal;
    grandPdf += PDF_GROSS[ws];
  }
  console.log(`\nTOTAL: DB $${grandDb.toFixed(2)} vs PDF $${grandPdf.toFixed(2)} (Δ $${(grandDb-grandPdf).toFixed(2)})`);
}

main().catch(err => console.error('Fatal:', err.message));

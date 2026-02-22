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

async function main() {
  const employees = await api('/api/employees');
  const weeks = ['2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18'];
  
  // Step 1: SUBMIT all weeks (DRAFT → SUBMITTED)
  console.log('=== SUBMITTING ALL WEEKS ===');
  for (const emp of employees) {
    for (const ws of weeks) {
      try {
        await api('/api/submit-week', {
          method: 'POST',
          body: JSON.stringify({ employee_id: emp.id, week_start: ws })
        });
        console.log(`  Submitted: ${emp.name} week ${ws}`);
      } catch (err) {
        // Might already be submitted or no entries
        console.log(`  Skip: ${emp.name} week ${ws}: ${err.message}`);
      }
    }
  }

  // Step 2: Collect all SUBMITTED entry IDs
  console.log('\n=== APPROVING ALL SUBMITTED ===');
  let allIds = [];
  for (const ws of weeks) {
    for (const emp of employees) {
      const data = await api(`/api/time-entries?employee_id=${emp.id}&week_start=${ws}`);
      const entries = data.entries || data || [];
      for (const e of entries) {
        if (e.status === 'SUBMITTED') {
          allIds.push(e.id);
        }
      }
    }
  }
  console.log(`Found ${allIds.length} SUBMITTED entries to approve`);

  // Step 3: APPROVE in batches
  for (let i = 0; i < allIds.length; i += 50) {
    const batch = allIds.slice(i, i + 50);
    try {
      await api('/api/approve', {
        method: 'POST',
        body: JSON.stringify({ ids: batch })
      });
      console.log(`  Approved batch ${i}-${i + batch.length}`);
    } catch (err) {
      console.log(`  Batch ${i} failed: ${err.message}`);
    }
  }

  // Verify
  console.log('\n=== VERIFICATION ===');
  const health = await api('/api/health');
  console.log(`Health: ${JSON.stringify(health)}`);
  
  const d = await api(`/api/time-entries?employee_id=${employees[0].id}&week_start=2026-02-04`);
  const sample = (d.entries || d || [])[0];
  if (sample) console.log(`Sample status: ${sample.status}`);
  
  // Count by status
  let statusCounts = {};
  for (const ws of weeks) {
    for (const emp of employees) {
      const data = await api(`/api/time-entries?employee_id=${emp.id}&week_start=${ws}`);
      for (const e of (data.entries || data || [])) {
        statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
      }
    }
  }
  console.log(`Status counts: ${JSON.stringify(statusCounts)}`);
}

main();

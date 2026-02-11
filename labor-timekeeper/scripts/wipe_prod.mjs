const BASE = process.env.BASE_URL || 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';

async function wipe() {
  // Close Jan
  let r = await fetch(`${BASE}/api/admin/close-month`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ month: '2026-01', confirm: true })
  });
  console.log('Close 2026-01:', await r.text());

  // Close Feb  
  r = await fetch(`${BASE}/api/admin/close-month`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ month: '2026-02', confirm: true })
  });
  console.log('Close 2026-02:', await r.text());

  // Also clear any seeded entries
  r = await fetch(`${BASE}/api/admin/clear-seeded-entries`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: '{}'
  });
  console.log('Clear seeded:', await r.text());

  // Also clear test entries
  r = await fetch(`${BASE}/api/admin/clear-test-entries`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: '{}'
  });
  console.log('Clear test:', await r.text());

  // Verify count
  r = await fetch(`${BASE}/api/admin/report-preview?month=2026-02`);
  console.log('Remaining entries:', await r.text());
}

wipe().catch(e => console.error(e));

#!/usr/bin/env node
const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const SECRET = '7707';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET, ...opts.headers }
  });
  const data = await res.json().catch(() => null);
  return data;
}

const MISSING = ['PTO', 'Turbergen', 'mulvoy', 'Office', 'doctor', 'Brooke', 'Gonzalez', 'Nathan', 'Salary', 'Delacruz', 'Cooney'];

async function main() {
  for (const name of MISSING) {
    const result = await api('/api/customers/find-or-create', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const custId = result?.customer?.id;
    const created = result?.created;
    console.log(`  ${created ? '+ Created' : '✓ Exists'}: ${name} (id=${custId})`);
  }
  
  // Verify all exist
  const all = await api('/api/customers');
  const names = new Set(all.map(c => c.name.toLowerCase()));
  for (const name of MISSING) {
    if (!names.has(name.toLowerCase())) {
      console.log(`  ⚠️ STILL MISSING: ${name}`);
    }
  }
  
  const health = await api('/api/health');
  console.log(`\nHealth: ${JSON.stringify(health)}`);
}

main();

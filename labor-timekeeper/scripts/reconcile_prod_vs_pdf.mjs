#!/usr/bin/env node
/**
 * Compare prod DB labor totals against PDF source of truth ($23,567.50)
 */
const BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';
const SECRET = '7707';

async function api(path) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': SECRET }
  });
  return res.json();
}

// PDF Source of Truth (LABOR only, page 2)
const PDF_TRUTH = {
  '2026-01-28': {  // Week ending 2/3
    'Boban Abbate': 1700.00,
    'Thomas Brinson': 1400.00,
    'Jason Green': 1400.00,
    'Phil Henderson': 1245.00,
    'Doug Kinsey': 1278.75,
    'Sean Matthew': 800.00,
  },
  '2026-02-04': {  // Week ending 2/10
    'Boban Abbate': 1700.00,
    'Thomas Brinson': 1400.00,
    'Jason Green': 1400.00,
    'Phil Henderson': 1200.00,
    'Doug Kinsey': 1211.25,
    'Sean Matthew': 800.00,
  },
  '2026-02-11': {  // Week ending 2/17
    'Boban Abbate': 1700.00,
    'Thomas Brinson': 1365.00,
    'Jason Green': 1400.00,
    'Phil Henderson': 1335.00,
    'Doug Kinsey': 1402.50,
    'Sean Matthew': 830.00,
  },
};

// Pay rates
const RATES = {
  'Boban Abbate': 42.50,
  'Doug Kinsey': 30.00,
  'Jason Green': 35.00,
  'Phil Henderson': 30.00,
  'Sean Matthew': 20.00,
  'Thomas Brinson': 35.00,
};

// Labor employees only
const LABOR = ['Boban Abbate', 'Doug Kinsey', 'Jason Green', 'Phil Henderson', 'Sean Matthew', 'Thomas Brinson'];

async function main() {
  const employees = await api('/api/employees');
  const weeks = ['2026-01-28', '2026-02-04', '2026-02-11'];

  let totalPdf = 0;
  let totalDb = 0;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('LABOR RECONCILIATION: Prod DB vs PDF Truth');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const ws of weeks) {
    const weekEnd = new Date(ws);
    weekEnd.setDate(weekEnd.getDate() + 6);
    console.log(`── Week starting ${ws} ──`);
    
    let weekPdf = 0;
    let weekDb = 0;

    for (const empName of LABOR) {
      const emp = employees.find(e => e.name === empName);
      if (!emp) { console.log(`  ⚠️ ${empName} not found`); continue; }

      const data = await api(`/api/time-entries?employee_id=${emp.id}&week_start=${ws}`);
      const entries = (data.entries || []).filter(e => 
        !(e.customer_name || '').toLowerCase().includes('lunch')
      );
      
      const hours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      const rate = RATES[empName];
      const dbGross = hours * rate;
      // OT: hours > 40 get 0.5x premium
      const otHours = Math.max(0, hours - 40);
      const otPremium = otHours * rate * 0.5;
      const dbTotal = dbGross + otPremium;
      
      const pdfGross = PDF_TRUTH[ws][empName] || 0;

      const delta = dbTotal - pdfGross;
      const icon = Math.abs(delta) < 0.01 ? '✅' : (delta < 0 ? '❌' : '⚠️');
      
      console.log(`  ${icon} ${empName.padEnd(18)} ${hours.toFixed(1).padStart(6)}h × $${rate} = $${dbGross.toFixed(2).padStart(8)} + OT $${otPremium.toFixed(2).padStart(7)} = $${dbTotal.toFixed(2).padStart(8)}  PDF: $${pdfGross.toFixed(2).padStart(8)}  Δ: $${delta.toFixed(2)}`);
      
      weekPdf += pdfGross;
      weekDb += dbTotal;
    }
    
    const weekDelta = weekDb - weekPdf;
    console.log(`  ${'─'.repeat(50)}`);
    console.log(`  Week: DB $${weekDb.toFixed(2)} vs PDF $${weekPdf.toFixed(2)} (Δ $${weekDelta.toFixed(2)})\n`);
    
    totalPdf += weekPdf;
    totalDb += weekDb;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`TOTAL LABOR: DB $${totalDb.toFixed(2)} vs PDF $${totalPdf.toFixed(2)}`);
  console.log(`DELTA: $${(totalDb - totalPdf).toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main();

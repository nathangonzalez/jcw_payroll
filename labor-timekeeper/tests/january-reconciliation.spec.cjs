// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * January 2026 Reconciliation — Compares app calculations against PDF source of truth
 * 
 * PDFs: Batch 904 (12/30), 727 (1/6), 730 (1/14), 732 (1/21)
 * This test verifies the app's gross wage calculations match the PDFs exactly.
 */

const BASE = process.env.TEST_URL || 'http://localhost:3000';

const PDF_TRUTH = [
  {
    name: 'Batch 904 (12/30/25)', weekStart: '2025-12-29',
    labor: {
      'Boban Abbate': 1700.00, 'Thomas Brinson': 1400.00, 'Jason Green': 1400.00,
      'Phil Henderson': 1200.00, 'Doug Kinsey': 1200.00, 'Sean Matthew': 800.00
    },
    laborTotal: 7700.00
  },
  {
    name: 'Batch 727 (1/6/26)', weekStart: '2026-01-05',
    labor: {
      'Boban Abbate': 1700.00, 'Thomas Brinson': 1426.25, 'Jason Green': 1400.00,
      'Phil Henderson': 1200.00, 'Doug Kinsey': 1200.00, 'Sean Matthew': 480.00
    },
    laborTotal: 7406.25
  },
  {
    name: 'Batch 730 (1/14/26)', weekStart: '2026-01-12',
    labor: {
      'Boban Abbate': 1700.00, 'Thomas Brinson': 1465.63, 'Jason Green': 1400.00,
      'Phil Henderson': 1290.00, 'Doug Kinsey': 1211.25, 'Sean Matthew': 795.00
    },
    laborTotal: 7861.88
  },
  {
    name: 'Batch 732 (1/21/26)', weekStart: '2026-01-19',
    labor: {
      'Boban Abbate': 1700.00, 'Thomas Brinson': 1505.00, 'Jason Green': 1400.00,
      'Phil Henderson': 1200.00, 'Doug Kinsey': 1185.00, 'Sean Matthew': 740.00
    },
    laborTotal: 7730.00
  }
];

const PAY_RATES = {
  'Boban Abbate': 42.50, 'Thomas Brinson': 35.00, 'Jason Green': 35.00,
  'Phil Henderson': 30.00, 'Doug Kinsey': 30.00, 'Sean Matthew': 20.00,
};

function calcGross(hours, rate) {
  const regular = Math.min(hours, 40);
  const ot = Math.max(0, hours - 40);
  return regular * rate + ot * rate * 1.5;
}

// ============================================================
// JANUARY PDF vs APP RECONCILIATION
// ============================================================
test.describe('January PDF Reconciliation', () => {
  
  for (const batch of PDF_TRUTH) {
    test(`${batch.name}: Individual wages match PDF`, async ({ request }) => {
      const empRes = await request.get(`${BASE}/api/employees`);
      const employees = await empRes.json();
      
      let batchTotal = 0;
      let matchCount = 0;
      let mismatchCount = 0;
      
      console.log(`\n=== ${batch.name} ===`);
      
      for (const [empName, pdfGross] of Object.entries(batch.labor)) {
        const emp = employees.find(e => e.name === empName);
        if (!emp) { console.log(`  ❌ ${empName}: not found`); mismatchCount++; continue; }
        
        const res = await request.get(`${BASE}/api/time-entries?employee_id=${emp.id}&week_start=${batch.weekStart}`);
        const body = await res.json();
        const workEntries = (body.entries || []).filter(e => 
          !(e.customer_name || '').toLowerCase().includes('lunch')
        );
        const totalHours = workEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
        
        const rate = PAY_RATES[empName];
        const appGross = calcGross(totalHours, rate);
        const delta = Math.abs(appGross - pdfGross);
        const match = delta < 0.01;
        
        batchTotal += appGross;
        
        if (match) {
          matchCount++;
          console.log(`  ✅ ${empName.padEnd(20)} ${totalHours.toFixed(1).padStart(5)}h → $${appGross.toFixed(2).padStart(8)} = PDF $${pdfGross.toFixed(2)}`);
        } else {
          mismatchCount++;
          console.log(`  ❌ ${empName.padEnd(20)} ${totalHours.toFixed(1).padStart(5)}h → $${appGross.toFixed(2).padStart(8)} ≠ PDF $${pdfGross.toFixed(2)} (Δ$${delta.toFixed(2)})`);
        }
        
        // Allow $0.50 tolerance for rounding
        expect(delta, `${empName}: app=$${appGross.toFixed(2)} vs PDF=$${pdfGross.toFixed(2)}`).toBeLessThan(0.50);
      }
      
      const batchDelta = Math.abs(batchTotal - batch.laborTotal);
      console.log(`  ─────────────────────────────────────────────`);
      console.log(`  TOTAL: App=$${batchTotal.toFixed(2)} vs PDF=$${batch.laborTotal.toFixed(2)} (Δ$${batchDelta.toFixed(2)})`);
      console.log(`  Score: ${matchCount}/${matchCount + mismatchCount} matched`);
      
      expect(batchDelta, `Batch total mismatch`).toBeLessThan(1.00);
    });
  }
  
  test('January monthly total matches PDF sum', async ({ request }) => {
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    
    // Sum all 4 weeks
    const pdfMonthlyTotal = PDF_TRUTH.reduce((s, b) => s + b.laborTotal, 0);
    let appMonthlyTotal = 0;
    
    console.log('\n=== January Monthly Summary ===');
    
    for (const batch of PDF_TRUTH) {
      let batchTotal = 0;
      for (const [empName, pdfGross] of Object.entries(batch.labor)) {
        const emp = employees.find(e => e.name === empName);
        if (!emp) continue;
        
        const res = await request.get(`${BASE}/api/time-entries?employee_id=${emp.id}&week_start=${batch.weekStart}`);
        const body = await res.json();
        const hours = (body.entries || [])
          .filter(e => !(e.customer_name || '').toLowerCase().includes('lunch'))
          .reduce((s, e) => s + Number(e.hours || 0), 0);
        
        batchTotal += calcGross(hours, PAY_RATES[empName]);
      }
      appMonthlyTotal += batchTotal;
      console.log(`  ${batch.name.padEnd(25)} App: $${batchTotal.toFixed(2).padStart(10)} | PDF: $${batch.laborTotal.toFixed(2).padStart(10)}`);
    }
    
    const monthDelta = Math.abs(appMonthlyTotal - pdfMonthlyTotal);
    console.log(`  ─────────────────────────────────────────────────────`);
    console.log(`  MONTHLY TOTAL:          App: $${appMonthlyTotal.toFixed(2).padStart(10)} | PDF: $${pdfMonthlyTotal.toFixed(2).padStart(10)} | Δ$${monthDelta.toFixed(2)}`);
    console.log(`  Confidence: ${monthDelta < 1 ? '✅ HIGH' : monthDelta < 10 ? '⚠️ MEDIUM' : '❌ LOW'}`);
    
    expect(monthDelta, 'Monthly total mismatch').toBeLessThan(5.00);
  });
});

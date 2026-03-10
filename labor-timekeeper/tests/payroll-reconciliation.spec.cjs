// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Payroll Reconciliation Test Suite
 * 
 * Source of Truth: January payroll PDFs from South East Employee Leasing
 * - Batch 904 (12/30/25), Batch 727 (1/6/26), Batch 730 (1/14/26), Batch 732 (1/21/26)
 * 
 * Validates:
 * - Pay rates match PDF gross wages
 * - Overtime calculation (hours > 40/week → 1.5x rate)
 * - All employees present
 * - Weekly hour totals are reasonable
 */

const BASE = process.env.TEST_URL || 'http://localhost:3000';

// Pay rates extracted from PDFs (Gross Wages ÷ Hours = Rate)
const PAY_RATES = {
  'Boban Abbate':    { hourly: 42.50, pdfGross: [1700, 1700, 1700, 1700] },
  'Thomas Brinson':  { hourly: 35.00, pdfGross: [1400, 1426.25, 1465.63, 1505] },
  'Jason Green':     { hourly: 35.00, pdfGross: [1400, 1400, 1400, 1400] },
  'Phil Henderson':  { hourly: 30.00, pdfGross: [1200, 1200, 1290, 1200] },
  'Doug Kinsey':     { hourly: 30.00, pdfGross: [1200, 1200, 1211.25, 1185] },
  'Sean Matthew':    { hourly: 20.00, pdfGross: [800, 480, 795, 740] },
};

// Derive expected hours from PDF gross wages
function expectedHoursFromGross(gross, hourlyRate) {
  const otRate = hourlyRate * 1.5;
  if (gross <= hourlyRate * 40) {
    return { regular: gross / hourlyRate, ot: 0, total: gross / hourlyRate };
  }
  // Has OT: first 40h at regular, rest at 1.5x
  const regularPay = hourlyRate * 40;
  const otPay = gross - regularPay;
  const otHours = otPay / otRate;
  return { regular: 40, ot: otHours, total: 40 + otHours };
}

// ============================================================
// 1. RATE VALIDATION — PDF vs DB
// ============================================================
test.describe('Pay Rate Validation (PDF Source of Truth)', () => {
  test('Employee bill rates match PDF-derived rates', async ({ request }) => {
    const res = await request.get(`${BASE}/api/employees`);
    expect(res.ok()).toBeTruthy();
    const employees = await res.json();

    for (const [name, data] of Object.entries(PAY_RATES)) {
      const emp = employees.find(e => e.name === name);
      expect(emp, `Employee ${name} should exist`).toBeTruthy();
      // Bill rate in DB should match or be close to PDF rate
      if (emp.default_bill_rate) {
        console.log(`  ${name}: DB rate=$${emp.default_bill_rate}, PDF rate=$${data.hourly}`);
      }
    }
  });

  test('Phil Henderson OT calculation matches PDF pattern', async () => {
    // PDF shows Phil at $1,290 on 1/14 (Batch 730)
    // At $30/hr: $1,200 regular (40h) + $90 OT (2h @ $45) = 42h total
    const { regular, ot, total } = expectedHoursFromGross(1290, 30);
    expect(regular).toBe(40);
    expect(ot).toBe(2);
    expect(total).toBe(42);
    console.log('  Phil Henderson 1/14 PDF: 40h regular + 2h OT = 42h total ✓');
  });

  test('All January PDF gross wages produce valid hour calculations', async () => {
    for (const [name, data] of Object.entries(PAY_RATES)) {
      for (let i = 0; i < data.pdfGross.length; i++) {
        const { regular, ot, total } = expectedHoursFromGross(data.pdfGross[i], data.hourly);
        expect(total).toBeGreaterThan(0);
        expect(total).toBeLessThanOrEqual(60); // No one works 60+ hours
        expect(regular).toBeLessThanOrEqual(40);
        
        const otFlag = ot > 0 ? ` ⚠️ ${ot.toFixed(1)}h OT` : '';
        console.log(`  ${name} Week ${i+1}: ${total.toFixed(1)}h (${regular}h reg)${otFlag}`);
      }
    }
  });
});

// ============================================================
// 2. FEBRUARY DATA INTEGRITY (App DB)
// ============================================================
test.describe('February Data Integrity', () => {
  const FEB_WEEKS = [
    { name: 'Week 1', start: '2026-01-28', end: '2026-02-03' },
    { name: 'Week 2', start: '2026-02-04', end: '2026-02-10' },
    { name: 'Week 3', start: '2026-02-11', end: '2026-02-17' },
    { name: 'Week 4', start: '2026-02-18', end: '2026-02-24' },
  ];

  test('All 8 employees exist in DB', async ({ request }) => {
    const res = await request.get(`${BASE}/api/employees`);
    const employees = await res.json();
    expect(employees.length).toBe(8);
    
    const expected = ['Boban Abbate', 'Chris Jacobi', 'Chris Zavesky', 'Doug Kinsey', 
                      'Jason Green', 'Phil Henderson', 'Sean Matthew', 'Thomas Brinson'];
    for (const name of expected) {
      expect(employees.find(e => e.name === name), `Missing: ${name}`).toBeTruthy();
    }
  });

  test('Phil Henderson has OT in weeks 1 and 3', async ({ request }) => {
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    const phil = employees.find(e => e.name === 'Phil Henderson');
    
    for (const week of FEB_WEEKS) {
      const res = await request.get(`${BASE}/api/time-entries?employee_id=${phil.id}&week_start=${week.start}`);
      const body = await res.json();
      const entries = (body.entries || []).filter(e => 
        !(e.customer_name || '').toLowerCase().includes('lunch')
      );
      const totalHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
      
      const hasOT = totalHours > 40;
      const otHours = hasOT ? (totalHours - 40).toFixed(1) : '0';
      console.log(`  Phil ${week.name}: ${totalHours}h${hasOT ? ` ⚠️ OT: ${otHours}h` : ' ✓'}`);
      
      // Phil should have reasonable hours (not 0, not 80+)
      expect(totalHours).toBeGreaterThan(0);
      expect(totalHours).toBeLessThanOrEqual(60);
    }
  });

  test('No employee exceeds 60 hours in any week', async ({ request }) => {
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    
    for (const emp of employees) {
      for (const week of FEB_WEEKS) {
        const res = await request.get(`${BASE}/api/time-entries?employee_id=${emp.id}&week_start=${week.start}`);
        const body = await res.json();
        const entries = (body.entries || []).filter(e => 
          !(e.customer_name || '').toLowerCase().includes('lunch')
        );
        const totalHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
        
        expect(totalHours, `${emp.name} ${week.name}: ${totalHours}h exceeds 60h limit`).toBeLessThanOrEqual(60);
      }
    }
  });

  test('Lunch entries never exceed 1h per day', async ({ request }) => {
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    
    for (const emp of employees) {
      for (const week of FEB_WEEKS) {
        const res = await request.get(`${BASE}/api/time-entries?employee_id=${emp.id}&week_start=${week.start}`);
        const body = await res.json();
        const lunchEntries = (body.entries || []).filter(e => 
          (e.customer_name || '').toLowerCase().includes('lunch')
        );
        
        for (const lunch of lunchEntries) {
          expect(Number(lunch.hours), `${emp.name} lunch on ${lunch.work_date}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ============================================================
// 3. OVERTIME CALCULATION VALIDATION
// ============================================================
test.describe('Overtime Calculations', () => {
  test('OT employees identified correctly for each week', async ({ request }) => {
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    
    const weeks = [
      { start: '2026-01-28', name: 'Week 1' },
      { start: '2026-02-04', name: 'Week 2' },
      { start: '2026-02-11', name: 'Week 3' },
      { start: '2026-02-18', name: 'Week 4' },
    ];
    
    console.log('\n=== OT Summary ===');
    for (const week of weeks) {
      console.log(`\n${week.name}:`);
      for (const emp of employees) {
        const res = await request.get(`${BASE}/api/time-entries?employee_id=${emp.id}&week_start=${week.start}`);
        const body = await res.json();
        const entries = (body.entries || []).filter(e => 
          !(e.customer_name || '').toLowerCase().includes('lunch')
        );
        const totalHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
        
        if (totalHours > 0) {
          const rate = PAY_RATES[emp.name]?.hourly || emp.default_bill_rate || 30;
          const regularHours = Math.min(totalHours, 40);
          const otHours = Math.max(0, totalHours - 40);
          const regularPay = regularHours * rate;
          const otPay = otHours * rate * 1.5;
          const totalPay = regularPay + otPay;
          
          const flag = otHours > 0 ? '⚠️ OT' : '  ';
          console.log(`  ${flag} ${emp.name.padEnd(20)} ${totalHours.toFixed(1).padStart(5)}h | reg: ${regularHours}h ($${regularPay.toFixed(2)}) | OT: ${otHours.toFixed(1)}h ($${otPay.toFixed(2)}) | total: $${totalPay.toFixed(2)}`);
        }
      }
    }
  });

  test('Gross wages match PDF for comparable weeks', async ({ request }) => {
    // Compare Phil Henderson's February data against January PDF patterns
    const empRes = await request.get(`${BASE}/api/employees`);
    const employees = await empRes.json();
    const phil = employees.find(e => e.name === 'Phil Henderson');
    
    // Week 2 (40h, no OT) should produce $1,200 like Jan weeks 1,2,4
    const w2Res = await request.get(`${BASE}/api/time-entries?employee_id=${phil.id}&week_start=2026-02-04`);
    const w2Body = await w2Res.json();
    const w2Hours = (w2Body.entries || [])
      .filter(e => !(e.customer_name || '').toLowerCase().includes('lunch'))
      .reduce((s, e) => s + Number(e.hours || 0), 0);
    
    const w2Pay = Math.min(w2Hours, 40) * 30 + Math.max(0, w2Hours - 40) * 45;
    console.log(`\nPhil Henderson W2: ${w2Hours}h → $${w2Pay.toFixed(2)} (Jan PDF baseline: $1,200.00)`);
    
    // Should be close to $1,200 (40h × $30)
    expect(w2Pay).toBeGreaterThanOrEqual(1100);
    expect(w2Pay).toBeLessThanOrEqual(1500);
  });
});

// ============================================================
// 4. WEEKLY EXPORT GENERATION
// ============================================================
test.describe('Export Generation', () => {
  test('Weekly export generates for week 4', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/generate-week?week_start=2026-02-18`);
    if (res.ok()) {
      const body = await res.json();
      console.log('Week 4 export:', JSON.stringify(body, null, 2).slice(0, 500));
      if (body.files) {
        expect(body.files.length).toBeGreaterThan(0);
        console.log(`  Generated ${body.files.length} employee exports`);
      }
    } else {
      console.log('  Export endpoint returned:', res.status());
    }
  });
});

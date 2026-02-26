/**
 * Reconcile Feb 18 week: Snapshot DB vs Excel Export
 * Source of truth: Excel export (Payroll_Breakdown_2026-02 (26).xlsx)
 */
const Database = require('better-sqlite3');
const db = new Database('./data/snapshot_feb25.db', { readonly: true });

// Expected data from Excel export "Week of Feb 18" sheet
const EXCEL_EXPECTED = {
  'Doug Kinsey': {
    clients: {
      'Boyle': 5.25, 'Jebsen': 3.25, 'Ueltschi': 16, 'Watkins': 1,
      'Welles': 0.5, 'Lynn': 5.25, 'Gonzalez': 1, 'Welton': 4.5,
      'Null': 2.5, 'Tercek': 3.5, 'Lucas': 1
    },
    totalHours: 46.15, // from handwritten image
    rate: 30
  },
  'Jason Green': {
    clients: {
      'Boyle': 27, 'Richer': 1.5, 'Nathan': 9, 'O\'Connor': 1.5
    },
    totalHours: 39,
    rate: 35
  },
  'Phil Henderson': {
    clients: { 'Watkins': 45 },
    totalHours: 45,
    rate: 30
  },
  'Sean Matthew': {
    clients: {
      'Watkins': 8.5, 'Lynn': 16.59, 'Nathan': 8.5,
      'Ueltschi': 5.75, 'Barn': 3.75, 'Boyle': 8.83
    },
    totalHours: 51.92,
    rate: 20
  },
  'Thomas Brinson': {
    clients: {
      'Boyle': 18, 'Landy': 4.5, 'Gonzalez': 17
    },
    totalHours: 39.5,
    rate: 35
  },
  'Chris Zavesky': {
    clients: {
      'Ueltschi': 17, 'Watkins': 10, 'Cooney': 1,
      'Tubergen': 1, 'Null': 1, 'Landy': 2.5
    },
    totalHours: 18.5, // Corrected (excludes -11.5 error and Mon/Tue missing)
    rate: 100,
    notes: 'Wed/Thu only in DB. Missing: Mon(Ueltschi 4, Null 1, Watkins 3) + Tue(Landy 2.5, Ueltschi 5, Watkins 3)'
  },
  'Boban Abbate': {
    clients: {},
    totalHours: 0,
    rate: 42.5,
    notes: 'No entries expected for Week of Feb 18 per Excel'
  }
};

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║     RECONCILIATION: Snapshot DB vs Excel Export             ║');
console.log('║     Week of Feb 18, 2026                                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Get all entries for week of Feb 18 from snapshot
const dbEntries = db.prepare(`
  SELECT e.name as employee, c.name as customer, SUM(te.hours) as hours, te.status,
         COUNT(*) as entry_count
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
    AND LOWER(c.name) != 'lunch'
  GROUP BY e.name, c.name
  ORDER BY e.name, c.name
`).all();

// Build DB map: employee -> { customer -> hours }
const dbMap = {};
for (const r of dbEntries) {
  if (!dbMap[r.employee]) dbMap[r.employee] = {};
  dbMap[r.employee][r.customer] = { hours: r.hours, status: r.status, count: r.entry_count };
}

let totalDiscrepancies = 0;
const fixes = [];

for (const [emp, expected] of Object.entries(EXCEL_EXPECTED)) {
  console.log(`\n── ${emp} (Rate: $${expected.rate}/hr) ──`);
  const dbEmp = dbMap[emp] || {};
  
  // Check each expected client
  for (const [client, expectedHours] of Object.entries(expected.clients)) {
    const dbEntry = dbEmp[client];
    const dbHours = dbEntry ? dbEntry.hours : 0;
    const diff = Math.round((expectedHours - dbHours) * 100) / 100;
    
    if (Math.abs(diff) < 0.01) {
      console.log(`  ✅ ${client}: ${dbHours}h (matches)`);
    } else if (dbHours === 0) {
      console.log(`  ❌ ${client}: MISSING (expected ${expectedHours}h)`);
      fixes.push({ employee: emp, customer: client, hours: expectedHours, action: 'ADD' });
      totalDiscrepancies++;
    } else {
      console.log(`  ⚠️  ${client}: DB=${dbHours}h, Excel=${expectedHours}h (diff: ${diff > 0 ? '+' : ''}${diff}h)`);
      fixes.push({ employee: emp, customer: client, dbHours, expectedHours, diff, action: 'ADJUST' });
      totalDiscrepancies++;
    }
  }
  
  // Check for entries in DB not in Excel
  for (const [client, info] of Object.entries(dbEmp)) {
    if (!expected.clients[client]) {
      console.log(`  🔶 ${client}: ${info.hours}h in DB but NOT in Excel`);
      totalDiscrepancies++;
    }
  }
  
  // DB total vs expected
  const dbTotal = Object.values(dbEmp).reduce((s, v) => s + v.hours, 0);
  console.log(`  TOTAL: DB=${Math.round(dbTotal*100)/100}h | Excel=${expected.totalHours}h`);
  if (expected.notes) console.log(`  📝 ${expected.notes}`);
}

// Special: Check Chris Z lunch bug
console.log('\n── SPECIAL: Chris Zavesky Lunch Bug ──');
const lunchEntries = db.prepare(`
  SELECT te.work_date, te.hours, te.id
  FROM time_entries te
  JOIN employees e ON e.id = te.employee_id
  JOIN customers c ON c.id = te.customer_id
  WHERE e.name = 'Chris Zavesky' AND LOWER(c.name) = 'lunch'
    AND te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24'
`).all();
for (const l of lunchEntries) {
  if (l.hours > 1) {
    console.log(`  🐛 BUG: ${l.work_date} Lunch = ${l.hours}h (ID: ${l.id}) → Should be 0.5h`);
    fixes.push({ employee: 'Chris Zavesky', customer: 'Lunch', id: l.id, dbHours: l.hours, expectedHours: 0.5, action: 'FIX_LUNCH' });
  } else {
    console.log(`  ✅ ${l.work_date} Lunch = ${l.hours}h (OK)`);
  }
}

console.log('\n══════════════════════════════════════');
console.log(`TOTAL DISCREPANCIES: ${totalDiscrepancies}`);
console.log(`FIXES NEEDED: ${fixes.length}`);
console.log('══════════════════════════════════════\n');

if (fixes.length > 0) {
  console.log('PROPOSED FIXES:');
  for (const f of fixes) {
    if (f.action === 'ADD') {
      console.log(`  ADD: ${f.employee} → ${f.customer}: ${f.hours}h`);
    } else if (f.action === 'ADJUST') {
      console.log(`  ADJUST: ${f.employee} → ${f.customer}: ${f.dbHours}h → ${f.expectedHours}h`);
    } else if (f.action === 'FIX_LUNCH') {
      console.log(`  FIX: ${f.employee} Lunch entry ${f.id}: ${f.dbHours}h → ${f.expectedHours}h`);
    }
  }
}

db.close();

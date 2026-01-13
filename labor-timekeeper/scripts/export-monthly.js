import Database from 'better-sqlite3';
import { generateMonthlyExport } from '../lib/export/generateMonthly.js';
import fs from 'fs';

const db = new Database('./data/app.db');
const month = process.argv[2] || '2026-01';

// Use alternate filename if original is locked
const outputPath = `./exports/${month}/Payroll_Breakdown_${month}_v2.xlsx`;

try {
  const result = await generateMonthlyExport({ db, month });
  console.log('\n✅ Generated:', result.filepath);
  console.log('   Customers:', result.totals.customers);
  console.log('   Hourly Total: $' + result.totals.hourlyTotal);
  console.log('   Admin Total: $' + result.totals.adminTotal);
  console.log('   Grand Total: $' + result.totals.grandTotal);
} catch (err) {
  if (err.code === 'EBUSY') {
    console.error('\n❌ File is locked - please close Excel and try again');
  } else {
    throw err;
  }
} finally {
  db.close();
}

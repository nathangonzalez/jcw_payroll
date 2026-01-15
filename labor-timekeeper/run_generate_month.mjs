import { openDb } from './lib/db.js';
import { generateMonthlyExport } from './lib/export/generateMonthly.js';

const db = openDb();

(async () => {
  try {
    const month = process.argv[2] || '2026-01';
    console.log('[run_generate_month] Generating month', month);
    const res = await generateMonthlyExport({ db, month });
    console.log('[run_generate_month] Result:', res);
  } catch (err) {
    console.error('[run_generate_month] Error:', err);
    process.exitCode = 1;
  } finally {
    try { db.close && db.close(); } catch(e){}
  }
})();

#!/usr/bin/env node
import { openDb } from '../lib/db.js';
import { generateWeeklyExports } from '../lib/export/generateWeekly.js';

const args = process.argv.slice(2);
const week = args[0] || (() => { const d = new Date(); d.setDate(d.getDate()-d.getDay()+1); return d.toISOString().slice(0,10); })();

async function main() {
  const db = openDb();
  console.log('Generating weekly exports for', week);
  const res = await generateWeeklyExports({ db, weekStart: week });
  console.log('Files generated:', res.files.length);
  console.log('Output dir:', res.outputDir);
  if (res.files.length > 0) res.files.forEach(f => console.log(' -', f.filename, f.hours, 'hrs', `$${f.amount}`));
  if (res.summaryFiles) res.summaryFiles.forEach(s => console.log(' summary:', s.filename));
}

main().catch(err => { console.error(err); process.exit(1); });

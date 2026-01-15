#!/usr/bin/env node
import { openDb } from '../lib/db.js';
import { generateWeeklyExports } from '../lib/export/generateWeekly.js';
import { persist } from '../lib/persist.js';

async function run(){
  const db = openDb();
  const weekStart = process.argv[2] || '2026-01-14';
  console.log('Generating weekly exports for', weekStart);
  const res = await generateWeeklyExports({ db, weekStart });
  console.log('Files generated:', res.files.length);
  console.log('Totals:', res.totals);
  try { persist(`generated weekly exports ${weekStart}: ${res.files.length} files`); } catch(e){}
}

run().catch(e=>{ console.error(e); process.exit(1); });

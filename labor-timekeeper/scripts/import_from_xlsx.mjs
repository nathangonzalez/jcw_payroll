#!/usr/bin/env node
/**
 * Parse the monthly payroll XLSX export and import all time entries
 * back into production via /api/admin/import-entries.
 *
 * Usage: node scripts/import_from_xlsx.mjs <path-to-xlsx> [--dry-run]
 */
import ExcelJS from 'exceljs';
import fs from 'fs';

const PROD_URL = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com';

const EMPLOYEE_SHEETS = [
  'Jason Green', 'Phil Henderson', 'Sean Matthew',
  'Boban Abbate', 'Thomas Brinson', 'Doug Kinsey',
  'Chris Zavesky', 'Chris Jacobi'
];

function parseDateCell(dateStr, weekHeader) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(?:Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)-(\d+)$/i);
  if (!match) return null;
  const dayOfMonth = parseInt(match[1], 10);

  const headerMatch = String(weekHeader || '').match(/(\d+)\/(\d+)\/(\d+)\s*-\s*(\d+)\/(\d+)\/(\d+)/);
  if (!headerMatch) return null;

  const startMonth = parseInt(headerMatch[1], 10);
  const startDay = parseInt(headerMatch[2], 10);
  const startYear = parseInt(headerMatch[3], 10) + 2000;
  const endMonth = parseInt(headerMatch[4], 10);

  let month, year;
  if (dayOfMonth >= startDay && startMonth === endMonth) {
    month = startMonth; year = startYear;
  } else if (dayOfMonth < 15 && endMonth !== startMonth) {
    month = endMonth; year = startYear + (endMonth < startMonth ? 1 : 0);
  } else {
    month = startMonth; year = startYear;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
}

function cellValue(cell) {
  if (!cell || !cell.value) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
  return v;
}

function parseEmployeeSheet(ws, sheetName) {
  const entries = [];
  let currentWeekHeader = null;
  let currentDate = null;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cell0 = String(cellValue(row.getCell(1)) || '').trim();

    // Detect week header
    if (cell0.includes('\u2014') && cell0.includes('/')) {
      currentWeekHeader = cell0;
      currentDate = null;
      return;
    }
    // Also check for em-dash variants
    if (cell0.includes('—') && cell0.includes('/')) {
      currentWeekHeader = cell0;
      currentDate = null;
      return;
    }

    if (cell0 === 'Date' || cell0 === 'TOTAL:' || cell0.startsWith('Total')) return;

    const dateMatch = cell0.match(/^(?:Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)-\d+$/i);
    if (dateMatch) {
      currentDate = parseDateCell(cell0, currentWeekHeader);
    }

    // col B=client, col F=hours, col G=notes
    const client = String(cellValue(row.getCell(2)) || '').trim();
    const hoursRaw = cellValue(row.getCell(6));
    const hours = parseFloat(hoursRaw);

    if (currentDate && client && !isNaN(hours) && hours > 0) {
      const notes = String(cellValue(row.getCell(7)) || '').trim();
      entries.push({
        employee: sheetName,
        customer: client,
        work_date: currentDate,
        hours,
        notes,
        status: 'APPROVED'
      });
    }
  });

  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (!xlsxPath) {
    console.error('Usage: node scripts/import_from_xlsx.mjs <path-to-xlsx> [--dry-run]');
    process.exit(1);
  }

  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`Reading ${xlsxPath}...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  console.log(`Sheets: ${wb.worksheets.map(ws => ws.name).join(', ')}`);

  let allEntries = [];
  for (const name of EMPLOYEE_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) {
      console.warn(`  Sheet "${name}" not found, skipping`);
      continue;
    }
    const entries = parseEmployeeSheet(ws, name);
    console.log(`  ${name}: ${entries.length} entries`);
    allEntries = allEntries.concat(entries);
  }

  console.log(`\nTotal entries extracted: ${allEntries.length}`);

  const byEmployee = {};
  for (const e of allEntries) {
    if (!byEmployee[e.employee]) byEmployee[e.employee] = { count: 0, hours: 0 };
    byEmployee[e.employee].count++;
    byEmployee[e.employee].hours += e.hours;
  }
  console.log('\nSummary:');
  for (const [emp, stats] of Object.entries(byEmployee).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${emp}: ${stats.count} entries, ${stats.hours.toFixed(1)} hours`);
  }

  const dates = allEntries.map(e => e.work_date).sort();
  if (dates.length > 0) console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Entries to import:');
    for (const e of allEntries) {
      console.log(`  ${e.work_date} | ${e.employee} | ${e.customer} | ${e.hours}h | ${e.notes || ''}`);
    }
    return;
  }

  console.log(`\nImporting ${allEntries.length} entries to ${PROD_URL}...`);
  const resp = await fetch(`${PROD_URL}/api/admin/import-entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: allEntries, default_status: 'APPROVED' })
  });
  const result = await resp.json();
  console.log('Result:', JSON.stringify(result, null, 2));

  const healthResp = await fetch(`${PROD_URL}/api/health`);
  const health = await healthResp.json();
  console.log(`\nHealth after import: ${JSON.stringify(health.stats)}`);
}

main().catch(err => { console.error(err); process.exit(1); });

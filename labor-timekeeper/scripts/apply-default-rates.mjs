#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { DEFAULT_EMPLOYEES } from '../lib/defaultEmployees.js';

const dbCandidates = [path.resolve('data/app.db'), path.resolve('tmp_app.db'), path.resolve('recovery_app.db')];
const dbPath = dbCandidates.find(p => fs.existsSync(p));
if (!dbPath) {
  console.error('No database file found (tried data/app.db, tmp_app.db, recovery_app.db). Run this from the labor-timekeeper folder.');
  process.exit(1);
}

console.log('Using DB:', dbPath);
const db = new Database(dbPath);
const now = new Date().toISOString();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const persistPath = path.resolve(__dirname, '..', 'persist.txt');

const getEmp = db.prepare('SELECT id, name, default_bill_rate, default_pay_rate FROM employees WHERE name = ?');
const updateEmp = db.prepare('UPDATE employees SET default_bill_rate = ?, default_pay_rate = ? WHERE id = ?');

// Inspect employees table columns and build a safe INSERT
const pragmaRows = db.prepare("PRAGMA table_info('employees')").all();
const cols = pragmaRows.map(r => r.name);
const payColInfo = pragmaRows.find(r => r.name === 'default_pay_rate') || null;
const payAllowsNull = payColInfo ? (payColInfo.notnull === 0) : true;
function hasCol(name) { return cols.indexOf(name) !== -1; }
const insertCols = ['id','name'].filter(hasCol);
if (hasCol('default_bill_rate')) insertCols.push('default_bill_rate');
if (hasCol('default_pay_rate')) insertCols.push('default_pay_rate');
if (hasCol('is_admin')) insertCols.push('is_admin');
if (hasCol('aliases_json')) insertCols.push('aliases_json');
if (hasCol('created_at')) insertCols.push('created_at');
const insertPlaceholder = insertCols.map(_=>'?').join(',');
const insertEmp = db.prepare(`INSERT INTO employees (${insertCols.join(',')}) VALUES (${insertPlaceholder})`);

function makeId() {
  return 'emp_' + Math.random().toString(36).slice(2, 10);
}

let changed = 0;
for (const e of DEFAULT_EMPLOYEES) {
  const row = getEmp.get(e.name);
  if (row) {
    const bill = e.hasOwnProperty('default_bill_rate') && e.default_bill_rate !== null ? Number(e.default_bill_rate) : null;
    let pay = e.hasOwnProperty('default_pay_rate') && e.default_pay_rate !== null ? Number(e.default_pay_rate) : null;
    if (pay === null && !payAllowsNull) {
      pay = 0; // DB forbids NULL for default_pay_rate; use 0 as fallback
    }
    const currentBill = row.default_bill_rate === null ? null : Number(row.default_bill_rate);
    const currentPay = row.default_pay_rate === null ? null : Number(row.default_pay_rate);
    const billChanged = (currentBill !== bill);
    const payChanged = (currentPay !== pay);
    if (billChanged || payChanged) {
      updateEmp.run(bill, pay, row.id);
      const line = `[${now}] updated rates for ${e.name} (${row.id}) to ${bill}/${pay}\n`;
      fs.appendFileSync(persistPath, line);
      console.log(line.trim());
      changed++;
    }
  } else {
    const id = makeId();
    const is_admin = e.role === 'admin' ? 1 : 0;
    const aliases_json = JSON.stringify(e.aliases || []);
    // Build values array to match insertCols order
    const values = insertCols.map(col => {
      if (col === 'id') return id;
      if (col === 'name') return e.name;
      if (col === 'default_bill_rate') return e.hasOwnProperty('default_bill_rate') && e.default_bill_rate !== null ? Number(e.default_bill_rate) : null;
      if (col === 'default_pay_rate') {
        const v = e.hasOwnProperty('default_pay_rate') && e.default_pay_rate !== null ? Number(e.default_pay_rate) : null;
        return v === null && !payAllowsNull ? 0 : v;
      }
      if (col === 'is_admin') return is_admin;
      if (col === 'aliases_json') return aliases_json;
      if (col === 'created_at') return now;
      return null;
    });
    insertEmp.run(...values);
    const line = `[${now}] inserted employee ${e.name} (${id}) with rates ${e.default_bill_rate}/${e.default_pay_rate}\n`;
    fs.appendFileSync(persistPath, line);
    console.log(line.trim());
    changed++;
  }
}

console.log(`Completed. ${changed} employee(s) updated/inserted.`);
process.exit(0);

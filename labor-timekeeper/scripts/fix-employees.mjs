#!/usr/bin/env node
import { openDb, id as genId } from '../lib/db.js';
import { DEFAULT_EMPLOYEES } from '../lib/defaultEmployees.js';
import fs from 'fs';
import path from 'path';
import { persist } from '../lib/persist.js';

const db = openDb();

function findDefaultByName(name){
  const lower = (name||'').toLowerCase();
  return DEFAULT_EMPLOYEES.find(e => (e.name || '').toLowerCase() === lower || (e.aliases||[]).some(a => a.toLowerCase() === lower));
}

async function run(){
  console.log('Inspecting employees...');
  const employees = db.prepare('SELECT id, name, default_bill_rate, default_pay_rate FROM employees ORDER BY name ASC').all();
  console.table(employees.map(e=>({ id: e.id, name: e.name, bill: e.default_bill_rate, pay: e.default_pay_rate })));

  // Check for Chris Zavesky
  const chris = employees.find(e => (e.name||'').toLowerCase().includes('zavesky')) || employees.find(e=> (e.name||'').toLowerCase().includes('chris z'));
  if (!chris) {
    const def = findDefaultByName('Chris Zavesky') || DEFAULT_EMPLOYEES[1];
    const nid = genId('emp_');
    db.prepare('INSERT INTO employees (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nid, def.name, Number(def.default_bill_rate||0), Number(def.default_pay_rate||0), def.role === 'admin' ? 1 : 0, JSON.stringify(def.aliases||[]), new Date().toISOString());
    console.log('Inserted employee', def.name, nid);
    persist(`inserted employee ${def.name} ${nid}`);
  } else {
    console.log('Found Chris in DB:', chris.name, chris.id);
  }

  // Update any employees with zero bill rate using DEFAULT_EMPLOYEES mapping
  let updated=0;
  for (const emp of employees) {
    const def = findDefaultByName(emp.name);
    if (def && (!emp.default_bill_rate || Number(emp.default_bill_rate) === 0)) {
      db.prepare('UPDATE employees SET default_bill_rate = ?, default_pay_rate = ? WHERE id = ?')
        .run(Number(def.default_bill_rate||0), Number(def.default_pay_rate||0), emp.id);
      updated++;
      persist(`updated rates for ${emp.name} (${emp.id}) to ${def.default_bill_rate}/${def.default_pay_rate}`);
      console.log('Updated rates for', emp.name);
    }
  }
  if (updated===0) console.log('No employee rate updates necessary');

  // Check rate_overrides with zero bill_rate
  const zeros = db.prepare('SELECT id, employee_id, customer_id, bill_rate FROM rate_overrides WHERE bill_rate = 0').all();
  if (zeros.length) {
    console.log('Found rate_overrides with zero bill_rate:', zeros.length);
    for (const r of zeros) {
      // try to set to employee default
      const emp = db.prepare('SELECT default_bill_rate FROM employees WHERE id = ?').get(r.employee_id);
      if (emp && emp.default_bill_rate && Number(emp.default_bill_rate) > 0) {
        db.prepare('UPDATE rate_overrides SET bill_rate = ? WHERE id = ?').run(Number(emp.default_bill_rate), r.id);
        persist(`fixed rate_override ${r.id} to ${emp.default_bill_rate}`);
      }
    }
  }

  console.log('Done.');
}

run().catch(e=>{ console.error(e); process.exit(1); });

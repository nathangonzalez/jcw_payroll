#!/usr/bin/env node
/**
 * Database Backup/Restore Script
 * 
 * Usage:
 *   node scripts/backup.js backup                    # Create backup
 *   node scripts/backup.js backup my-backup.json    # Named backup
 *   node scripts/backup.js restore backup.json      # Restore from file
 *   node scripts/backup.js list                     # List backups
 */

import fs from "fs";
import path from "path";
import { openDb, id } from "../lib/db.js";

const args = process.argv.slice(2);
const command = args[0] || "help";
const filename = args[1];

const db = openDb();
const backupDir = path.resolve("./backups");

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

function backup(outFile) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = outFile 
    ? path.resolve(backupDir, outFile)
    : path.resolve(backupDir, `backup-${timestamp}.json`);
  
  console.log("Creating backup...");
  
  const data = {
    version: 1,
    created_at: new Date().toISOString(),
    tables: {
      customers: db.prepare("SELECT * FROM customers").all(),
      employees: db.prepare("SELECT * FROM employees").all(),
      time_entries: db.prepare("SELECT * FROM time_entries").all(),
      rate_overrides: db.prepare("SELECT * FROM rate_overrides").all()
    }
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  
  console.log(`Backup created: ${outputPath}`);
  console.log(`  Customers: ${data.tables.customers.length}`);
  console.log(`  Employees: ${data.tables.employees.length}`);
  console.log(`  Time Entries: ${data.tables.time_entries.length}`);
  console.log(`  Rate Overrides: ${data.tables.rate_overrides.length}`);
}

function restore(inputFile) {
  if (!inputFile) {
    console.error("ERROR: Please specify a backup file to restore");
    process.exit(1);
  }
  
  const inputPath = path.resolve(backupDir, inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: Backup file not found: ${inputPath}`);
    process.exit(1);
  }
  
  console.log(`Restoring from: ${inputPath}`);
  
  const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  
  if (data.version !== 1) {
    console.error("ERROR: Unsupported backup version");
    process.exit(1);
  }
  
  db.transaction(() => {
    // Clear existing data
    console.log("Clearing existing data...");
    db.exec("DELETE FROM time_entries");
    db.exec("DELETE FROM rate_overrides");
    db.exec("DELETE FROM employees");
    db.exec("DELETE FROM customers");
    
    // Restore customers
    const insertCust = db.prepare(`
      INSERT INTO customers (id, name, address, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of data.tables.customers) {
      insertCust.run(c.id, c.name, c.address || '', c.created_at);
    }
    console.log(`  Restored ${data.tables.customers.length} customers`);
    
    // Restore employees
    const insertEmp = db.prepare(`
      INSERT INTO employees (id, name, pin_hash, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of data.tables.employees) {
      insertEmp.run(e.id, e.name, e.pin_hash, e.default_bill_rate, e.default_pay_rate, e.is_admin, e.aliases_json, e.created_at);
    }
    console.log(`  Restored ${data.tables.employees.length} employees`);
    
    // Restore rate overrides
    const insertRate = db.prepare(`
      INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of data.tables.rate_overrides) {
      insertRate.run(r.id, r.employee_id, r.customer_id, r.bill_rate, r.created_at);
    }
    console.log(`  Restored ${data.tables.rate_overrides.length} rate overrides`);
    
    // Restore time entries
    const insertEntry = db.prepare(`
      INSERT INTO time_entries (id, employee_id, customer_id, work_date, hours, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of data.tables.time_entries) {
      insertEntry.run(t.id, t.employee_id, t.customer_id, t.work_date, t.hours, t.notes || '', t.status, t.created_at, t.updated_at);
    }
    console.log(`  Restored ${data.tables.time_entries.length} time entries`);
  })();
  
  console.log("\nRestore complete!");
}

function listBackups() {
  if (!fs.existsSync(backupDir)) {
    console.log("No backups found.");
    return;
  }
  
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    console.log("No backups found.");
    return;
  }
  
  console.log("Available backups:");
  for (const file of files) {
    const stat = fs.statSync(path.join(backupDir, file));
    const size = (stat.size / 1024).toFixed(1);
    console.log(`  ${file} (${size} KB)`);
  }
}

function showHelp() {
  console.log(`
Database Backup/Restore Script

Usage:
  node scripts/backup.js backup [filename]    Create a backup
  node scripts/backup.js restore <filename>   Restore from backup
  node scripts/backup.js list                 List available backups
  node scripts/backup.js help                 Show this help

Examples:
  node scripts/backup.js backup
  node scripts/backup.js backup pre-deploy.json
  node scripts/backup.js restore backup-2026-01-13.json
  node scripts/backup.js list
`);
}

// Execute command
switch (command) {
  case "backup":
    backup(filename);
    break;
  case "restore":
    restore(filename);
    break;
  case "list":
    listBackups();
    break;
  case "help":
  default:
    showHelp();
}

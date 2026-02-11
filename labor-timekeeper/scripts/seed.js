import fs from "fs";
import path from "path";
import { openDb, id } from "../lib/db.js";

const db = openDb();

function readJson(rel) {
  const p = path.resolve(process.cwd(), rel);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const customers = readJson("./seed/customers.json");
const employees = readJson("./seed/employees.json");
const overrides = readJson("./seed/rate_overrides.json");

const now = new Date().toISOString();

db.transaction(() => {
  // Customers - now with address support
  // Insert new customer or update address if blank
  const findCustomer = db.prepare("SELECT id, address FROM customers WHERE LOWER(name) = LOWER(?)");
  const insertCustomer = db.prepare("INSERT INTO customers (id, name, address, created_at) VALUES (?, ?, ?, ?)");
  const updateAddress = db.prepare("UPDATE customers SET address = ? WHERE id = ?");
  
  for (const c of customers) {
    const name = typeof c === 'string' ? c : c.name;
    const address = typeof c === 'string' ? '' : (c.address || '');
    
    const existing = findCustomer.get(name);
    if (existing) {
      // Update address if existing is blank and new has address
      if ((!existing.address || existing.address === '') && address) {
        updateAddress.run(address, existing.id);
      }
    } else {
      insertCustomer.run(id("cust_"), name, address, now);
    }
  }

  // Employees
  const insertEmployee = db.prepare(`
    INSERT OR IGNORE INTO employees
      (id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const e of employees) {
    // Support both old format (is_admin) and new format (role: "admin" | "hourly")
    const isAdmin = e.is_admin ? 1 : (e.role === 'admin' ? 1 : 0);
    insertEmployee.run(
      id("emp_"),
      e.name,
      Number(e.default_bill_rate || 0),
      Number(e.default_pay_rate || 0),
      isAdmin,
      JSON.stringify(e.aliases || []),
      now
    );
  }

  // Rate overrides
  const getEmp = db.prepare("SELECT id FROM employees WHERE name = ?");
  const getCust = db.prepare("SELECT id FROM customers WHERE name = ?");
  const upsert = db.prepare(`
    INSERT INTO rate_overrides (id, employee_id, customer_id, bill_rate, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, customer_id) DO UPDATE SET bill_rate=excluded.bill_rate
  `);

  for (const o of overrides) {
    // employee_name in overrides is "Chris J"/"Chris Z" from template; map "Chris J" => "Chris Jacobi"
    const empName = o.employee_name === "Chris J" ? "Chris Jacobi" : o.employee_name;
    const emp = getEmp.get(empName);
    const cust = getCust.get(o.customer_name);
    if (!emp || !cust) continue;
    upsert.run(id("ro_"), emp.id, cust.id, Number(o.bill_rate), now);
  }
})();

const counts = {
  customers: db.prepare("SELECT COUNT(*) as n FROM customers").get().n,
  employees: db.prepare("SELECT COUNT(*) as n FROM employees").get().n,
  overrides: db.prepare("SELECT COUNT(*) as n FROM rate_overrides").get().n
};

console.log("Seed complete:", counts);

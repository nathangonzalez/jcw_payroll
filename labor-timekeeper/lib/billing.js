/**
 * Get internal pay rate for an employee/customer combo.
 * Lookup chain: rate_overrides → employees.default_bill_rate
 * Used in: Payroll reports
 */
export function getBillRate(db, employeeId, customerId) {
  const row = db.prepare(
    "SELECT bill_rate FROM rate_overrides WHERE employee_id = ? AND customer_id = ?"
  ).get(employeeId, customerId);
  if (row?.bill_rate != null) return Number(row.bill_rate);
  const emp = db.prepare("SELECT default_bill_rate FROM employees WHERE id = ?").get(employeeId);
  return Number(emp?.default_bill_rate ?? 0);
}

/**
 * Get client-facing billing rate for an employee.
 * Lookup chain: rate_overrides → employees.client_bill_rate → fallback to getBillRate()
 * Used in: Billing reports (what JCW charges customers)
 *
 * Rate hierarchy:
 *   1. rate_overrides.bill_rate (per-customer per-employee) — shared with payroll
 *   2. employees.client_bill_rate (flat client-facing rate)
 *   3. employees.default_bill_rate (fallback to internal rate)
 */
export function getClientBillRate(db, employeeId, customerId) {
  // Check per-customer override first (shared between payroll and billing)
  const override = db.prepare(
    "SELECT bill_rate FROM rate_overrides WHERE employee_id = ? AND customer_id = ?"
  ).get(employeeId, customerId);
  if (override?.bill_rate != null) return Number(override.bill_rate);

  // Then check client_bill_rate on employee
  const emp = db.prepare("SELECT client_bill_rate, default_bill_rate FROM employees WHERE id = ?").get(employeeId);
  if (emp?.client_bill_rate != null) return Number(emp.client_bill_rate);

  // Fallback to internal rate
  return Number(emp?.default_bill_rate ?? 0);
}

/**
 * Build a billing rates map from DB for use with generateMonthlyExport.
 * Returns: { "Employee Name": rate, ... }
 */
export function buildBillingRatesMap(db) {
  const employees = db.prepare("SELECT name, client_bill_rate, default_bill_rate FROM employees").all();
  const map = {};
  for (const emp of employees) {
    const rate = emp.client_bill_rate != null ? emp.client_bill_rate : emp.default_bill_rate;
    if (rate != null) map[emp.name] = Number(rate);
  }
  return map;
}

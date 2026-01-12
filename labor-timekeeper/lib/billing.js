export function getBillRate(db, employeeId, customerId) {
  const row = db.prepare(
    "SELECT bill_rate FROM rate_overrides WHERE employee_id = ? AND customer_id = ?"
  ).get(employeeId, customerId);
  if (row?.bill_rate != null) return Number(row.bill_rate);
  const emp = db.prepare("SELECT default_bill_rate FROM employees WHERE id = ?").get(employeeId);
  return Number(emp?.default_bill_rate ?? 0);
}

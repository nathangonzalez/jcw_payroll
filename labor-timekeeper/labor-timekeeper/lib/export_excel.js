import ExcelJS from "exceljs";
import { getBillRate } from "./billing.js";

export async function buildMonthlyWorkbook({ db, monthYmd }) {
  // monthYmd: 'YYYY-MM-01' typically
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Monthly Summary");

  // Pull approved+submitted entries for the month (you can tighten to APPROVED only if desired)
  const rows = db.prepare(`
    SELECT te.*, e.name as employee_name, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date < ?
      AND te.status IN ('SUBMITTED','APPROVED')
  `).all(monthYmd, nextMonth(monthYmd));

  const employees = [...new Set(rows.map(r => r.employee_name))].sort((a,b)=>a.localeCompare(b));
  // Header
  const header = ["Client"];
  for (const emp of employees) {
    header.push(`${emp} Hours`, `${emp} Rate`, `${emp} Amount`);
  }
  ws.addRow(header);

  // Group by customer then employee
  const byCustomer = new Map();
  for (const r of rows) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, { name: r.customer_name, byEmp: new Map() });
    const cust = byCustomer.get(r.customer_id);
    if (!cust.byEmp.has(r.employee_id)) cust.byEmp.set(r.employee_id, { hours: 0, employee_name: r.employee_name, employee_id: r.employee_id });
    cust.byEmp.get(r.employee_id).hours += Number(r.hours);
  }

  for (const [customerId, cust] of [...byCustomer.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
    const row = [cust.name];
    for (const empName of employees) {
      // find employeeId for this empName if present
      const empRows = rows.find(r => r.employee_name === empName);
      const empId = empRows?.employee_id;
      const empHours = [...cust.byEmp.values()].find(v => v.employee_name === empName)?.hours || 0;
      const rate = empId ? getBillRate(db, empId, customerId) : 0;
      row.push(round2(empHours), rate, round2(empHours * rate));
    }
    ws.addRow(row);
  }

  ws.columns.forEach(col => { col.width = Math.max(12, String(col.header ?? '').length + 2); });
  ws.getRow(1).font = { bold: true };

  return workbook;
}

// Invoice workbook removed per project scope

function nextMonth(ymd) {
  const [y,m,_] = ymd.split("-").map(Number);
  let ny = y, nm = m + 1;
  if (nm === 13) { nm = 1; ny += 1; }
  return `${ny}-${String(nm).padStart(2,"0")}-01`;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

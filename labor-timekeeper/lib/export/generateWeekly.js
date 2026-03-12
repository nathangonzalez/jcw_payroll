/**
 * Weekly XLSX Export Generator
 * Output is a single workbook with:
 * - Weekly Timecards (all employees in one scrollable sheet)
 * - Weekly Customer Summary (customer + employee billing summary)
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { getBillRate } from "../billing.js";
import { weekDates, weekStartYMD, ymdToDate } from "../time.js";

export async function generateWeeklyExports({ db, weekStart, includeAdmin = false }) {
  const normalizedWeekStart = weekStartYMD(ymdToDate(weekStart));
  const { ordered } = weekDates(normalizedWeekStart);
  const weekStartYmd = ordered[0].ymd;
  const weekEndYmd = ordered[6].ymd;

  const baseDir = process.env.NODE_ENV === "production" ? "/tmp/exports" : "./exports";
  const monthDir = weekStartYmd.slice(0, 7);
  const outputDir = path.resolve(`${baseDir}/${monthDir}/${weekStartYmd}`);
  ensureDir(outputDir);

  const entries = db.prepare(`
    SELECT
      te.*,
      e.name AS employee_name,
      e.default_pay_rate,
      e.role,
      e.is_admin,
      c.name AS customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ?
      AND te.work_date <= ?
      AND te.status = 'APPROVED'
      AND te.archived = 0
    ORDER BY te.work_date ASC, e.name ASC, te.start_time ASC, te.id ASC
  `).all(weekStartYmd, weekEndYmd);

  const allEmployees = db.prepare(`
    SELECT id, name, default_pay_rate, role, is_admin
    FROM employees
    ORDER BY name ASC
  `).all();

  const scopedEmployees = includeAdmin
    ? allEmployees
    : allEmployees.filter((row) => !isAdminEmployee(row));

  const byEmployee = new Map();
  for (const emp of scopedEmployees) {
    byEmployee.set(emp.id, {
      id: emp.id,
      name: emp.name,
      payRate: Number(emp.default_pay_rate || 0),
      role: emp.role,
      is_admin: Number(emp.is_admin || 0),
      entries: [],
    });
  }

  const scopedEntries = includeAdmin ? entries : entries.filter((row) => !isAdminEmployee(row));
  for (const row of scopedEntries) {
    if (!byEmployee.has(row.employee_id)) {
      byEmployee.set(row.employee_id, {
        id: row.employee_id,
        name: row.employee_name,
        payRate: Number(row.default_pay_rate || 0),
        role: row.role,
        is_admin: Number(row.is_admin || 0),
        entries: [],
      });
    }
    byEmployee.get(row.employee_id).entries.push({ ...row });
  }

  const employeesOrdered = [...byEmployee.values()].sort((a, b) => {
    const rateCmp = Number(a.payRate || 0) - Number(b.payRate || 0);
    if (rateCmp !== 0) return rateCmp;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JCW Labor Timekeeper";
  workbook.calcProperties.fullCalcOnLoad = true;

  const timecardsSheet = workbook.addWorksheet("Weekly Timecards");
  const summarySheet = workbook.addWorksheet("Week Summary");

  const weekLabel = `${formatMdy(ymdToDate(weekStartYmd))} - ${formatMdy(ymdToDate(weekEndYmd))}`;

  const summaryRows = writeTimecardsSheet({
    ws: timecardsSheet,
    db,
    employeesOrdered,
    weekStartYmd,
    weekEndYmd,
    weekLabel,
  });

  writeSummarySheet({
    ws: summarySheet,
    summaryRows,
    weekLabel,
  });

  const filename = `Weekly_Payroll_${weekStartYmd}.xlsx`;
  const filepath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(filepath);

  const totalHours = round2(summaryRows.reduce((sum, row) => sum + Number(row.hours || 0), 0));
  const totalAmount = round2(summaryRows.reduce((sum, row) => sum + Number(row.total || 0), 0));

  const totals = {
    employees: employeesOrdered.length,
    totalHours,
    totalRegular: totalHours,
    totalOT: 0,
    totalAmount,
    adminAmount: includeAdmin ? totalAmount : 0,
    hourlyAmount: includeAdmin ? 0 : totalAmount,
  };

  return {
    files: [{
      employee: "ALL_EMPLOYEES",
      category: includeAdmin ? "all" : "hourly",
      filename,
      filepath,
      hours: totalHours,
      regularHours: totalHours,
      otHours: 0,
      amount: totalAmount,
    }],
    totals,
    outputDir,
  };
}

function writeTimecardsSheet({ ws, db, employeesOrdered, weekLabel }) {
  ws.columns = [
    { width: 12 }, // A Date
    { width: 26 }, // B Customer
    { width: 12 }, // C Time Start
    { width: 8 },  // D Lunch
    { width: 12 }, // E Time Out
    { width: 12 }, // F Hours
    { width: 48 }, // G Notes
  ];

  ws.getCell("A1").value = `Weekly Payroll Timecards - ${weekLabel}`;
  ws.getCell("A1").font = { bold: true, size: 15 };
  ws.mergeCells("A1:G1");

  ws.getCell("A2").value = "Employees sorted by pay rate (lowest to highest). Admin excluded.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  ws.mergeCells("A2:G2");

  let rowNum = 4;
  const summaryRows = [];

  for (const emp of employeesOrdered) {
    const adjustedEntries = applyLunchNetHours(emp.entries.map((entry) => ({ ...entry })));
    const dayMap = groupByDate(adjustedEntries);
    const dayTotalRefs = [];

    ws.getCell(`A${rowNum}`).value = `Employee: ${emp.name}`;
    ws.getCell(`A${rowNum}`).font = { bold: true, size: 12 };
    ws.getCell(`F${rowNum}`).value = "Pay Rate:";
    ws.getCell(`F${rowNum}`).font = { bold: true };
    ws.getCell(`G${rowNum}`).value = Number(emp.payRate || 0);
    ws.getCell(`G${rowNum}`).numFmt = '"$"#,##0.00';
    rowNum += 1;

    const headerRow = ws.getRow(rowNum);
    headerRow.values = ["Date", "Customer", "Time Start", "Lunch", "Time Out", "Hours", "Notes"];
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      cell.border = thinBorder();
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    rowNum += 1;

    let employeeHours = 0;

    for (const [workDate, rows] of [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const lunchHours = round2(rows.filter(isLunchEntry).reduce((sum, row) => sum + Number(row.raw_hours || 0), 0));
      const workRows = rows.filter((row) => !isLunchEntry(row));
      if (!workRows.length) continue;

      const dayDataStartRow = rowNum;
      let dayHours = 0;
      for (let i = 0; i < workRows.length; i += 1) {
        const row = workRows[i];
        const netHours = round2(Number(row.hours || 0));
        if (netHours <= 0) continue;

        const excelRow = ws.getRow(rowNum);
        excelRow.getCell(1).value = i === 0 ? formatDayLabel(workDate) : "";
        excelRow.getCell(2).value = row.customer_name;
        excelRow.getCell(3).value = formatTimeLabel(row.start_time);
        excelRow.getCell(4).value = i === 0 && lunchHours > 0 ? lunchHours : "";
        excelRow.getCell(5).value = formatTimeLabel(row.end_time);
        excelRow.getCell(6).value = netHours;
        excelRow.getCell(7).value = row.notes || "";
        applyDataRowStyle(excelRow);

        dayHours += netHours;
        employeeHours += netHours;

        const rate = Number(getBillRate(db, row.employee_id, row.customer_id) || 0);
        const key = `${row.customer_name}::${row.employee_name}`;
        let summary = summaryRows.find((r) => r.key === key);
        if (!summary) {
          summary = {
            key,
            customer: row.customer_name,
            employee: row.employee_name,
            rate: round2(rate),
            hours: 0,
            total: 0,
          };
          summaryRows.push(summary);
        }
        summary.hours = round2(summary.hours + netHours);
        summary.total = round2(summary.total + (netHours * rate));

        rowNum += 1;
      }

      const dayTotalRow = ws.getRow(rowNum);
      dayTotalRow.getCell(5).value = "Day Total:";
      dayTotalRow.getCell(5).font = { bold: true };
      const dayDataEndRow = rowNum - 1;
      if (dayDataEndRow >= dayDataStartRow) {
        dayTotalRow.getCell(6).value = {
          formula: `SUM(F${dayDataStartRow}:F${dayDataEndRow})`,
          result: round2(dayHours),
        };
      } else {
        dayTotalRow.getCell(6).value = round2(dayHours);
      }
      dayTotalRow.getCell(6).font = { bold: true };
      dayTotalRow.getCell(6).numFmt = "0.00";
      dayTotalRow.getCell(5).border = topBorder();
      dayTotalRow.getCell(6).border = topBorder();
      dayTotalRefs.push(`F${rowNum}`);
      rowNum += 1;
    }

    if (employeeHours === 0) {
      const noDataRow = ws.getRow(rowNum);
      noDataRow.getCell(1).value = "No approved entries for this week.";
      noDataRow.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
      ws.mergeCells(`A${rowNum}:G${rowNum}`);
      rowNum += 1;
    }

    const empTotalRow = ws.getRow(rowNum);
    empTotalRow.getCell(5).value = "Employee Total:";
    empTotalRow.getCell(5).font = { bold: true };
    if (dayTotalRefs.length > 0) {
      empTotalRow.getCell(6).value = {
        formula: `SUM(${dayTotalRefs.join(",")})`,
        result: round2(employeeHours),
      };
    } else {
      empTotalRow.getCell(6).value = round2(employeeHours);
    }
    empTotalRow.getCell(6).font = { bold: true };
    empTotalRow.getCell(6).numFmt = "0.00";
    empTotalRow.getCell(5).border = doubleTopBorder();
    empTotalRow.getCell(6).border = doubleTopBorder();
    rowNum += 2;
  }

  for (let r = 5; r <= ws.rowCount; r += 1) {
    ws.getCell(`D${r}`).numFmt = "0.00";
    ws.getCell(`F${r}`).numFmt = "0.00";
  }

  ws.views = [{ state: "frozen", ySplit: 3 }];

  return summaryRows;
}

function writeSummarySheet({ ws, summaryRows, weekLabel }) {
  ws.columns = [
    { width: 26 }, // A Customer
    { width: 24 }, // B Employee
    { width: 12 }, // C Rate
    { width: 12 }, // D Hours
    { width: 14 }, // E Total
  ];

  ws.getCell("A1").value = `Weekly Customer Summary - ${weekLabel}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A1:E1");

  ws.getCell("A2").value = "Sorted ascending by customer, then employee rate.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  ws.mergeCells("A2:E2");

  const headerRow = ws.getRow(4);
  headerRow.values = ["Customer", "Employee", "Rate", "Hours", "Total"];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  const ordered = [...summaryRows]
    .sort((a, b) => {
      const customerCmp = String(a.customer).localeCompare(String(b.customer));
      if (customerCmp !== 0) return customerCmp;
      const rateCmp = Number(a.rate || 0) - Number(b.rate || 0);
      if (rateCmp !== 0) return rateCmp;
      return String(a.employee).localeCompare(String(b.employee));
    });

  let rowNum = 5;
  let currentCustomer = null;
  let customerStartRow = null;
  let customerHours = 0;
  let customerTotal = 0;
  let grandHours = 0;
  let grandTotal = 0;
  const subtotalHourRefs = [];
  const subtotalTotalRefs = [];

  const flushCustomerSubtotal = () => {
    if (!currentCustomer || customerStartRow == null) return;
    const customerEndRow = rowNum - 1;
    if (customerEndRow < customerStartRow) return;
    const subtotalRow = ws.getRow(rowNum);
    subtotalRow.getCell(2).value = "Customer Subtotal:";
    subtotalRow.getCell(2).font = { bold: true };
    subtotalRow.getCell(4).value = {
      formula: `SUM(D${customerStartRow}:D${customerEndRow})`,
      result: round2(customerHours),
    };
    subtotalRow.getCell(4).font = { bold: true };
    subtotalRow.getCell(5).value = {
      formula: `SUM(E${customerStartRow}:E${customerEndRow})`,
      result: round2(customerTotal),
    };
    subtotalRow.getCell(5).font = { bold: true };
    subtotalRow.getCell(4).numFmt = "0.00";
    subtotalRow.getCell(5).numFmt = '"$"#,##0.00';
    subtotalRow.getCell(4).border = topBorder();
    subtotalRow.getCell(5).border = topBorder();
    subtotalHourRefs.push(`D${rowNum}`);
    subtotalTotalRefs.push(`E${rowNum}`);
    rowNum += 2;
    customerHours = 0;
    customerTotal = 0;
    customerStartRow = null;
  };

  for (const row of ordered) {
    if (currentCustomer !== row.customer) {
      flushCustomerSubtotal();
      currentCustomer = row.customer;
      customerStartRow = rowNum;
    }

    const excelRow = ws.getRow(rowNum);
    excelRow.getCell(1).value = row.customer;
    excelRow.getCell(2).value = row.employee;
    excelRow.getCell(3).value = round2(row.rate);
    excelRow.getCell(4).value = round2(row.hours);
    excelRow.getCell(5).value = {
      formula: `C${rowNum}*D${rowNum}`,
      result: round2(row.total),
    };
    applyDataRowStyle(excelRow, [1, 2, 3, 4, 5]);
    excelRow.getCell(3).numFmt = '"$"#,##0.00';
    excelRow.getCell(4).numFmt = "0.00";
    excelRow.getCell(5).numFmt = '"$"#,##0.00';

    customerHours += Number(row.hours || 0);
    customerTotal += Number(row.total || 0);
    grandHours += Number(row.hours || 0);
    grandTotal += Number(row.total || 0);

    rowNum += 1;
  }

  flushCustomerSubtotal();

  const grandRow = ws.getRow(rowNum);
  grandRow.getCell(1).value = "WEEK TOTAL";
  grandRow.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.getCell(4).value = subtotalHourRefs.length > 0
    ? { formula: `SUM(${subtotalHourRefs.join(",")})`, result: round2(grandHours) }
    : round2(grandHours);
  grandRow.getCell(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.getCell(5).value = subtotalTotalRefs.length > 0
    ? { formula: `SUM(${subtotalTotalRefs.join(",")})`, result: round2(grandTotal) }
    : round2(grandTotal);
  grandRow.getCell(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.getCell(4).numFmt = "0.00";
  grandRow.getCell(5).numFmt = '"$"#,##0.00';
  for (const c of [1, 2, 3, 4, 5]) {
    grandRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
    grandRow.getCell(c).border = thinBorder();
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

function groupByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.work_date)) map.set(row.work_date, []);
    map.get(row.work_date).push(row);
  }
  return map;
}

function applyLunchNetHours(rows) {
  for (const row of rows) {
    row.raw_hours = Number(row.hours || 0);
    row.hours = Number(row.hours || 0);
    // Lunch is tracked as its own row in JCW workflows.
    // Do not net lunch again from a work row, otherwise totals are under-reported.
    if (isLunchEntry(row)) row.hours = 0;
  }

  return rows;
}

function isLunchEntry(row) {
  const customer = String(row.customer_name || "").trim().toLowerCase();
  const notes = String(row.notes || "").trim().toLowerCase();
  return customer === "lunch" || notes.includes("lunch");
}

function isAdminEmployee(row) {
  const role = String(row.role || row.employee_role || "").toLowerCase();
  if (role === "admin") return true;
  if (Number(row.is_admin || row.employee_is_admin || 0) === 1) return true;
  const name = String(row.name || row.employee_name || "").trim().toLowerCase();
  return name === "chris jacobi" || name === "chris zavesky" || name === "chris z";
}

function parseTimeToHours(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh + (mm / 60);
}

function formatTimeLabel(value) {
  const h = parseTimeToHours(String(value || ""));
  if (h == null) return "";
  let hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatDayLabel(ymd) {
  const d = ymdToDate(ymd);
  const names = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];
  return `${names[d.getUTCDay()]}-${d.getUTCDate()}`;
}

function formatMdy(date) {
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const y = String(date.getUTCFullYear()).slice(-2);
  return `${m}/${d}/${y}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function thinBorder() {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
    bottom: { style: "thin" },
  };
}

function topBorder() {
  return { top: { style: "thin" } };
}

function doubleTopBorder() {
  return { top: { style: "double" } };
}

function applyDataRowStyle(row, columns = [1, 2, 3, 4, 5, 6, 7]) {
  for (const col of columns) {
    const cell = row.getCell(col);
    cell.border = thinBorder();
    if (col === 6 || col === 4 || col === 3 || col === 5) {
      cell.alignment = { horizontal: col === 2 || col === 7 ? "left" : "right", vertical: "middle" };
    }
  }
}

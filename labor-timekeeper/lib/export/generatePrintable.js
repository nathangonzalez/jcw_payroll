/**
 * Printable HTML Report Generator
 * Generates a single HTML page with all employee timesheets for a week.
 * Designed for one-click printing with proper page breaks.
 */

import { getBillRate, getClientBillRate } from "../billing.js";
import { getEmployeeCategory, splitEntriesWithOT, calculatePayWithOT } from "../classification.js";
import { weekDates, weekStartYMD, ymdToDate } from "../time.js";

/**
 * Generate printable HTML report for all employees for a week
 * @param {Object} options
 * @param {Database} options.db
 * @param {string} options.weekStart - YYYY-MM-DD
 * @param {boolean} [options.billingMode=false] - Use client billing rates instead of payroll rates
 * @returns {string} HTML string
 */
export function generatePrintableReport({ db, weekStart, billingMode = false }) {
  const normalizedWeekStart = weekStartYMD(ymdToDate(weekStart));
  const { ordered } = weekDates(normalizedWeekStart);
  const weekStartYmd = ordered[0].ymd;
  const weekEnd = ordered[6].ymd;

  const entries = db.prepare(`
    SELECT te.*, e.name as employee_name, e.is_admin, c.name as customer_name
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    WHERE te.work_date >= ? AND te.work_date <= ?
      AND te.status = 'APPROVED'
    ORDER BY e.name ASC, te.work_date ASC, te.start_time ASC
  `).all(weekStartYmd, weekEnd);

  // Group by employee
  const byEmployee = new Map();
  for (const row of entries) {
    if (!byEmployee.has(row.employee_id)) {
      byEmployee.set(row.employee_id, { name: row.employee_name, is_admin: row.is_admin, entries: [] });
    }
    byEmployee.get(row.employee_id).entries.push(row);
  }

  const reportType = billingMode ? 'Billing' : 'Payroll';
  const rateFunc = billingMode
    ? (empId, custId) => getClientBillRate(db, empId, custId)
    : (empId, custId) => getBillRate(db, empId, custId);

  const weekLabel = `${fmtDate(weekStartYmd)} - ${fmtDate(weekEnd)}`;
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${reportType} Report — ${weekLabel}</title>
<style>
  @page { size: landscape; margin: 0.4in; }
  @media print { .page-break { page-break-after: always; } .no-print { display: none !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #222; }
  .no-print { background: #1a56db; color: white; padding: 12px 24px; border: none; font-size: 16px; cursor: pointer; border-radius: 6px; margin: 16px; }
  .no-print:hover { background: #1e40af; }
  .sheet { padding: 12px; max-width: 1100px; }
  .header { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
  .subheader { font-size: 12px; color: #555; margin-bottom: 8px; }
  .two-panel { display: flex; gap: 16px; }
  .left-panel { flex: 3; }
  .right-panel { flex: 2; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  th { background: #d9e1f2; font-weight: bold; text-align: center; font-size: 10px; }
  td { font-size: 11px; }
  .num { text-align: right; }
  .bold { font-weight: bold; }
  .day-total td { border-top: 2px solid #555; font-weight: bold; }
  .grand-total td { border-top: 3px double #333; font-weight: bold; font-size: 12px; }
  .ot-row td { background: #fff3cd; }
  .summary-total td { border-top: 3px double #333; font-weight: bold; }
  .currency::before { content: '$'; }
</style></head><body>
<button class="no-print" onclick="window.print()">🖨️ Print All Timesheets</button>
<div style="text-align:center; margin:8px 0;" class="no-print">
  <img src="/icon-192.png" alt="JCW" style="height:40px; opacity:0.8;" />
</div>\n`;

  for (const [empId, emp] of byEmployee) {
    const category = getEmployeeCategory(emp.name);
    const rate = emp.entries.length > 0 ? rateFunc(emp.entries[0].employee_id, emp.entries[0].customer_id) : 0;

    // Group entries by date
    const byDate = new Map();
    for (const e of emp.entries) {
      if (!byDate.has(e.work_date)) byDate.set(e.work_date, []);
      byDate.get(e.work_date).push(e);
    }

    // Build client summary
    const clientSummary = new Map();
    let totalWorkHours = 0;
    for (const e of emp.entries) {
      if (isLunch(e)) continue;
      const key = e.customer_name;
      if (!clientSummary.has(key)) clientSummary.set(key, { hours: 0, rate: rateFunc(e.employee_id, e.customer_id) });
      clientSummary.get(key).hours += Number(e.hours || 0);
      totalWorkHours += Number(e.hours || 0);
    }

    // Calculate OT
    const otInfo = calculatePayWithOT(totalWorkHours, rate, category);

    html += `<div class="sheet page-break">
  <div class="header">${emp.name} — ${weekLabel}</div>
  <div class="subheader">${category === 'admin' ? 'Admin/Salary' : 'Hourly'} | Rate: $${rate}/hr</div>
  <div class="two-panel">
    <div class="left-panel">
      <table>
        <tr><th style="width:70px">Date</th><th>Client Name</th><th style="width:55px">Start</th><th style="width:45px">Lunch</th><th style="width:55px">Out</th><th style="width:70px">Hours</th><th>Notes</th></tr>\n`;

    const sortedDates = [...byDate.keys()].sort();
    let grandTotalHours = 0;

    for (const date of sortedDates) {
      const dayEntries = byDate.get(date);
      const d = new Date(date + 'T12:00:00');
      const dayNames = ['Sun','Mon','Tues','Wed','Thurs','Fri','Sat'];
      const dayName = dayNames[d.getDay()];
      const dayNum = d.getDate();

      const workEntries = dayEntries.filter(e => !isLunch(e));
      const lunchEntry = dayEntries.find(isLunch);
      const lunchHours = lunchEntry ? Number(lunchEntry.hours || 0) : 0;
      let dayTotal = 0;

      for (let i = 0; i < workEntries.length; i++) {
        const e = workEntries[i];
        const hours = Number(e.hours || 0);
        dayTotal += hours;
        const dateLabel = i === 0 ? `<b>${dayName}</b>` : (i === 1 ? `<b>${dayNum}</b>` : '');
        const startTime = e.start_time ? fmtTime(e.start_time) : '';
        const endTime = e.end_time ? fmtTime(e.end_time) : '';
        const lunch = (i === 0 && lunchHours > 0) ? lunchHours : '';
        html += `        <tr><td>${dateLabel}</td><td>${e.customer_name}</td><td class="num">${startTime}</td><td class="num">${lunch}</td><td class="num">${endTime}</td><td class="num">${hours}</td><td>${e.notes || ''}</td></tr>\n`;
      }

      // Day subtotal row
      grandTotalHours += dayTotal;
      html += `        <tr class="day-total"><td></td><td colspan="4"></td><td class="num">${round2(dayTotal)}</td><td></td></tr>\n`;
    }

    // Grand total + OT
    html += `        <tr class="grand-total"><td></td><td colspan="4"><b>TOTAL</b></td><td class="num">${round2(grandTotalHours)}</td><td></td></tr>\n`;

    if (category === 'hourly' && otInfo.otHours > 0) {
      html += `        <tr class="ot-row"><td></td><td colspan="4">Regular (≤40h)</td><td class="num">${round2(otInfo.regularHours)}</td><td></td></tr>\n`;
      html += `        <tr class="ot-row"><td></td><td colspan="4"><b>OVERTIME (1.5x)</b></td><td class="num">${round2(otInfo.otHours)}</td><td></td></tr>\n`;
    }

    html += `      </table>
    </div>
    <div class="right-panel">
      <table>
        <tr><th>Client</th><th style="width:60px">Hours</th><th style="width:65px">Rate</th><th style="width:80px">Total</th></tr>\n`;

    let summaryTotal = 0;
    for (const [client, info] of [...clientSummary.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const total = round2(info.hours * info.rate);
      summaryTotal += total;
      html += `        <tr><td>${client}</td><td class="num">${round2(info.hours)}</td><td class="num">$${info.rate.toFixed(2)}</td><td class="num">$${total.toFixed(2)}</td></tr>\n`;
    }

    // OT premium row in summary
    if (category === 'hourly' && otInfo.otHours > 0) {
      const otPremium = round2(otInfo.otHours * rate * 0.5);
      summaryTotal += otPremium;
      html += `        <tr class="ot-row"><td><b>OT Premium (0.5x)</b></td><td class="num">${round2(otInfo.otHours)}</td><td class="num">$${round2(rate * 0.5).toFixed(2)}</td><td class="num">$${otPremium.toFixed(2)}</td></tr>\n`;
    }

    html += `        <tr class="summary-total"><td><b>TOTAL</b></td><td class="num"><b>${round2(grandTotalHours)}</b></td><td class="num"><b>$${rate.toFixed(2)}</b></td><td class="num"><b>$${summaryTotal.toFixed(2)}</b></td></tr>\n`;
    html += `      </table>
    </div>
  </div>
</div>\n`;
  }

  html += `</body></html>`;
  return html;
}

function isLunch(e) {
  return (e.customer_name || '').toLowerCase() === 'lunch' || (e.notes || '').toLowerCase().includes('lunch');
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function fmtDate(ymd) {
  const d = new Date(ymd + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

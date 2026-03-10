const { test, expect } = require("@playwright/test");
const ExcelJS = require("exceljs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "7707";

const ADMIN_MATRIX = [
  { customer: "Campbell", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Caputo (Maint Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Caputo (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Corr", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Delacruz", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Ericson", cjRate: 100, cjHours: 0, czRate: 100, czHours: 10 },
  { customer: "Fritts (Roof / Mold Issue)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Funke (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Funke (Maint Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Gonzalez (Nathan Personal)", cjRate: 90, cjHours: 0, czRate: 90, czHours: 14 },
  { customer: "Hall", cjRate: 100, cjHours: 20, czRate: 100, czHours: 0 },
  { customer: "Horr (Maint)", cjRate: 100, cjHours: 2, czRate: 100, czHours: 0 },
  { customer: "Horr (Insp.)", cjRate: 100, cjHours: 3, czRate: 100, czHours: 0 },
  { customer: "Howard", cjRate: 90, cjHours: 0, czRate: 90, czHours: 0 },
  { customer: "Jebsen", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Knight (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Knight (Maint Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 7 },
  { customer: "Landy", cjRate: 90, cjHours: 0, czRate: 90, czHours: 25 },
  { customer: "Leixner-Smith (Insp)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Lynn", cjRate: 90, cjHours: 135, czRate: 90, czHours: 0 },
  { customer: "Markfield", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "McClure (Maint. Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "McClure (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "McFarland", cjRate: 100, cjHours: 0, czRate: 100, czHours: 4 },
  { customer: "McGill", cjRate: 90, cjHours: 0, czRate: 90, czHours: 0 },
  { customer: "Montross (Maint. Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Montross (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Muncey (Maint. Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 8 },
  { customer: "Muncey  (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Nagel", cjRate: 100, cjHours: 1, czRate: 100, czHours: 0 },
  { customer: "Null", cjRate: 100, cjHours: 0, czRate: 100, czHours: 2 },
  { customer: "O'Connor (Maint. Items)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "O'Connor (Insp.)", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Richer", cjRate: 90, cjHours: 0, czRate: 90, czHours: 0 },
  { customer: "Schroeder", cjRate: 100, cjHours: 0, czRate: 90, czHours: 0 },
  { customer: "Sweeney", cjRate: 85, cjHours: 0, czRate: 85, czHours: 0 },
  { customer: "Tercek", cjRate: 90, cjHours: 0, czRate: 90, czHours: 4 },
  { customer: "Theobald", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Tubergen", cjRate: 100, cjHours: 0, czRate: 100, czHours: 8 },
  { customer: "Ueltschi", cjRate: 85, cjHours: 0, czRate: 85, czHours: 30 },
  { customer: "Varricchio", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Vincent", cjRate: 100, cjHours: 10, czRate: 100, czHours: 0 },
  { customer: "Walsh", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
  { customer: "Watkins", cjRate: 90, cjHours: 0, czRate: 90, czHours: 35 },
  { customer: "Welles (Maint. Items)", cjRate: 100, cjHours: 12, czRate: 100, czHours: 0 },
  { customer: "Welles (Insp.)", cjRate: 100, cjHours: 1.5, czRate: 100, czHours: 0 },
  { customer: "Winn", cjRate: 100, cjHours: 0, czRate: 100, czHours: 5 },
  { customer: "Total Hours on Insp.", cjRate: 100, cjHours: 0, czRate: 100, czHours: 0 },
];

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function numericCell(cellValue) {
  if (cellValue == null || cellValue === "") return 0;
  if (typeof cellValue === "number") return cellValue;
  if (typeof cellValue === "object" && cellValue.result != null) return Number(cellValue.result || 0);
  return Number(cellValue || 0);
}

function assertNoFormulaErrors(workbook) {
  for (const ws of workbook.worksheets) {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (typeof value === "string") {
          expect(value).not.toContain("#REF!");
          expect(value).not.toContain("#VALUE!");
        }
        if (value && typeof value === "object" && value.formula) {
          expect(value.formula).not.toContain("#REF!");
          expect(value.formula).not.toContain("#VALUE!");
        }
      });
    });
  }
}

function getSummarySnapshot(workbook) {
  const summary = workbook.getWorksheet("Admin Monthly");
  expect(summary).toBeTruthy();

  const byKey = new Map();
  let monthTotalHours = 0;
  let monthTotalAmount = 0;
  for (let i = 2; i <= summary.rowCount; i += 1) {
    const customer = String(summary.getCell(`A${i}`).value || "").trim();
    if (!customer) continue;
    if (customer === "MONTH TOTAL") {
      monthTotalHours = numericCell(summary.getCell(`D${i}`).value);
      monthTotalAmount = numericCell(summary.getCell(`E${i}`).value);
      break;
    }
    const admin = String(summary.getCell(`B${i}`).value || "").trim();
    byKey.set(`${normalizeName(customer)}::${normalizeName(admin)}`, {
      hours: numericCell(summary.getCell(`D${i}`).value),
      rate: numericCell(summary.getCell(`C${i}`).value),
      total: numericCell(summary.getCell(`E${i}`).value),
    });
  }

  return { byKey, monthTotalHours, monthTotalAmount };
}

async function ensureSeed(request) {
  const response = await request.post(`${BASE}/api/admin/seed`, {
    headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json" },
    data: {},
  });
  expect(response.ok()).toBeTruthy();
}

function findEmployee(employees, candidates) {
  const norms = candidates.map(normalizeName);
  for (const employee of employees) {
    const current = normalizeName(employee.name);
    if (norms.some((target) => current.includes(target))) return employee;
  }
  return null;
}

async function downloadWorkbook(request, month) {
  const exportResp = await request.get(`${BASE}/api/export/monthly-admin?month=${month}`);
  expect(exportResp.ok()).toBeTruthy();
  const workbookBuffer = await exportResp.body();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);
  return workbook;
}

test.describe("Admin Monthly Formula Stress Gate", () => {
  test("uses provided Chris J/Z matrix and validates formulas + totals", async ({ request }) => {
    const month = "2026-12";
    const runTag = `UAT_ADMIN_MATRIX_${Date.now()}`;

    await ensureSeed(request);

    const empResp = await request.get(`${BASE}/api/employees`);
    expect(empResp.ok()).toBeTruthy();
    const employees = await empResp.json();
    const chrisJ = findEmployee(employees, ["chris jacobi", "chris j"]);
    const chrisZ = findEmployee(employees, ["chris zavesky", "chris z"]);
    expect(chrisJ).toBeTruthy();
    expect(chrisZ).toBeTruthy();

    const weeksResp = await request.get(`${BASE}/api/payroll-weeks?month=${month}`);
    expect(weeksResp.ok()).toBeTruthy();
    const weeksData = await weeksResp.json();
    const weekStart = weeksData.weeks[0];
    expect(weekStart).toBeTruthy();

    for (const row of ADMIN_MATRIX) {
      const cResp = await request.post(`${BASE}/api/customers/find-or-create`, {
        headers: { "Content-Type": "application/json" },
        data: { name: row.customer },
      });
      expect(cResp.ok()).toBeTruthy();
    }

    const rateRows = [];
    for (const row of ADMIN_MATRIX) {
      rateRows.push({ customer: row.customer, employee: chrisJ.name, bill_rate: row.cjRate });
      rateRows.push({ customer: row.customer, employee: chrisZ.name, bill_rate: row.czRate });
    }
    const upsertRatesResp = await request.post(`${BASE}/api/admin/upsert-rates`, {
      headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
      data: { rates: rateRows },
    });
    expect(upsertRatesResp.ok()).toBeTruthy();

    const baselineWorkbook = await downloadWorkbook(request, month);
    const baseline = getSummarySnapshot(baselineWorkbook);

    const addEntry = async (employeeId, customerName, hours) => {
      if (!hours) return;
      const customerResp = await request.post(`${BASE}/api/customers/find-or-create`, {
        headers: { "Content-Type": "application/json" },
        data: { name: customerName },
      });
      expect(customerResp.ok()).toBeTruthy();
      const customerBody = await customerResp.json();
      const saveResp = await request.post(`${BASE}/api/time-entries`, {
        headers: { "Content-Type": "application/json" },
        data: {
          employee_id: employeeId,
          customer_id: customerBody.customer.id,
          work_date: weekStart,
          hours,
          notes: `${runTag} ${customerName}`,
        },
      });
      expect(saveResp.ok()).toBeTruthy();
    };

    for (const row of ADMIN_MATRIX) {
      await addEntry(chrisJ.id, row.customer, row.cjHours);
      await addEntry(chrisZ.id, row.customer, row.czHours);
    }

    for (const employee of [chrisJ, chrisZ]) {
      const submitResp = await request.post(`${BASE}/api/submit-week`, {
        headers: { "Content-Type": "application/json" },
        data: { employee_id: employee.id, week_start: weekStart },
      });
      expect(submitResp.ok()).toBeTruthy();
    }

    const approvalsResp = await request.get(`${BASE}/api/approvals?week_start=${weekStart}`);
    expect(approvalsResp.ok()).toBeTruthy();
    const approvals = await approvalsResp.json();
    const ids = (approvals.submitted || [])
      .filter((row) => String(row.notes || "").startsWith(runTag))
      .map((row) => row.id);
    expect(ids.length).toBeGreaterThan(0);

    const approveResp = await request.post(`${BASE}/api/approve`, {
      headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
      data: { ids },
    });
    expect(approveResp.ok()).toBeTruthy();

    const workbook = await downloadWorkbook(request, month);

    assertNoFormulaErrors(workbook);
    const snapshot = getSummarySnapshot(workbook);

    const expectedByKey = new Map();
    for (const row of ADMIN_MATRIX) {
      if (row.cjHours > 0) {
        expectedByKey.set(`${normalizeName(row.customer)}::${normalizeName(chrisJ.name)}`, {
          hours: row.cjHours,
          rate: row.cjRate,
          total: row.cjHours * row.cjRate,
        });
      }
      if (row.czHours > 0) {
        expectedByKey.set(`${normalizeName(row.customer)}::${normalizeName(chrisZ.name)}`, {
          hours: row.czHours,
          rate: row.czRate,
          total: row.czHours * row.czRate,
        });
      }
    }

    for (const [key, expectedRow] of expectedByKey.entries()) {
      const before = baseline.byKey.get(key) || { hours: 0, total: 0 };
      const after = snapshot.byKey.get(key);
      expect(after, `Missing summary row for ${key}`).toBeTruthy();
      expect(after.hours - before.hours).toBeCloseTo(expectedRow.hours, 2);
      expect(after.total - before.total).toBeCloseTo(expectedRow.total, 2);
    }

    expect(snapshot.monthTotalHours - baseline.monthTotalHours).toBeCloseTo(336.5, 2);
    expect(snapshot.monthTotalAmount - baseline.monthTotalAmount).toBeCloseTo(31070, 2);

    const validateDetailSheet = (sheetName, hoursField, rateField) => {
      const ws = workbook.getWorksheet(sheetName);
      expect(ws, `Missing detail worksheet ${sheetName}`).toBeTruthy();
      const totalRowIndex = (() => {
        for (let i = 3; i <= ws.rowCount; i += 1) {
          if (String(ws.getCell(`I${i}`).value || "").trim() === "TOTAL:") return i;
        }
        return -1;
      })();
      expect(totalRowIndex).toBeGreaterThan(3);

      const expectedRows = ADMIN_MATRIX.filter((row) => row[hoursField] > 0);
      const seenCustomers = new Set();

      for (let i = 3; i < totalRowIndex; i += 1) {
        const customer = String(ws.getCell(`I${i}`).value || "").trim();
        if (!customer) continue;
        seenCustomers.add(normalizeName(customer));
        const amountCell = ws.getCell(`L${i}`).value;
        expect(amountCell).toBeTruthy();
        expect(typeof amountCell).toBe("object");
        expect(amountCell.formula).toBe(`J${i}*K${i}`);
      }

      for (const row of expectedRows) {
        expect(seenCustomers.has(normalizeName(row.customer))).toBeTruthy();
      }

      const jTotal = ws.getCell(`J${totalRowIndex}`).value;
      const lTotal = ws.getCell(`L${totalRowIndex}`).value;
      expect(jTotal && jTotal.formula).toBe(`SUM(J3:J${totalRowIndex - 1})`);
      expect(lTotal && lTotal.formula).toBe(`SUM(L3:L${totalRowIndex - 1})`);

      const expectedHours = expectedRows.reduce((sum, row) => sum + Number(row[hoursField] || 0), 0);
      const expectedAmount = expectedRows.reduce((sum, row) => sum + Number(row[hoursField] || 0) * Number(row[rateField] || 0), 0);
      expect(expectedHours).toBeGreaterThan(0);
      expect(expectedAmount).toBeGreaterThan(0);
    };

    validateDetailSheet(chrisJ.name, "cjHours", "cjRate");
    validateDetailSheet(chrisZ.name, "czHours", "czRate");
  });

  test("stress run: repeated monthly simulation keeps formulas valid", async ({ request }) => {
    const month = "2026-11";

    await ensureSeed(request);

    for (let i = 0; i < 4; i += 1) {
      const simResp = await request.post(`${BASE}/api/admin/simulate-month`, {
        headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
        data: {
          month,
          reset: i === 0,
          submit: true,
          approve: true,
        },
      });
      expect(simResp.ok(), `simulate-month failed at iteration ${i + 1}`).toBeTruthy();
    }

    const exportResp = await request.get(`${BASE}/api/export/monthly-admin?month=${month}`);
    expect(exportResp.ok()).toBeTruthy();
    const workbookBuffer = await exportResp.body();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);

    assertNoFormulaErrors(workbook);

    const summary = workbook.getWorksheet("Admin Monthly");
    expect(summary).toBeTruthy();

    let monthTotalHours = 0;
    let monthTotalAmount = 0;
    for (let i = 2; i <= summary.rowCount; i += 1) {
      const customer = String(summary.getCell(`A${i}`).value || "").trim();
      if (customer === "MONTH TOTAL") {
        monthTotalHours = numericCell(summary.getCell(`D${i}`).value);
        monthTotalAmount = numericCell(summary.getCell(`E${i}`).value);
        break;
      }
    }

    expect(monthTotalHours).toBeGreaterThan(0);
    expect(monthTotalAmount).toBeGreaterThan(0);
    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(2);
  });
});

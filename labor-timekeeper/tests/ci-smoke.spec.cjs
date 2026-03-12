const { test, expect } = require("@playwright/test");
const ExcelJS = require("exceljs");

const BASE = process.env.BASE_URL || "http://localhost:3000";

test.describe("CI Smoke", () => {
  test("health endpoint is up", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("employees endpoint returns seeded users", async ({ request }) => {
    const res = await request.get(`${BASE}/api/employees`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("customers endpoint exposes merged JCW Shop/Office option", async ({ request }) => {
    const res = await request.get(`${BASE}/api/customers`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const names = (Array.isArray(body) ? body : []).map((c) => String(c.name || ""));
    expect(names).toContain("JCW Shop/Office");
    expect(names).not.toContain("JCW");
    expect(names).not.toContain("Shop");
    expect(names).not.toContain("Office");
  });

  test("app page loads with employee selector", async ({ page }) => {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#employee")).toBeVisible();
  });

  test("admin page loads secret gate", async ({ page }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#secretInput")).toBeVisible();
  });

  test("payroll print does not double-subtract lunch rows", async ({ request }) => {
    const future = new Date(Date.now() + (1000 * 60 * 60 * 24 * 365 * 20) + Math.floor(Math.random() * 1000) * 86400000);
    const weekStart = future.toISOString().slice(0, 10);
    const plusOne = new Date(future.getTime() + 86400000).toISOString().slice(0, 10);
    const workDates = [weekStart, plusOne];

    const employees = await (await request.get(`${BASE}/api/employees`)).json();
    const targetEmployee = employees.find((e) => String(e.name || "").toLowerCase() === "jason green");
    expect(targetEmployee).toBeTruthy();

    const customers = await (await request.get(`${BASE}/api/customers`)).json();
    const lunch = customers.find((c) => String(c.name || "").toLowerCase() === "lunch");
    expect(lunch).toBeTruthy();
    const hallLike = customers.find((c) => String(c.name || "").toLowerCase().includes("hall"));
    const workCustomer = hallLike || customers.find((c) => c.id !== lunch.id);
    expect(workCustomer).toBeTruthy();

    for (const day of workDates) {
      const workRes = await request.post(`${BASE}/api/time-entries`, {
        data: {
          employee_id: targetEmployee.id,
          customer_id: workCustomer.id,
          work_date: day,
          hours: 8,
          notes: "ci regression work row",
        },
      });
      expect(workRes.ok()).toBeTruthy();

      const lunchRes = await request.post(`${BASE}/api/time-entries`, {
        data: {
          employee_id: targetEmployee.id,
          customer_id: lunch.id,
          work_date: day,
          hours: 0.5,
          notes: "Lunch",
        },
      });
      expect(lunchRes.ok()).toBeTruthy();
    }

    const submitRes = await request.post(`${BASE}/api/submit-week`, {
      data: { employee_id: targetEmployee.id, week_start: weekStart },
    });
    expect(submitRes.ok()).toBeTruthy();

    const approvals = await (await request.get(`${BASE}/api/approvals?week_start=${weekStart}`)).json();
    const ids = (approvals.submitted || [])
      .filter((e) => e.employee_id === targetEmployee.id)
      .map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);

    const approveRes = await request.post(`${BASE}/api/approve`, { data: { ids } });
    expect(approveRes.ok()).toBeTruthy();

    const html = await (await request.get(`${BASE}/api/admin/print-week?week_start=${weekStart}`)).text();
    const sections = html.split('<div class="sheet page-break">').slice(1);
    const targetSection = sections.find((section) => {
      const m = section.match(/<div class="header">([^<]+) — /);
      return m && m[1].trim() === targetEmployee.name;
    });
    expect(targetSection).toBeTruthy();
    const totalMatch = targetSection.match(/<tr class="grand-total">[\s\S]*?<td class="num">([0-9.]+)<\/td>/);
    expect(totalMatch).toBeTruthy();
    const printedTotal = Number(totalMatch[1]);
    expect(printedTotal).toBeCloseTo(16, 5);
  });

  test("weekly export workbook includes formulas (not static totals)", async ({ request }) => {
    const future = new Date(Date.now() + (1000 * 60 * 60 * 24 * 365 * 25) + Math.floor(Math.random() * 1000) * 86400000);
    const weekStart = future.toISOString().slice(0, 10);
    const nextDay = new Date(future.getTime() + 86400000).toISOString().slice(0, 10);

    const employees = await (await request.get(`${BASE}/api/employees`)).json();
    const targetEmployee = employees.find((e) => String(e.name || "").toLowerCase() === "doug kinsey")
      || employees.find((e) => String(e.name || "").toLowerCase() === "jason green");
    expect(targetEmployee).toBeTruthy();

    const customers = await (await request.get(`${BASE}/api/customers`)).json();
    const lunch = customers.find((c) => String(c.name || "").toLowerCase() === "lunch");
    const workCustomer = customers.find((c) => String(c.name || "").toLowerCase().includes("hall")) || customers[0];
    expect(workCustomer).toBeTruthy();
    expect(lunch).toBeTruthy();

    for (const day of [weekStart, nextDay]) {
      const workRes = await request.post(`${BASE}/api/time-entries`, {
        data: {
          employee_id: targetEmployee.id,
          customer_id: workCustomer.id,
          work_date: day,
          hours: 8,
          notes: "ci formula work row",
        },
      });
      expect(workRes.ok()).toBeTruthy();

      const lunchRes = await request.post(`${BASE}/api/time-entries`, {
        data: {
          employee_id: targetEmployee.id,
          customer_id: lunch.id,
          work_date: day,
          hours: 0.5,
          notes: "Lunch",
        },
      });
      expect(lunchRes.ok()).toBeTruthy();
    }

    const submitRes = await request.post(`${BASE}/api/submit-week`, {
      data: { employee_id: targetEmployee.id, week_start: weekStart },
    });
    expect(submitRes.ok()).toBeTruthy();

    const approvals = await (await request.get(`${BASE}/api/approvals?week_start=${weekStart}`)).json();
    const ids = (approvals.submitted || [])
      .filter((e) => e.employee_id === targetEmployee.id)
      .map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    const approveRes = await request.post(`${BASE}/api/approve`, { data: { ids } });
    expect(approveRes.ok()).toBeTruthy();

    const res = await request.get(`${BASE}/api/admin/generate-week?week_start=${weekStart}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.files)).toBeTruthy();
    expect(body.files.length).toBeGreaterThan(0);

    const file = body.files[0];
    expect(file.filepath).toBeTruthy();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file.filepath);

    const timecards = wb.getWorksheet("Weekly Timecards");
    const summary = wb.getWorksheet("Week Summary");
    expect(timecards).toBeTruthy();
    expect(summary).toBeTruthy();

    let timecardsFormulaCount = 0;
    timecards.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === "object" && cell.value.formula) {
          timecardsFormulaCount += 1;
        }
      });
    });

    let summaryFormulaCount = 0;
    summary.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === "object" && cell.value.formula) {
          summaryFormulaCount += 1;
        }
      });
    });

    expect(timecardsFormulaCount).toBeGreaterThan(0);
    expect(summaryFormulaCount).toBeGreaterThan(0);
  });
});

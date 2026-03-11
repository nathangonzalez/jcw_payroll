const { test, expect } = require("@playwright/test");

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
    const weekStart = "2030-01-02";
    const workDates = ["2030-01-02", "2030-01-03"];

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
});

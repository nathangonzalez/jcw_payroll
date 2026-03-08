const { test, expect } = require("@playwright/test");

const WEEK_START = process.env.UAT_WEEK_START || "2026-02-25";
const ADMIN_SECRET = process.env.ADMIN_SECRET_UAT || process.env.ADMIN_SECRET || "demo";
const RUN_UAT = process.env.UAT_DEMO === "1";

test.use({
  video: "on",
  screenshot: "on",
  trace: "on",
});

async function annotate(page, message) {
  await page.evaluate((text) => {
    const id = "__uat_annotate__";
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = id;
    el.textContent = `UAT: ${text}`;
    el.style.position = "fixed";
    el.style.top = "10px";
    el.style.right = "10px";
    el.style.zIndex = "999999";
    el.style.background = "rgba(0,0,0,0.75)";
    el.style.color = "#fff";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "6px";
    el.style.font = "12px/1.3 Arial, sans-serif";
    document.body.appendChild(el);
  }, message);
}

async function ensureAdminApprovedEntries(request, weekStart) {
  const [employeesRes, customersRes] = await Promise.all([
    request.get("/api/employees"),
    request.get("/api/customers"),
  ]);
  expect(employeesRes.ok()).toBeTruthy();
  expect(customersRes.ok()).toBeTruthy();
  const employees = await employeesRes.json();
  const customers = await customersRes.json();
  const billableCustomer = customers.find((c) => String(c.name || "").toLowerCase() !== "lunch") || customers[0];
  expect(billableCustomer?.id, "Expected at least one customer for UAT seed").toBeTruthy();

  const byName = new Map(employees.map((e) => [String(e.name || "").toLowerCase(), e]));
  const cj = byName.get("chris jacobi");
  const cz = byName.get("chris zavesky") || byName.get("chris z");
  expect(cj?.id, "Expected Chris Jacobi in employees").toBeTruthy();
  expect(cz?.id, "Expected Chris Zavesky/Chris Z in employees").toBeTruthy();

  const adminSeeds = [
    { employee_id: cj.id, hours: 1.5, notes: "UAT seed CJ" },
    { employee_id: cz.id, hours: 1.0, notes: "UAT seed CZ" },
  ];

  for (const row of adminSeeds) {
    const createRes = await request.post("/api/time-entries", {
      data: {
        employee_id: row.employee_id,
        customer_id: billableCustomer.id,
        work_date: weekStart,
        hours: row.hours,
        notes: row.notes,
      },
    });
    expect(createRes.ok(), "Failed to create UAT admin seed time entry").toBeTruthy();
    const submitRes = await request.post("/api/submit-week", {
      data: { employee_id: row.employee_id, week_start: weekStart },
    });
    expect(submitRes.ok(), "Failed to submit UAT admin seed week").toBeTruthy();
  }

  const approvalsRes = await request.get(`/api/approvals?week_start=${encodeURIComponent(weekStart)}`);
  expect(approvalsRes.ok(), "Failed to fetch approvals for UAT seed").toBeTruthy();
  const approvals = await approvalsRes.json();
  const targetIds = (approvals.submitted || [])
    .filter((r) => r.work_date === weekStart && [cj.id, cz.id].includes(r.employee_id))
    .map((r) => r.id);
  if (targetIds.length) {
    const approveRes = await request.post("/api/approve", { data: { ids: targetIds } });
    expect(approveRes.ok(), "Failed to approve UAT admin seed entries").toBeTruthy();
  }
}

test.describe("UAT Demo - Weekly Payroll Admin Decoupling", () => {
  test.skip(!RUN_UAT, "Set UAT_DEMO=1 to run this human-review demo.");

  test("print payroll excludes admin by default, includes admin when toggled", async ({ page, request }) => {
    test.slow();

    await test.step("Open admin and unlock", async () => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await annotate(page, "Open admin and unlock");
      await page.locator("#secretInput").fill(ADMIN_SECRET);
      await page.locator("#secretBtn").click();
      await expect(page.locator("#adminContent")).toBeVisible();
      await page.waitForTimeout(1200);
    });

    await test.step("Seed approved admin entries for selected week", async () => {
      await ensureAdminApprovedEntries(request, WEEK_START);
      const verifyRes = await request.get(`/api/admin/print-week?week_start=${encodeURIComponent(WEEK_START)}&include_admin=1`);
      expect(verifyRes.ok()).toBeTruthy();
      const html = await verifyRes.text();
      expect(html).toContain("Chris Jacobi");
      expect(html).toContain("Chris Zavesky");
    });

    await test.step("Select target payroll week", async () => {
      const weeks = await page.locator("#weekSelect option").allTextContents();
      let selectedWeek = weeks.includes(WEEK_START) ? WEEK_START : (weeks[0] || WEEK_START);
      for (const week of weeks) {
        const html = await page.evaluate(async (w) => {
          const res = await fetch(`/api/admin/print-week?week_start=${encodeURIComponent(w)}&include_admin=1`);
          return res.ok ? await res.text() : "";
        }, week);
        if (html.includes("Chris Jacobi") || html.includes("Chris Zavesky")) {
          selectedWeek = week;
          break;
        }
      }
      // Ensure target week exists in dropdown for deterministic selection
      await page.evaluate((w) => {
        const sel = document.querySelector("#weekSelect");
        if (!sel) return;
        const exists = [...sel.options].some((o) => o.value === w);
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = w;
          opt.textContent = w;
          sel.appendChild(opt);
        }
      }, selectedWeek);
      await annotate(page, `Select payroll week ${selectedWeek}`);
      await page.selectOption("#weekSelect", selectedWeek);
      await page.locator("#loadWeekBtn").click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "test-results/uat-decouple-01-week-loaded.png", fullPage: true });
    });

    await test.step("Print payroll with admin excluded (default)", async () => {
      await annotate(page, "Print payroll with Include Admin OFF");
      await page.locator("#includeAdminWeekly").uncheck();
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator("#printWeekBtn").click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      await popup.waitForTimeout(1500);
      const html = await popup.content();
      expect(html).not.toContain("Chris Jacobi");
      expect(html).not.toContain("Chris Zavesky");
      await annotate(popup, "Expected: Chris Jacobi / Chris Zavesky absent");
      await popup.screenshot({ path: "test-results/uat-decouple-02-no-admin.png", fullPage: true });
      await popup.close();
    });

    await test.step("Print payroll with admin included", async () => {
      await annotate(page, "Print payroll with Include Admin ON");
      await page.locator("#includeAdminWeekly").check();
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator("#printWeekBtn").click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      await popup.waitForTimeout(1500);
      const html = await popup.content();
      expect(html).toContain("Chris Jacobi");
      expect(html).toContain("Chris Zavesky");
      await annotate(popup, "Expected: Chris Jacobi / Chris Zavesky present");
      await popup.screenshot({ path: "test-results/uat-decouple-03-with-admin.png", fullPage: true });
      await popup.close();
    });
  });
});

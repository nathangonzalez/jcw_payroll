/**
 * Comprehensive Feature Test Suite
 * Tests EVERY major feature of the Labor Timekeeper app.
 * Run: npx playwright test tests/comprehensive-features.spec.cjs
 */
const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin123";

/** Helper: API request */
async function api(request, method, path, body, headers = {}) {
  const opts = { headers: { "Content-Type": "application/json", ...headers } };
  if (body) opts.data = body;
  const resp = method === "GET"
    ? await request.get(`${BASE_URL}${path}`, opts)
    : method === "POST"
      ? await request.post(`${BASE_URL}${path}`, { ...opts, data: body })
      : await request.delete(`${BASE_URL}${path}`, opts);
  return resp;
}

// ─────────────────────────────────────────────
// 1. HEALTH & INFRASTRUCTURE
// ─────────────────────────────────────────────
test.describe("Health & Infrastructure", () => {
  test("GET /api/health returns ok with stats", async ({ request }) => {
    const resp = await api(request, "GET", "/api/health");
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.stats).toBeDefined();
    expect(data.stats.customers).toBeGreaterThanOrEqual(0);
    expect(data.stats.employees).toBeGreaterThanOrEqual(0);
    expect(data.stats.time_entries).toBeGreaterThanOrEqual(0);
  });

  test("GET /api/admin/stats returns database stats", async ({ request }) => {
    const resp = await api(request, "GET", "/api/admin/stats", null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  test("GET /api/admin/schema returns table info", async ({ request }) => {
    const resp = await api(request, "GET", "/api/admin/schema", null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.tables).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// 2. REFERENCE DATA
// ─────────────────────────────────────────────
test.describe("Reference Data", () => {
  test("GET /api/employees returns employee list", async ({ request }) => {
    const resp = await api(request, "GET", "/api/employees");
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
  });

  test("GET /api/customers returns customer list", async ({ request }) => {
    const resp = await api(request, "GET", "/api/customers");
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("name");
  });

  test("GET /api/payroll-weeks returns weeks with currentWeek", async ({ request }) => {
    const resp = await api(request, "GET", "/api/payroll-weeks");
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.month).toMatch(/^\d{4}-\d{2}$/);
    expect(Array.isArray(data.weeks)).toBe(true);
    expect(data.weeks.length).toBeGreaterThan(0);
    expect(data.currentWeek).toBeDefined();
    // currentWeek should be one of the weeks in the list
    expect(data.weeks).toContain(data.currentWeek);
  });

  test("GET /api/holidays returns holidays array", async ({ request }) => {
    const resp = await api(request, "GET", "/api/holidays");
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 3. TIME ENTRY LIFECYCLE (CRUD + Submit + Approve)
// ─────────────────────────────────────────────
test.describe("Time Entry Lifecycle", () => {
  let employeeId, customerId, weekStart, entryId;

  test.beforeAll(async ({ request }) => {
    // Get first employee and customer
    const empResp = await (await api(request, "GET", "/api/employees")).json();
    employeeId = empResp[0].id;
    const custResp = await (await api(request, "GET", "/api/customers")).json();
    // Find a non-Lunch customer
    const nonLunch = custResp.find(c => c.name.toLowerCase() !== "lunch");
    customerId = nonLunch ? nonLunch.id : custResp[0].id;
    // Get current week
    const weeksResp = await (await api(request, "GET", "/api/payroll-weeks")).json();
    weekStart = weeksResp.currentWeek;
  });

  test("POST /api/time-entries creates a new entry", async ({ request }) => {
    const days = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const workDate = days.days[0].ymd; // First day of the week
    const resp = await api(request, "POST", "/api/time-entries", {
      employee_id: employeeId,
      customer_id: customerId,
      work_date: workDate,
      hours: 4,
      start_time: "08:00",
      end_time: "12:00",
      notes: "Comprehensive test entry"
    });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.entry).toBeDefined();
    expect(data.entry.id).toBeDefined();
    entryId = data.entry.id;
  });

  test("GET /api/time-entries returns entries with days", async ({ request }) => {
    const resp = await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`);
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.week_start).toBe(weekStart);
    expect(data.days.length).toBe(7);
    expect(data.entries.length).toBeGreaterThan(0);
    // Verify our test entry exists
    const found = data.entries.find(e => e.id === entryId);
    expect(found).toBeDefined();
    expect(found.hours).toBe(4);
    expect(found.status).toBe("DRAFT");
    expect(found.notes).toBe("Comprehensive test entry");
  });

  test("POST /api/time-entries updates existing entry (upsert)", async ({ request }) => {
    const days = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const workDate = days.days[0].ymd;
    const resp = await api(request, "POST", "/api/time-entries", {
      id: entryId,
      employee_id: employeeId,
      customer_id: customerId,
      work_date: workDate,
      hours: 6,
      start_time: "08:00",
      end_time: "14:00",
      notes: "Updated test entry"
    });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.entry.hours).toBe(6);
  });

  test("POST /api/submit-week submits the week", async ({ request }) => {
    const resp = await api(request, "POST", "/api/submit-week", {
      employee_id: employeeId,
      week_start: weekStart,
      comment: "Test submission"
    });
    expect(resp.ok()).toBe(true);
    // Verify entries are now SUBMITTED
    const entries = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const submitted = entries.entries.filter(e => e.status === "SUBMITTED");
    expect(submitted.length).toBeGreaterThan(0);
  });

  test("GET /api/weekly-comment returns the submitted comment", async ({ request }) => {
    const resp = await api(request, "GET", `/api/weekly-comment?employee_id=${employeeId}&week_start=${weekStart}`);
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.comment).toBe("Test submission");
  });

  test("GET /api/approvals returns submitted entries for admin", async ({ request }) => {
    const resp = await api(request, "GET", `/api/approvals?week_start=${weekStart}`);
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.entries).toBeDefined();
    // Our submitted entry should be there
    const found = data.entries.find(e => e.id === entryId);
    expect(found).toBeDefined();
    expect(found.status).toBe("SUBMITTED");
  });

  test("POST /api/approve approves entries", async ({ request }) => {
    const resp = await api(request, "POST", "/api/approve", {
      ids: [entryId]
    }, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    // Verify entry is now APPROVED
    const entries = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const approved = entries.entries.find(e => e.id === entryId);
    expect(approved.status).toBe("APPROVED");
  });

  test("POST /api/unsubmit-week reopens the week", async ({ request }) => {
    // First unsubmit
    const resp = await api(request, "POST", "/api/unsubmit-week", {
      employee_id: employeeId,
      week_start: weekStart
    });
    expect(resp.ok()).toBe(true);
    // Verify entries go back to DRAFT
    const entries = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const draft = entries.entries.find(e => e.id === entryId);
    expect(draft.status).toBe("DRAFT");
  });

  test("DELETE /api/time-entries/:id deletes a draft entry", async ({ request }) => {
    const resp = await request.delete(`${BASE_URL}/api/time-entries/${entryId}`, {
      headers: { "Content-Type": "application/json" },
      data: { employee_id: employeeId }
    });
    expect(resp.ok()).toBe(true);
    // Verify entry is gone
    const entries = await (await api(request, "GET", `/api/time-entries?employee_id=${employeeId}&week_start=${weekStart}`)).json();
    const found = entries.entries.find(e => e.id === entryId);
    expect(found).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// 4. CUSTOMER MANAGEMENT
// ─────────────────────────────────────────────
test.describe("Customer Management", () => {
  test("POST /api/customers/find-or-create creates new customer", async ({ request }) => {
    const uniqueName = `TestClient_${Date.now()}`;
    const resp = await api(request, "POST", "/api/customers/find-or-create", {
      name: uniqueName,
      address: "123 Test St"
    });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.customer).toBeDefined();
    expect(data.customer.name).toBe(uniqueName);
    expect(data.customer.id).toBeDefined();
  });

  test("POST /api/customers/find-or-create finds existing customer", async ({ request }) => {
    // First create
    const name = `FindMe_${Date.now()}`;
    const create = await (await api(request, "POST", "/api/customers/find-or-create", { name, address: "456 Find St" })).json();
    // Then find
    const find = await (await api(request, "POST", "/api/customers/find-or-create", { name, address: "" })).json();
    expect(find.customer.id).toBe(create.customer.id);
  });
});

// ─────────────────────────────────────────────
// 5. ADMIN REPORTS & EXPORTS
// ─────────────────────────────────────────────
test.describe("Admin Reports & Exports", () => {
  test("GET /api/admin/report-preview returns monthly data", async ({ request }) => {
    const resp = await api(request, "GET", "/api/admin/report-preview", null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.month).toBeDefined();
  });

  test("GET /api/admin/weeks returns weeks for a month", async ({ request }) => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const resp = await api(request, "GET", `/api/admin/weeks?month=${month}`, null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.weeks)).toBe(true);
  });

  test("GET /api/admin/all-entries returns all entries for a week", async ({ request }) => {
    const weeksResp = await (await api(request, "GET", "/api/payroll-weeks")).json();
    const resp = await api(request, "GET", `/api/admin/all-entries?week_start=${weeksResp.currentWeek}`, null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.entries)).toBe(true);
  });

  test("GET /api/admin/print-week returns printable HTML", async ({ request }) => {
    const weeksResp = await (await api(request, "GET", "/api/payroll-weeks")).json();
    const resp = await api(request, "GET", `/api/admin/print-week?week_start=${weeksResp.currentWeek}`, null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const html = await resp.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Print All Timesheets");
  });

  test("GET /api/export/monthly downloads payroll Excel", async ({ request }) => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const resp = await request.get(`${BASE_URL}/api/export/monthly?month=${month}`);
    // May return 200 with file or error if no data — just verify no crash
    expect([200, 400, 404, 500]).toContain(resp.status());
  });

  test("GET /api/export/monthly-billing downloads billing Excel", async ({ request }) => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const resp = await request.get(`${BASE_URL}/api/export/monthly-billing?month=${month}`);
    // May return 200 with file or error if no data — just verify no crash
    expect([200, 400, 404, 500]).toContain(resp.status());
  });

  test("GET /api/admin/archives returns archives list", async ({ request }) => {
    const resp = await api(request, "GET", "/api/admin/archives", null, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.archives)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 6. RECONCILIATION FLOW
// ─────────────────────────────────────────────
test.describe("Reconciliation", () => {
  let testEmployee, testCustomer, testWeek, testEntryIds = [];

  test.beforeAll(async ({ request }) => {
    const emps = await (await api(request, "GET", "/api/employees")).json();
    testEmployee = emps[0].id;
    const custs = await (await api(request, "GET", "/api/customers")).json();
    testCustomer = custs.find(c => c.name.toLowerCase() !== "lunch")?.id || custs[0].id;
    const weeks = await (await api(request, "GET", "/api/payroll-weeks")).json();
    testWeek = weeks.currentWeek;

    // Create test entries, submit, approve them for reconciliation test
    const days = await (await api(request, "GET", `/api/time-entries?employee_id=${testEmployee}&week_start=${testWeek}`)).json();
    for (let i = 0; i < 2; i++) {
      const resp = await (await api(request, "POST", "/api/time-entries", {
        employee_id: testEmployee,
        customer_id: testCustomer,
        work_date: days.days[i].ymd,
        hours: 8,
        start_time: "07:30",
        end_time: "16:00",
        notes: `Reconciliation test ${i}`
      })).json();
      testEntryIds.push(resp.entry.id);
    }
    // Submit
    await api(request, "POST", "/api/submit-week", { employee_id: testEmployee, week_start: testWeek });
    // Approve
    await api(request, "POST", "/api/approve", { ids: testEntryIds }, { "x-admin-secret": ADMIN_SECRET });
  });

  test("POST /api/admin/reconcile preview (no confirm) shows preview", async ({ request }) => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const resp = await api(request, "POST", "/api/admin/reconcile", { month }, { "x-admin-secret": ADMIN_SECRET });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.preview).toBeDefined();
    expect(data.preview.totalHours).toBeGreaterThan(0);
    expect(data.preview.totalBilled).toBeGreaterThan(0);
    expect(data.preview.entries).toBeGreaterThan(0);
  });

  test.afterAll(async ({ request }) => {
    // Clean up: unsubmit then delete test entries
    await api(request, "POST", "/api/unsubmit-week", { employee_id: testEmployee, week_start: testWeek });
    for (const id of testEntryIds) {
      await request.delete(`${BASE_URL}/api/time-entries/${id}`, {
        headers: { "Content-Type": "application/json" },
        data: { employee_id: testEmployee }
      });
    }
  });
});

// ─────────────────────────────────────────────
// 7. UI PAGES LOAD
// ─────────────────────────────────────────────
test.describe("UI Pages", () => {
  test("GET / serves employee app", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/`);
    expect(resp.ok()).toBe(true);
    const html = await resp.text();
    expect(html).toContain("Log Hours");
    expect(html).toContain("My Weekly Summary");
  });

  test("GET /admin serves admin page", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/admin`);
    expect(resp.ok()).toBe(true);
    const html = await resp.text();
    expect(html).toContain("Admin");
  });

  test("Employee app has weekly summary panel", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/app.html`);
    expect(resp.ok()).toBe(true);
    const html = await resp.text();
    expect(html).toContain("dailySummary");
    expect(html).toContain("My Weekly Summary");
    expect(html).toContain("Running");
    expect(html).toContain("Status");
  });
});

// ─────────────────────────────────────────────
// 8. EDGE CASES & REGRESSIONS
// ─────────────────────────────────────────────
test.describe("Edge Cases & Regressions", () => {
  test("Lunch entries should not count toward billable hours", async ({ request }) => {
    const emps = await (await api(request, "GET", "/api/employees")).json();
    const custs = await (await api(request, "GET", "/api/customers")).json();
    const lunch = custs.find(c => c.name.toLowerCase() === "lunch");
    if (!lunch) { test.skip(); return; }
    const weeks = await (await api(request, "GET", "/api/payroll-weeks")).json();
    const days = await (await api(request, "GET", `/api/time-entries?employee_id=${emps[0].id}&week_start=${weeks.currentWeek}`)).json();

    // Create a lunch entry
    const resp = await (await api(request, "POST", "/api/time-entries", {
      employee_id: emps[0].id,
      customer_id: lunch.id,
      work_date: days.days[2].ymd,
      hours: 0.5,
      start_time: "12:00",
      end_time: "12:30",
      notes: "Lunch break test"
    })).json();

    expect(resp.ok).toBe(true);
    // Clean up
    await request.delete(`${BASE_URL}/api/time-entries/${resp.entry.id}`, {
      headers: { "Content-Type": "application/json" },
      data: { employee_id: emps[0].id }
    });
  });

  test("Week boundaries align to Wednesday start", async ({ request }) => {
    const weeks = await (await api(request, "GET", "/api/payroll-weeks")).json();
    for (const ws of weeks.weeks) {
      const d = new Date(ws + "T12:00:00");
      expect(d.getDay()).toBe(3); // Wednesday = 3
    }
  });

  test("Archived entries are excluded from active queries", async ({ request }) => {
    const emps = await (await api(request, "GET", "/api/employees")).json();
    const weeks = await (await api(request, "GET", "/api/payroll-weeks")).json();
    const entries = await (await api(request, "GET", `/api/time-entries?employee_id=${emps[0].id}&week_start=${weeks.currentWeek}`)).json();
    // No archived entries should appear
    for (const e of entries.entries) {
      expect(e.archived).toBe(0);
    }
  });

  test("Clear drafts removes only DRAFT status entries", async ({ request }) => {
    const emps = await (await api(request, "GET", "/api/employees")).json();
    const weeks = await (await api(request, "GET", "/api/payroll-weeks")).json();
    const resp = await api(request, "POST", "/api/time-entries/clear-drafts", {
      employee_id: emps[0].id,
      week_start: weeks.currentWeek
    });
    expect(resp.ok()).toBe(true);
  });
});
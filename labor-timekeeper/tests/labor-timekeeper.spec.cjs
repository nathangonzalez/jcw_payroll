const { test, expect } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:3000";

test.describe("Labor Timekeeper - No Auth Flow", () => {
  test("home page shows app (employee selector)", async ({ page }) => {
    await page.goto(BASE);
    // Should show the app (either via redirect or direct serve)
    await expect(page.locator("#employee")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Log Hours");
  });

  test("app page shows employee selector", async ({ page }) => {
    await page.goto(BASE + "/app");
    await expect(page.locator("#employee")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Log Hours");
  });

  test("employee selector has options", async ({ page }) => {
    await page.goto(BASE + "/app");
    const options = await page.locator("#employee option").count();
    expect(options).toBeGreaterThan(1); // at least default + some employees
  });

  test("main card disabled until employee selected", async ({ page }) => {
    await page.goto(BASE + "/app");
    // Clear localStorage to ensure fresh state
    await page.evaluate(() => localStorage.removeItem('labor_timekeeper_employee'));
    await page.reload();
    
    const mainCard = page.locator("#mainCard");
    const opacity = await mainCard.evaluate(el => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  test("selecting employee enables main card", async ({ page }) => {
    await page.goto(BASE + "/app");
    
    // Select first non-empty employee
    const options = await page.locator("#employee option").all();
    expect(options.length).toBeGreaterThan(1);
    
    await page.selectOption("#employee", { index: 1 });
    await page.waitForTimeout(500);
    
    const mainCard = page.locator("#mainCard");
    const opacity = await mainCard.evaluate(el => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBe(1);
  });
});

test.describe("Labor Timekeeper - Time Entry", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE + "/app");
    // Select first employee
    await page.selectOption("#employee", { index: 1 });
    await page.waitForTimeout(300);
  });

  test("customer select dropdown exists", async ({ page }) => {
    await expect(page.locator("#customerSelect")).toBeVisible();
  });

  test("customer options include addresses", async ({ page }) => {
    const options = await page.locator("#customerSelect option").allTextContents();
    expect(options.length).toBeGreaterThan(1); // At least one customer + placeholder
    // Options should be in format "Name — Address"
    const hasAddress = options.some(opt => opt.includes(" — "));
    expect(hasAddress).toBe(true);
  });

  test("selecting customer shows address", async ({ page }) => {
    // Find McGill option and select it by getting all options
    const options = await page.locator("#customerSelect option").allTextContents();
    const mcGillIndex = options.findIndex(opt => opt.includes("McGill"));
    expect(mcGillIndex).toBeGreaterThan(0);
    await page.selectOption("#customerSelect", { index: mcGillIndex });
    await expect(page.locator("#customerAddress")).toContainText("800 Beach Rd");
  });

  test("day selector has weekday options", async ({ page }) => {
    const options = await page.locator("#day option").count();
    expect(options).toBe(7); // 7 days in a week
  });
});

test.describe("Labor Timekeeper - Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE + "/admin?admin_secret=7707");
    await page.waitForSelector("#pinInput", { state: "visible" });
    // Enter PIN to unlock admin page
    await page.fill("#pinInput", "7707");
    await page.click("#pinBtn");
    await page.waitForTimeout(300);
  });

  test("admin page loads with PIN unlock", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Admin");
  });

  test("admin page shows pipeline buttons", async ({ page }) => {
    await expect(page.locator("#genWeekBtn")).toBeVisible();
    await expect(page.locator("#genMonthBtn")).toBeVisible();
  });
});

test.describe("Labor Timekeeper - API Endpoints (No Auth)", () => {
  test("GET /api/customers returns list with addresses", async ({ request }) => {
    const response = await request.get(`${BASE}/api/customers`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    
    const first = data[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("address");
  });

  test("GET /api/employees returns list", async ({ request }) => {
    const response = await request.get(`${BASE}/api/employees`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  test("POST /api/customers/find-or-create creates new customer", async ({ request }) => {
    const newName = "API Test Customer " + Date.now();
    const response = await request.post(`${BASE}/api/customers/find-or-create`, {
      headers: { "Content-Type": "application/json" },
      data: { name: newName, address: "123 Test Street" }
    });
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.created).toBe(true);
    expect(data.customer.name).toBe(newName);
  });

  test("GET /api/time-entries requires employee_id", async ({ request }) => {
    const response = await request.get(`${BASE}/api/time-entries`);
    expect(response.ok()).toBe(false);
    expect(response.status()).toBe(400);
  });

  test("GET /api/time-entries works with employee_id", async ({ request }) => {
    // First get an employee id
    const empResponse = await request.get(`${BASE}/api/employees`);
    const employees = await empResponse.json();
    const empId = employees[0].id;
    
    const response = await request.get(`${BASE}/api/time-entries?employee_id=${empId}`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty("week_start");
    expect(data).toHaveProperty("days");
    expect(Array.isArray(data.entries)).toBe(true);
  });

  test("GET /api/holidays returns holidays", async ({ request }) => {
    const response = await request.get(`${BASE}/api/holidays?year=2026`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.holidays)).toBe(true);
  });
});

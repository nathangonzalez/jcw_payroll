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

  test("app page loads with employee selector", async ({ page }) => {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#employee")).toBeVisible();
  });

  test("admin page loads secret gate", async ({ page }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#secretInput")).toBeVisible();
  });
});

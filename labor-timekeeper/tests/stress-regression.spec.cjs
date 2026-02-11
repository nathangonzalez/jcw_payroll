const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '7707';
const WEEK_START = process.env.STRESS_WEEK_START || '2026-01-28';

async function getJson(request, url, headers) {
  const resp = await request.get(url, { headers });
  expect(resp.ok()).toBe(true);
  return await resp.json();
}

async function postJson(request, url, data, headers) {
  const resp = await request.post(url, { data, headers: { 'Content-Type': 'application/json', ...(headers || {}) } });
  return resp;
}

test.describe('Regression: API edge cases', () => {
  test('time-entries requires employee_id/customer_id/work_date', async ({ request }) => {
    const resp = await postJson(request, `${BASE}/api/time-entries`, { hours: 1 });
    expect(resp.status()).toBe(400);
  });

  test('submit-week requires employee_id', async ({ request }) => {
    const resp = await postJson(request, `${BASE}/api/submit-week`, { week_start: WEEK_START });
    expect(resp.status()).toBe(400);
  });

  test('time-entries rejects invalid hours', async ({ request }) => {
    const emps = await getJson(request, `${BASE}/api/employees`);
    const custs = await getJson(request, `${BASE}/api/customers`);
    const emp = emps[0];
    const cust = custs.find(c => c.name.toLowerCase() !== 'lunch');
    const resp = await postJson(request, `${BASE}/api/time-entries`, {
      employee_id: emp.id,
      customer_id: cust.id,
      work_date: WEEK_START,
      hours: 'NaN'
    });
    expect(resp.status()).toBe(400);
  });
});

test.describe('Regression: Admin workflow', () => {
  test('submit + approvals for prior week works', async ({ request }) => {
    const emps = await getJson(request, `${BASE}/api/employees`);
    const custs = await getJson(request, `${BASE}/api/customers`);
    const emp = emps.find(e => e.name === 'Boban Abbate') || emps[0];
    const cust = custs.find(c => c.name.toLowerCase() !== 'lunch');

    const entry = {
      employee_id: emp.id,
      customer_id: cust.id,
      work_date: WEEK_START,
      hours: 2,
      notes: 'pw regression'
    };
    const eResp = await postJson(request, `${BASE}/api/time-entries`, entry);
    expect(eResp.ok()).toBe(true);

    const sResp = await postJson(request, `${BASE}/api/submit-week`, {
      employee_id: emp.id,
      week_start: WEEK_START,
      comment: 'pw regression'
    });
    expect(sResp.ok()).toBe(true);

    const approvals = await getJson(request, `${BASE}/api/approvals?week_start=${encodeURIComponent(WEEK_START)}`, { 'x-admin-secret': ADMIN_SECRET });
    expect(Array.isArray(approvals.submitted)).toBe(true);
    expect(approvals.submitted.length).toBeGreaterThan(0);
  });
});

test.describe('Mobile UI smoke - iPhone 13', () => {
  test('app loads and inputs are visible', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.selectOption('#employee', { index: 1 });
    await expect(page.locator('#customerName')).toBeVisible();
    await expect(page.locator('#day')).toBeVisible();
    await expect(page.locator('#startTime')).toBeVisible();
    await expect(page.locator('#endTime')).toBeVisible();
  });
});

test.describe('Mobile UI smoke - Pixel 7', () => {
  test('app loads and inputs are visible', async ({ page }) => {
    await page.goto(`${BASE}/app`);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.selectOption('#employee', { index: 1 });
    await expect(page.locator('#customerName')).toBeVisible();
    await expect(page.locator('#day')).toBeVisible();
    await expect(page.locator('#startTime')).toBeVisible();
    await expect(page.locator('#endTime')).toBeVisible();
  });
});
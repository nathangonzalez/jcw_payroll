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
    await page.waitForFunction(() => document.querySelectorAll('#employee option').length > 1);
    const options = await page.locator("#employee option").count();
    expect(options).toBeGreaterThan(1); // at least default + some employees
  });

  test("main card disabled until employee selected", async ({ page }) => {
    await page.goto(BASE + "/app");
    await page.waitForFunction(() => document.querySelectorAll('#employee option').length > 1);
    // Clear localStorage to ensure fresh state
    await page.evaluate(() => localStorage.removeItem('labor_timekeeper_employee'));
    await page.reload();
    
    const mainCard = page.locator("#mainCard");
    await page.waitForFunction(() => {
      const el = document.querySelector('#mainCard');
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 1;
    });
    const opacity = await mainCard.evaluate(el => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  test("selecting employee enables main card", async ({ page }) => {
    await page.goto(BASE + "/app");
    
    // Select first non-empty employee
    await page.waitForFunction(() => document.querySelectorAll('#employee option').length > 1);
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
    await page.waitForFunction(() => document.querySelectorAll('#employee option').length > 1);
    // Select first employee
    await page.selectOption("#employee", { index: 1 });
    await page.waitForTimeout(300);
  });
  test("customer input exists", async ({ page }) => {
    await expect(page.locator("#customerName")).toBeVisible();
  });

  test("customer options include addresses", async ({ page }) => {
    const options = await page.locator("#customerList option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
    const hasAny = options.some(opt => opt && opt.trim().length > 0);
    expect(hasAny).toBe(true);
  });

  test("typing customer shows confirm", async ({ page }) => {
    await page.selectOption("#day", { index: 1 });
    await page.fill("#startTime", "07:30");
    await page.fill("#endTime", "16:00");
    await expect(page.locator("#customerName")).toBeEnabled();
    const options = await page.locator("#customerList option").allTextContents();
    const first = options.find(o => o && o.trim().length > 0) || "";
    const name = first.split(" ? ")[0].trim();
    await page.fill("#customerName", name);
    await page.dispatchEvent("#customerName", "change");
    await expect(page.locator("#customerConfirm")).not.toHaveText("");
  });

  test("day selector has weekday options", async ({ page }) => {
    const options = await page.locator("#day option").count();
    expect(options).toBe(7); // 7 days in a week
  });
});

test.describe("Labor Timekeeper - Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE + "/admin");
    const secretInput = page.locator("#secretInput");
    if (await secretInput.count()) {
      await secretInput.fill("7707");
      await page.click("#secretBtn");
    }
    await page.waitForSelector("#adminContent", { state: "visible" });
  });

  test("admin page loads with secret unlock", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Admin");
  });

  test("admin page shows report button", async ({ page }) => {
    await expect(page.locator("#genMonthBtn")).toBeVisible();
  });

  test("admin can simulate full month", async ({ request }) => {
    const adminSecret = process.env.ADMIN_SECRET || "7707";
    const now = new Date();
    const month = process.env.SIM_MONTH || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const resp = await request.post(`${BASE}/api/admin/simulate-month`, {
      headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
      data: { month, reset: true, submit: true, approve: true }
    });
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });
});

test.describe("Labor Timekeeper - Export Format", () => {
  test("weekly export matches Jason Green template layout", async ({ request }) => {
    test.skip(process.env.RUN_EXPORT_COMPARE !== "1", "Set RUN_EXPORT_COMPARE=1 to enable export comparison.");

    const weekStart = process.env.EXPORT_WEEK_START || "2026-01-26";
    const adminSecret = process.env.ADMIN_SECRET || "7707";

    const seedResp = await request.post(`${BASE}/api/admin/simulate-week`, {
      headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
      data: { week_start: weekStart, reset: true, submit: true, approve: true }
    });
    expect(seedResp.ok()).toBe(true);

    const genResp = await request.get(`${BASE}/api/admin/generate-week?week_start=${encodeURIComponent(weekStart)}`);
    expect(genResp.ok()).toBe(true);
    const genData = await genResp.json();
    const files = genData.files || [];
    const jason = files.find(f => /Jason_Green/i.test(f.filename)) || files[0];
    expect(jason).toBeTruthy();

    const month = weekStart.slice(0, 7);
    const fileUrl = `${BASE}/exports/${month}/${weekStart}/${encodeURIComponent(jason.filename)}`;
    const fileResp = await request.get(fileUrl);
    expect(fileResp.ok()).toBe(true);
    const buffer = await fileResp.body();

    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    expect(wb.worksheets.map(ws => ws.name)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);

    const sheet1 = wb.getWorksheet("Sheet1");
    const header = [];
    for (let i = 1; i <= 12; i++) header.push(sheet1.getRow(1).getCell(i).value || "");
    expect(header).toEqual([
      "Date", "Client Name", "Time Start", "Lunch", "Time Out", "Hours Per Job", "Notes", "", "Client", "Hours", "Rate", "Total"
    ]);
    expect(sheet1.getRow(39).getCell(5).value).toBe("Total:");
    expect(sheet1.getRow(39).getCell(6).value.formula).toBe("SUM(F2:F38)");
    expect(sheet1.getRow(2).getCell(10).value.formula).toBe("IF(I2=\"\",\"\",SUMIF($B$2:$B$38,TRIM(I2),$F$2:$F$38))");
    expect(sheet1.getRow(21).getCell(10).value.formula).toBe("SUM(J2:J20)");
    expect(sheet1.getRow(21).getCell(12).value.formula).toBe("IF(OR(J21=\"\",K21=\"\"),\"\",J21*K21)");
    expect(sheet1.getRow(2).getCell(12).value.formula).toBe("IF(OR(J2=\"\",K2=\"\"),\"\",J2*K2)");

    const sheet2 = wb.getWorksheet("Sheet2");
    expect(sheet2.getCell("A1").value).toBe("OFFICE USE ONLY:");
    expect(sheet2.getCell("A5").value).toBe("Jason Green");
    expect(sheet2.getCell("A7").value).toBe("JOB");
    expect(sheet2.getCell("B7").value).toBe("HOURS");
    expect(sheet2.getCell("C7").value).toBe("RATE");
    expect(sheet2.getCell("D7").value).toBe("TOTAL");
    expect(sheet2.getCell("F7").value).toBe("JOB");
    expect(sheet2.getCell("G7").value).toBe("HOURS");
    expect(sheet2.getCell("H7").value).toBe("RATE");
    expect(sheet2.getCell("I7").value).toBe("TOTAL");
    expect(sheet2.getCell("A21").value).toBe("HOURS");
    expect(sheet2.getCell("B21").value).toBe("RATE");
    expect(sheet2.getCell("C21").value).toBe("TOTAL");
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


test.describe("Labor Timekeeper - Stress Test (API)", () => {
  test("create, submit, approve full week for all employees", async ({ request }) => {
    const adminSecret = process.env.ADMIN_SECRET || "7707";
    const weekStart = process.env.STRESS_WEEK_START || "2026-01-28";

    const empResp = await request.get(`${BASE}/api/employees`);
    expect(empResp.ok()).toBe(true);
    const employees = await empResp.json();
    expect(employees.length).toBeGreaterThan(0);

    const custResp = await request.get(`${BASE}/api/customers`);
    expect(custResp.ok()).toBe(true);
    const customers = await custResp.json();
    const lunch = customers.find(c => c.name.toLowerCase() === "lunch");
    expect(lunch).toBeTruthy();

    const primaryCustomers = customers.filter(c => c.id !== lunch.id).slice(0, 5);
    expect(primaryCustomers.length).toBeGreaterThan(0);

    const weekDays = [
      "2026-01-28",
      "2026-01-29",
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
    ];

    for (const emp of employees) {
      let custIdx = 0;
      for (const day of weekDays) {
        const cust = primaryCustomers[custIdx % primaryCustomers.length];
        custIdx += 1;
        const workEntry = {
          employee_id: emp.id,
          customer_id: cust.id,
          work_date: day,
          hours: 8,
          notes: "stress test",
          status: "DRAFT"
        };
        const lunchEntry = {
          employee_id: emp.id,
          customer_id: lunch.id,
          work_date: day,
          hours: 0.5,
          notes: "lunch",
          status: "DRAFT"
        };
        const e1 = await request.post(`${BASE}/api/time-entries`, {
          headers: { "Content-Type": "application/json" },
          data: workEntry
        });
        expect(e1.ok()).toBe(true);
        const e2 = await request.post(`${BASE}/api/time-entries`, {
          headers: { "Content-Type": "application/json" },
          data: lunchEntry
        });
        expect(e2.ok()).toBe(true);
      }

      const submitResp = await request.post(`${BASE}/api/submit-week`, {
        headers: { "Content-Type": "application/json" },
        data: { employee_id: emp.id, week_start: weekStart, comment: "stress test submit" }
      });
      expect(submitResp.ok()).toBe(true);
    }

    const approvalsResp = await request.get(`${BASE}/api/approvals?week_start=${encodeURIComponent(weekStart)}`, {
      headers: { "x-admin-secret": adminSecret }
    });
    expect(approvalsResp.ok()).toBe(true);
    const approvals = await approvalsResp.json();
    const ids = (approvals.submitted || []).map(r => r.id);
    expect(ids.length).toBeGreaterThan(0);

    const approveResp = await request.post(`${BASE}/api/approve`, {
      headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
      data: { ids }
    });
    expect(approveResp.ok()).toBe(true);

    const previewResp = await request.get(`${BASE}/api/admin/report-preview?month=2026-02`, {
      headers: { "x-admin-secret": adminSecret }
    });
    expect(previewResp.ok()).toBe(true);
    const preview = await previewResp.json();
    expect(preview.ok).toBe(true);
    expect(preview.totals && preview.totals.hours).toBeGreaterThan(0);
  });
});

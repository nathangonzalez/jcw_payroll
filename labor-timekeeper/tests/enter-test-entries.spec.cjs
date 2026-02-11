/**
 * Playwright script to enter time entries via UI simulation.
 * Run with: npx playwright test tests/enter-test-entries.spec.cjs --headed
 * Or against patch: BASE_URL=https://p-dbtest-0205-dot-labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com npx playwright test tests/enter-test-entries.spec.cjs --headed
 */

const { test, expect } = require("@playwright/test");

const BASE = process.env.BASE_URL || "http://localhost:3000";

// Test entries data - the correct entries for last week
const TEST_ENTRIES = [
  { date: "2026-01-28", employee: "Boban Abbate", customer: "Behrens", hours: 3 },
  { date: "2026-01-29", employee: "Boban Abbate", customer: "Behrens", hours: 2 },
  { date: "2026-01-30", employee: "Boban Abbate", customer: "Behrens", hours: 1 },
  { date: "2026-01-28", employee: "Boban Abbate", customer: "Boyle", hours: 3.5 },
  { date: "2026-01-29", employee: "Boban Abbate", customer: "Boyle", hours: 6 },
  { date: "2026-01-29", employee: "Doug Kinsey", customer: "Boyle", hours: 8.5 },
  { date: "2026-01-29", employee: "Sean Matthew", customer: "Boyle", hours: 5.5 },
  { date: "2026-01-29", employee: "Thomas Brinson", customer: "Boyle", hours: 3 },
  { date: "2026-01-30", employee: "Boban Abbate", customer: "Boyle", hours: 7 },
  { date: "2026-01-30", employee: "Doug Kinsey", customer: "Boyle", hours: 8.75 },
  { date: "2026-01-30", employee: "Jason Green", customer: "Boyle", hours: 4.5 },
  { date: "2026-01-30", employee: "Sean Matthew", customer: "Boyle", hours: 4.5 },
  { date: "2026-02-02", employee: "Boban Abbate", customer: "Boyle", hours: 7.5 },
  { date: "2026-02-02", employee: "Doug Kinsey", customer: "Boyle", hours: 8.5 },
  { date: "2026-02-02", employee: "Jason Green", customer: "Boyle", hours: 1.5 },
  { date: "2026-02-02", employee: "Jason Green", customer: "Boyle", hours: 4 },
  { date: "2026-02-02", employee: "Sean Matthew", customer: "Boyle", hours: 8 },
  { date: "2026-02-02", employee: "Thomas Brinson", customer: "Boyle", hours: 2.5 },
  { date: "2026-02-02", employee: "Thomas Brinson", customer: "Boyle", hours: 1.5 },
  { date: "2026-02-03", employee: "Boban Abbate", customer: "Boyle", hours: 8 },
  { date: "2026-02-03", employee: "Doug Kinsey", customer: "Boyle", hours: 8 },
  { date: "2026-02-03", employee: "Sean Matthew", customer: "Boyle", hours: 7 },
  { date: "2026-02-02", employee: "Jason Green", customer: "Gee", hours: 0.5 },
  { date: "2026-01-28", employee: "Jason Green", customer: "Landy", hours: 7.5 },
  { date: "2026-01-28", employee: "Sean Matthew", customer: "Landy", hours: 8 },
  { date: "2026-01-28", employee: "Thomas Brinson", customer: "Landy", hours: 4.5 },
  { date: "2026-01-28", employee: "Thomas Brinson", customer: "Landy", hours: 3 },
  { date: "2026-01-29", employee: "Jason Green", customer: "Landy", hours: 7.5 },
  { date: "2026-01-29", employee: "Sean Matthew", customer: "Landy", hours: 2.5 },
  { date: "2026-01-29", employee: "Thomas Brinson", customer: "Landy", hours: 1.5 },
  { date: "2026-01-29", employee: "Thomas Brinson", customer: "Landy", hours: 3 },
  { date: "2026-01-30", employee: "Jason Green", customer: "Landy", hours: 3.5 },
  { date: "2026-01-30", employee: "Thomas Brinson", customer: "Landy", hours: 4.5 },
  { date: "2026-01-30", employee: "Thomas Brinson", customer: "Landy", hours: 3 },
  { date: "2026-02-02", employee: "Thomas Brinson", customer: "Landy", hours: 1 },
  { date: "2026-02-02", employee: "Thomas Brinson", customer: "Landy", hours: 1 },
  { date: "2026-02-02", employee: "Thomas Brinson", customer: "Landy", hours: 1.5 },
  { date: "2026-02-03", employee: "Jason Green", customer: "Landy", hours: 8 },
  { date: "2026-02-03", employee: "Sean Matthew", customer: "Landy", hours: 1 },
  { date: "2026-02-03", employee: "Thomas Brinson", customer: "Landy", hours: 4.5 },
  { date: "2026-02-03", employee: "Thomas Brinson", customer: "Landy", hours: 3 },
];

// Group entries by employee
function groupByEmployee(entries) {
  const groups = {};
  for (const e of entries) {
    if (!groups[e.employee]) groups[e.employee] = [];
    groups[e.employee].push(e);
  }
  return groups;
}

test.describe("Enter Test Entries via UI", () => {
  test("enter all time entries for each employee", async ({ page }) => {
    test.setTimeout(300000); // 5 minutes timeout for all entries

    const entriesByEmployee = groupByEmployee(TEST_ENTRIES);
    const employees = Object.keys(entriesByEmployee);

    console.log(`Will enter entries for ${employees.length} employees: ${employees.join(", ")}`);
    console.log(`Total entries: ${TEST_ENTRIES.length}`);

    for (const employeeName of employees) {
      const entries = entriesByEmployee[employeeName];
      console.log(`\n=== Processing ${employeeName} (${entries.length} entries) ===`);

      // Navigate to app
      await page.goto(BASE + "/app");
      await page.waitForFunction(() => document.querySelectorAll('#employee option').length > 1, { timeout: 15000 });

      // Select the employee by name
      const employeeSelect = page.locator("#employee");
      const options = await employeeSelect.locator("option").allTextContents();
      const matchingOption = options.find(opt => opt.toLowerCase().includes(employeeName.toLowerCase()));
      
      if (!matchingOption) {
        console.log(`WARNING: Employee "${employeeName}" not found in dropdown. Skipping.`);
        continue;
      }

      await employeeSelect.selectOption({ label: matchingOption });
      await page.waitForTimeout(500); // Wait for week to load

      // Verify main card is enabled
      const mainCard = page.locator("#mainCard");
      await expect(mainCard).toHaveCSS("opacity", "1");

      // Enter each entry
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(`  Entry ${i + 1}/${entries.length}: ${entry.date} - ${entry.customer} - ${entry.hours}h`);

        // Select the day
        const daySelect = page.locator("#day");
        await daySelect.selectOption({ value: entry.date });
        await page.waitForTimeout(100);

        // Enter total hours (this is simpler and unlocks the customer field)
        const totalHoursInput = page.locator("#totalHours");
        await totalHoursInput.fill(entry.hours.toString());
        await page.waitForTimeout(100);

        // Now customer should be enabled - enter customer name
        const customerNameInput = page.locator("#customerName");
        await customerNameInput.waitFor({ state: "attached", timeout: 5000 });
        
        // Clear any existing value and type the customer name
        await customerNameInput.fill("");
        await customerNameInput.fill(entry.customer);
        await page.waitForTimeout(300); // Wait for datalist suggestions
        
        // Press Tab or Enter to confirm the customer
        await customerNameInput.press("Tab");
        await page.waitForTimeout(200);

        // Click Save button
        const saveBtn = page.locator("#saveBtn");
        await saveBtn.click();
        await page.waitForTimeout(500); // Wait for save to complete

        // Verify entry was saved by checking entries table
        const entriesTable = page.locator("#entries table");
        if (await entriesTable.isVisible()) {
          const rowCount = await entriesTable.locator("tbody tr").count();
          console.log(`    -> Saved. Total entries in table: ${rowCount}`);
        }
      }

      // Submit the week for this employee
      console.log(`  Submitting week for ${employeeName}...`);
      const submitBtn = page.locator("#submitBtn");
      await submitBtn.click();
      await page.waitForTimeout(1000); // Wait for submit to complete

      console.log(`  ✓ Completed ${employeeName}`);
    }

    console.log("\n=== All entries entered and submitted! ===");
    console.log("Now proceeding to admin approval...");
  });

  test("admin approves all submitted entries", async ({ page }) => {
    test.setTimeout(60000);

    // Navigate to admin
    await page.goto(BASE + "/admin");
    
    // Enter PIN
    const secretInput = page.locator("#secretInput");
    if (await secretInput.isVisible()) {
      await secretInput.fill("7707");
      await page.locator("#secretBtn").click();
      await page.waitForTimeout(500);
    }

    // Wait for admin content to load
    await page.waitForSelector("#adminContent", { state: "visible", timeout: 10000 });

    // Set the week to 2026-01-28
    const weekInput = page.locator("#weekStart");
    if (await weekInput.isVisible()) {
      await weekInput.fill("2026-01-28");
      await page.waitForTimeout(300);
    }

    // Click Load to load approvals
    const loadBtn = page.locator("#loadApprovalsBtn");
    if (await loadBtn.isVisible()) {
      await loadBtn.click();
      await page.waitForTimeout(2000);
    }

    // Check if there are entries to approve
    const approvalsTable = page.locator("#approvalsTable");
    if (await approvalsTable.isVisible()) {
      const rowCount = await approvalsTable.locator("tbody tr").count();
      console.log(`Found ${rowCount} entries pending approval`);

      if (rowCount > 0) {
        // Click "Select All" checkbox if available
        const selectAllCheckbox = page.locator("#selectAllApprovals");
        if (await selectAllCheckbox.isVisible()) {
          await selectAllCheckbox.check();
          await page.waitForTimeout(300);
        } else {
          // Manually check all checkboxes
          const checkboxes = approvalsTable.locator("input[type='checkbox']");
          const count = await checkboxes.count();
          for (let i = 0; i < count; i++) {
            await checkboxes.nth(i).check();
          }
        }

        // Click Approve button
        const approveBtn = page.locator("#approveBtn");
        if (await approveBtn.isVisible()) {
          await approveBtn.click();
          await page.waitForTimeout(2000);
          console.log("✓ Approved all entries");
        }
      }
    } else {
      console.log("No approvals table found - may need to check week setting");
    }

    console.log("\n=== Admin approval complete! ===");
  });
});

// Standalone test just to verify the patch is working
test.describe("Verify Patch Environment", () => {
  test("health check", async ({ request }) => {
    const resp = await request.get(`${BASE}/api/health`);
    expect(resp.ok()).toBe(true);
    const data = await resp.json();
    console.log("Health check:", data);
    expect(data.ok).toBe(true);
  });

  test("employees are available", async ({ request }) => {
    const resp = await request.get(`${BASE}/api/employees`);
    expect(resp.ok()).toBe(true);
    const employees = await resp.json();
    console.log(`Found ${employees.length} employees:`, employees.map(e => e.name));
    expect(employees.length).toBeGreaterThan(0);
    
    // Verify our test employees exist
    const testEmployees = ["Boban Abbate", "Doug Kinsey", "Jason Green", "Sean Matthew", "Thomas Brinson"];
    for (const name of testEmployees) {
      const found = employees.some(e => e.name.toLowerCase().includes(name.toLowerCase()));
      if (!found) {
        console.log(`WARNING: Employee "${name}" not found!`);
      }
    }
  });

  test("customers are available", async ({ request }) => {
    const resp = await request.get(`${BASE}/api/customers`);
    expect(resp.ok()).toBe(true);
    const customers = await resp.json();
    console.log(`Found ${customers.length} customers`);
    
    // Verify our test customers exist
    const testCustomers = ["Behrens", "Boyle", "Gee", "Landy"];
    for (const name of testCustomers) {
      const found = customers.some(c => c.name.toLowerCase().includes(name.toLowerCase()));
      if (!found) {
        console.log(`WARNING: Customer "${name}" not found!`);
      } else {
        console.log(`✓ Customer "${name}" found`);
      }
    }
  });
});

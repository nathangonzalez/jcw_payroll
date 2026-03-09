const { test, expect } = require("@playwright/test");

const WEEK_START = process.env.UAT_WEEK_START || "2026-02-25";
const ADMIN_SECRET = process.env.ADMIN_SECRET_UAT || process.env.ADMIN_SECRET || "demo";
const RUN_UAT = process.env.UAT_DEMO === "1";
const STEP_PAUSE_MS = Number(process.env.UAT_STEP_PAUSE_MS || 2500);

test.use({
  video: "on",
  screenshot: "on",
  trace: "on",
});

async function annotate(page, acId, message) {
  await page.evaluate(
    ({ id, text }) => {
      const elId = "__uat_annotate__";
      const old = document.getElementById(elId);
      if (old) old.remove();
      const el = document.createElement("div");
      el.id = elId;
      el.textContent = `UAT ${id}: ${text}`;
      el.style.position = "fixed";
      el.style.top = "10px";
      el.style.right = "10px";
      el.style.zIndex = "999999";
      el.style.background = "rgba(0,0,0,0.78)";
      el.style.color = "#fff";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "8px";
      el.style.maxWidth = "560px";
      el.style.font = "13px/1.35 Arial, sans-serif";
      el.style.boxShadow = "0 4px 14px rgba(0,0,0,.4)";
      document.body.appendChild(el);
    },
    { id: acId, text: message }
  );
  await page.waitForTimeout(STEP_PAUSE_MS);
}

test.describe("UAT Demo - Weekly Payroll Policy + Weekly Preview", () => {
  test.skip(!RUN_UAT, "Set UAT_DEMO=1 to run this human-review demo.");

  test("weekly payroll excludes admin and weekly report preview is visible", async ({ page }) => {
    test.slow();

    await test.step("Unlock admin", async () => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await page.locator("#secretInput").fill(ADMIN_SECRET);
      await page.locator("#secretBtn").click();
      await expect(page.locator("#adminContent")).toBeVisible();
      await annotate(page, "AC-1", "Admin screen unlocked and ready for payroll UAT.");
      await page.screenshot({ path: "test-results/uat-ac-1-admin-unlocked.png", fullPage: true });
    });

    await test.step("Select payroll week for review", async () => {
      await expect(page.locator("#weekSelect")).toBeVisible();
      const weekOptions = await page.locator("#weekSelect option").allTextContents();
      const selectedWeek = weekOptions.includes(WEEK_START) ? WEEK_START : (weekOptions[0] || WEEK_START);
      await page.selectOption("#weekSelect", selectedWeek);
      await page.locator("#loadWeekBtn").click();
      await annotate(
        page,
        "AC-2",
        `Weekly payroll report is being tested for week ${selectedWeek}.`
      );
      await page.screenshot({ path: "test-results/uat-ac-2-week-selected.png", fullPage: true });
    });

    await test.step("Open weekly All Entries list", async () => {
      await page.locator("#allEntriesBtn").click();
      await expect(page.locator("#allEntries")).toBeVisible();
      await annotate(
        page,
        "AC-3",
        "Weekly data panel is visible (this confirms the weekly report flow is included in the demo)."
      );
      await page.screenshot({ path: "test-results/uat-ac-3-weekly-list.png", fullPage: true });
    });

    await test.step("Print weekly payroll and verify admin names are excluded", async () => {
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator('button:has-text("Print Payroll")').click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      const html = await popup.content();
      expect(html).not.toContain("Chris Jacobi");
      expect(html).not.toContain("Chris Zavesky");
      await annotate(
        popup,
        "AC-4",
        "Weekly payroll print excludes admin-role employees."
      );
      await popup.screenshot({ path: "test-results/uat-ac-4-print-no-admin.png", fullPage: true });
      await popup.close();
    });

    await test.step("Preview weekly report section", async () => {
      await page.locator("#previewMonthBtn").click();
      await expect(page.locator("#reportPreview")).toBeVisible();
      await expect(page.locator("#reportPreview")).toContainText("Week of", { timeout: 20000 });
      await annotate(
        page,
        "AC-5",
        "Preview Report shows weekly summary cards for manager review before approval."
      );
      await page.screenshot({ path: "test-results/uat-ac-5-weekly-preview.png", fullPage: true });
    });
  });
});

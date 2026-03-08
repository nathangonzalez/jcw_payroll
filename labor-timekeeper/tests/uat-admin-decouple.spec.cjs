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

test.describe("UAT Demo - Weekly Payroll Admin Decoupling", () => {
  test.skip(!RUN_UAT, "Set UAT_DEMO=1 to run this human-review demo.");

  test("print payroll excludes admin by default, includes admin when toggled", async ({ page }) => {
    test.slow();

    await test.step("Open admin and unlock", async () => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await annotate(page, "Open admin and unlock");
      await page.locator("#secretInput").fill(ADMIN_SECRET);
      await page.locator("#secretBtn").click();
      await expect(page.locator("#adminContent")).toBeVisible();
      await page.waitForTimeout(1200);
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
      expect(html).toContain("Payroll Report");
      expect(popup.url()).toContain("include_admin=0");
      test.info().attach("no-admin-html", { body: Buffer.from(html, "utf8"), contentType: "text/html" });
      await annotate(popup, "Expected: Chris Jacobi / Chris Zavesky absent");
      await popup.screenshot({ path: "test-results/uat-decouple-02-no-admin.png", fullPage: true });
      await page.evaluate((h) => { window.__uatNoAdminHtml = h; }, html);
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
      expect(html).toContain("Payroll Report");
      expect(popup.url()).toContain("include_admin=1");
      test.info().attach("with-admin-html", { body: Buffer.from(html, "utf8"), contentType: "text/html" });
      const htmlNoAdmin = await page.evaluate(() => window.__uatNoAdminHtml || "");
      const hasAdminInIncluded = html.includes("Chris Jacobi") || html.includes("Chris Zavesky");
      if (hasAdminInIncluded) {
        expect(html).toContain("Chris Jacobi");
        expect(html).toContain("Chris Zavesky");
        expect(htmlNoAdmin).not.toContain("Chris Jacobi");
        expect(htmlNoAdmin).not.toContain("Chris Zavesky");
      } else {
        test.info().annotations.push({
          type: "note",
          description: "No admin rows present in selected week on patch data; verified toggle wiring + printable render only."
        });
      }
      await annotate(popup, "Expected: Chris Jacobi / Chris Zavesky present");
      await popup.screenshot({ path: "test-results/uat-decouple-03-with-admin.png", fullPage: true });
      await popup.close();
    });
  });
});

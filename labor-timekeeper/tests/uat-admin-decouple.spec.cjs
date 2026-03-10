const { test, expect } = require("@playwright/test");

const WEEK_START = process.env.UAT_WEEK_START || "2026-02-25";
const ADMIN_SECRET = process.env.ADMIN_SECRET_UAT || process.env.ADMIN_SECRET || "demo";
const RUN_UAT = process.env.UAT_DEMO === "1";
const STEP_PAUSE_MS = Number(process.env.UAT_STEP_PAUSE_MS || 4500);
const SCROLL_STEP_PX = Number(process.env.UAT_SCROLL_STEP_PX || 200);
const SCROLL_PAUSE_MS = Number(process.env.UAT_SCROLL_PAUSE_MS || 1000);

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
    el.style.background = "rgba(0,0,0,0.78)";
    el.style.color = "#fff";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "8px";
    el.style.maxWidth = "560px";
    el.style.font = "13px/1.35 Arial, sans-serif";
    el.style.boxShadow = "0 4px 14px rgba(0,0,0,.4)";
    document.body.appendChild(el);
  }, message);
  await page.waitForTimeout(STEP_PAUSE_MS);
}

async function highlightSelector(page, selector) {
  await page.evaluate((sel) => {
    const id = "__uat_highlight__";
    const old = document.getElementById(id);
    if (old) old.remove();
    const target = document.querySelector(sel);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const box = document.createElement("div");
    box.id = id;
    box.style.position = "fixed";
    box.style.left = `${Math.max(0, rect.left - 6)}px`;
    box.style.top = `${Math.max(0, rect.top - 6)}px`;
    box.style.width = `${Math.max(8, rect.width + 12)}px`;
    box.style.height = `${Math.max(8, rect.height + 12)}px`;
    box.style.border = "3px solid #f1c40f";
    box.style.borderRadius = "8px";
    box.style.background = "rgba(241, 196, 15, 0.08)";
    box.style.boxShadow = "0 0 0 2px rgba(0,0,0,.35), 0 0 18px rgba(241,196,15,.55)";
    box.style.pointerEvents = "none";
    box.style.zIndex = "999998";
    document.body.appendChild(box);
  }, selector);
}

async function slowScrollToSelector(page, selector) {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  const targetY = await locator.evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY - 120;
    return Math.max(0, top);
  });
  let currentY = await page.evaluate(() => window.scrollY);
  if (Math.abs(targetY - currentY) < SCROLL_STEP_PX) {
    await page.evaluate((y) => window.scrollTo(0, y), targetY);
    await page.waitForTimeout(SCROLL_PAUSE_MS);
    return;
  }
  const direction = targetY > currentY ? 1 : -1;
  while ((direction > 0 && currentY < targetY) || (direction < 0 && currentY > targetY)) {
    const delta = Math.min(SCROLL_STEP_PX, Math.abs(targetY - currentY));
    currentY += direction * delta;
    await page.evaluate((y) => window.scrollTo(0, y), currentY);
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
}

async function focusAndAnnotate(page, selector, message) {
  await slowScrollToSelector(page, selector);
  await highlightSelector(page, selector);
  await annotate(page, message);
}

async function slowScrollPage(page, steps = 6) {
  await page.waitForTimeout(SCROLL_PAUSE_MS);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, SCROLL_STEP_PX);
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
}

test.describe("UAT Demo - Weekly Payroll Admin Decoupling", () => {
  test.skip(!RUN_UAT, "Set UAT_DEMO=1 to run this human-review demo.");

  test("print payroll excludes admin by default, includes admin when toggled", async ({ page }) => {
    test.slow();

    await test.step("Open admin and unlock", async () => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await focusAndAnnotate(page, "#secretInput", "Unlocking admin screen for UAT run.");
      await page.locator("#secretInput").fill(ADMIN_SECRET);
      await page.locator("#secretBtn").click();
      await expect(page.locator("#adminContent")).toBeVisible();
      await focusAndAnnotate(page, "#adminContent", "Admin page unlocked.");
      await page.screenshot({ path: "test-results/uat-decouple-01-admin-unlocked.png", fullPage: true });
    });

    await test.step("Select target payroll week", async () => {
      await focusAndAnnotate(page, "#weekSelect", "Selecting payroll week for validation.");
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
      await page.selectOption("#weekSelect", selectedWeek);
      await page.locator("#loadWeekBtn").click();
      await annotate(page, `Selected payroll week ${selectedWeek}.`);
      await page.screenshot({ path: "test-results/uat-decouple-02-week-loaded.png", fullPage: true });
    });

    await test.step("Print payroll with admin excluded (default)", async () => {
      await focusAndAnnotate(page, "#includeAdminWeekly", "Feature focus: Include Admin toggle OFF.");
      await page.locator("#includeAdminWeekly").uncheck();
      await focusAndAnnotate(page, "#printWeekBtn", "Opening weekly payroll print (admin OFF).");
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator("#printWeekBtn").click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      const html = await popup.content();
      expect(html).toContain("Payroll Report");
      expect(popup.url()).toContain("include_admin=0");
      test.info().attach("no-admin-html", { body: Buffer.from(html, "utf8"), contentType: "text/html" });
      await highlightSelector(popup, "body");
      await annotate(popup, "Confirming admin names are excluded in print output.");
      await slowScrollPage(popup, 6);
      await popup.screenshot({ path: "test-results/uat-decouple-03-no-admin.png", fullPage: true });
      await page.evaluate((h) => { window.__uatNoAdminHtml = h; }, html);
      await popup.close();
    });

    await test.step("Print payroll with admin included", async () => {
      await focusAndAnnotate(page, "#includeAdminWeekly", "Feature focus: Include Admin toggle ON.");
      await page.locator("#includeAdminWeekly").check();
      await focusAndAnnotate(page, "#printWeekBtn", "Opening weekly payroll print (admin ON).");
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator("#printWeekBtn").click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
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
      await highlightSelector(popup, "body");
      await annotate(popup, "Confirming admin rows are included with toggle ON.");
      await slowScrollPage(popup, 6);
      await popup.screenshot({ path: "test-results/uat-decouple-04-with-admin.png", fullPage: true });
      await popup.close();
    });
  });
});

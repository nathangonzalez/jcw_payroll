const { test } = require('@playwright/test');

test('debug dropdown stacking on page', async ({ page, baseURL }) => {
  await page.goto(baseURL || 'http://localhost:3000');

  // wait for employee select to load
  const sel = await page.waitForSelector('#employee');

  // ensure options exist
  const options = await page.$$eval('#employee option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));

  const rect = await sel.boundingBox();

  // pick a point near the center of the select
  const cx = Math.round(rect.x + rect.width / 2);
  const cy = Math.round(rect.y + rect.height / 2);

  const info = await page.evaluate(({ cx, cy }) => {
    const sel = document.getElementById('employee');
    const cs = window.getComputedStyle(sel);
    const elems = document.elementsFromPoint(cx, cy).slice(0,5).map(e => ({ tag: e.tagName, id: e.id || null, class: e.className || null }));
    return { computedStyle: { zIndex: cs.zIndex, position: cs.position, pointerEvents: cs.pointerEvents }, elementsAtPoint: elems };
  }, { cx, cy });

  console.log('DEBUG_DROPDOWN_OPTIONS=' + JSON.stringify(options));
  console.log('DEBUG_DROPDOWN_INFO=' + JSON.stringify(info));
});

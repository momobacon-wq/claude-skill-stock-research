// stock-research Step 0.5: delete ALL existing 財報狗 sources from the open notebook.
//
// Run this when the notebook's 財報狗 data is stale, BEFORE uploading the freshly-scraped
// .md (delete-then-reupload keeps the notebook with exactly one current 財報狗 source).
//
// Usage (notebook OPEN — switches to 來源 tab itself):
//   mcp__playwright__browser_run_code_unsafe filename=<this file>
//   → returns { attempted, deleted, log }
//
// Deletion sequence per source: 更多(more) → 移除來源 menuitem → 刪除 dialog button
// (same stable DOM path as dedup-sources.js).
async (page) => {
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tab = [...document.querySelectorAll('[role=tab],button')].find(b => /^來源$/.test((b.textContent || '').trim()));
    if (tab) tab.click();
    await sleep(2500);
  });
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.single-source-container')].map(c => {
      const moreBtn = c.querySelector('[id^="source-item-more-button-"]');
      const titleBtn = c.querySelector('button:not([id^="source-item-more-button-"])');
      const title = titleBtn ? titleBtn.getAttribute('aria-label') : '';
      return { id: moreBtn ? moreBtn.id.replace('source-item-more-button-', '') : null, title };
    // ONLY our uploaded files (end in 財報狗.md / 財報狗_YYYY-MM.md / 財報狗AI解讀_YYYY-MM.md)
    // — never the Deep-Research statementdog news pages (contain "財報狗" but don't end in ".md").
    }).filter(s => s.id && /財報狗(AI解讀)?(_\d{4}-\d{2})?\.md$/.test(s.title)).map(s => s.id)
  );
  const log = [];
  let consecutiveFailures = 0;
  for (const id of ids) {
    try {
      await page.locator(`#source-item-more-button-${id}`).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: '移除來源' }).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '刪除', exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(700);
      log.push({ id, ok: true });
      consecutiveFailures = 0;
    } catch (e) {
      log.push({ id, ok: false, err: e.message?.slice(0, 100) });
      if (++consecutiveFailures >= 3) break;
    }
  }
  return { attempted: ids.length, deleted: log.filter(l => l.ok).length, log };
}

// stock-research Step 0.5: audit an existing notebook's sources to decide what work to skip.
//
// Usage (notebook must be OPEN, any tab — this script switches to the 來源 tab itself):
//   mcp__playwright__browser_run_code_unsafe filename=<this file>
//   → returns {
//        total,                       // total source count
//        financialSources:[{id,title,period}],  // 財報狗 sources + parsed 資料月份 (YYYY-MM or null)
//        latestFinancialPeriod,       // newest period among financial sources (string or null)
//        otherSourceCount,            // non-財報狗 sources
//        hasDeepResearch              // heuristic: otherSourceCount >= 5  → Deep Research already run
//      }
//
// Decision rules for the caller:
//   - 財報狗 stale?  compare latestFinancialPeriod with statementdog's current latest month
//                    (read cheaply from the monthly-revenue page <title>, e.g. "2026年4月").
//                    If latestFinancialPeriod is null or < current → (re)scrape + upload + delete old.
//   - Deep Research? if hasDeepResearch → SKIP all 8 batches; else run them.
async (page) => {
  // ensure the 來源 (sources) tab is active so .single-source-container rows are in the DOM
  await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tab = [...document.querySelectorAll('[role=tab],button')].find(b => /^來源$/.test((b.textContent || '').trim()));
    if (tab) tab.click();
    await sleep(2500);
  });
  return await page.evaluate(() => {
    const sources = [...document.querySelectorAll('.single-source-container')].map(c => {
      const moreBtn = c.querySelector('[id^="source-item-more-button-"]');
      const titleBtn = c.querySelector('button:not([id^="source-item-more-button-"])');
      const title = titleBtn ? titleBtn.getAttribute('aria-label') : '';
      const id = moreBtn ? moreBtn.id.replace('source-item-more-button-', '') : null;
      return { id, title };
    }).filter(s => s.id && s.title);

    // IMPORTANT: match only OUR uploaded files (title ends in 財報狗.md / 財報狗_YYYY-MM.md /
    // 財報狗AI解讀_YYYY-MM.md). Deep-Research-crawled statementdog NEWS pages also contain
    // "財報狗" in their title but do NOT end in ".md" — they must NOT be treated as our source
    // (or delete would nuke them).
    const isOurFinancial = t => /財報狗(AI解讀)?(_\d{4}-\d{2})?\.md$/.test(t);
    const financialSources = sources.filter(s => isOurFinancial(s.title)).map(s => {
      const m = s.title.match(/財報狗(?:AI解讀)?_(\d{4})-(\d{2})\.md$/);
      return { ...s, period: m ? `${m[1]}-${m[2]}` : null };
    });
    const periods = financialSources.map(s => s.period).filter(Boolean).sort();
    const latestFinancialPeriod = periods.length ? periods[periods.length - 1] : null;
    const otherSourceCount = sources.filter(s => !isOurFinancial(s.title)).length;

    return {
      total: sources.length,
      financialSources,
      latestFinancialPeriod,
      otherSourceCount,
      hasDeepResearch: otherSourceCount >= 5,
    };
  });
}

// stock-research dedup script
//
// Usage: paste the body (the async (page) => { ... } function) into
// mcp__playwright__browser_run_code_unsafe `code` argument.
//
// What it does:
// 1. Reads all NotebookLM source rows' aria-label titles + UUIDs
// 2. Groups by title — for each group with >1 copies, keeps first UUID, deletes rest
// 3. Also handles "truncated-vs-full" hidden duplicates (e.g.
//    "從鞋墊...供應 ..." matches "從鞋墊...供應鏈 - 今周刊")
// 4. For each ID to delete: clicks 更多 button → 移除來源 menuitem → 刪除 dialog button
// 5. Returns { summary: {totalSources, duplicateGroups, deleted}, finalSourceCount }
//
// Tunables:
// - per-delete waits are 300/300/700 ms — tested stable. If you see failures, raise.
// - script gives up after 3 consecutive failures (likely UI changed).

async (page) => {
  // 1. Collect exact-match duplicates (skip first per title)
  const exactDups = await page.evaluate(() => {
    const containers = document.querySelectorAll('.single-source-container');
    const titleToIds = {};
    const seen = new Set();
    containers.forEach(c => {
      const moreBtn = c.querySelector('[id^="source-item-more-button-"]');
      const titleBtn = c.querySelector('button:not([id^="source-item-more-button-"])');
      const title = titleBtn?.getAttribute('aria-label');
      if (!title || !moreBtn) return;
      const uuid = moreBtn.id.replace('source-item-more-button-', '');
      if (seen.has(uuid)) return;
      seen.add(uuid);
      if (!titleToIds[title]) titleToIds[title] = [];
      titleToIds[title].push(uuid);
    });
    const dupIds = [];
    const dupGroups = {};
    for (const [t, ids] of Object.entries(titleToIds)) {
      if (ids.length > 1) {
        dupGroups[t.slice(0, 60)] = ids.length;
        dupIds.push(...ids.slice(1).map(id => ({title: t.slice(0, 50), id})));
      }
    }
    return { dupIds, dupGroups, totalSources: seen.size };
  });

  // 2. Delete exact-match dups
  const exactLog = [];
  let consecutiveFailures = 0;
  for (const {title, id} of exactDups.dupIds) {
    try {
      await page.locator(`#source-item-more-button-${id}`).click({timeout: 5000});
      await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: '移除來源' }).click({timeout: 5000});
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '刪除', exact: true }).click({timeout: 5000});
      await page.waitForTimeout(700);
      exactLog.push({ok: true, title});
      consecutiveFailures = 0;
    } catch(e) {
      consecutiveFailures++;
      exactLog.push({ok: false, title, id, err: e.message?.slice(0, 100)});
      if (consecutiveFailures >= 3) break;
    }
  }

  // 3. Find truncated-vs-full hidden duplicates
  const truncDups = await page.evaluate(() => {
    const containers = document.querySelectorAll('.single-source-container');
    const titleToId = {};
    const seen = new Set();
    containers.forEach(c => {
      const moreBtn = c.querySelector('[id^="source-item-more-button-"]');
      const titleBtn = c.querySelector('button:not([id^="source-item-more-button-"])');
      const title = titleBtn?.getAttribute('aria-label');
      if (!title || !moreBtn) return;
      const uuid = moreBtn.id.replace('source-item-more-button-', '');
      if (seen.has(uuid)) return;
      seen.add(uuid);
      if (!titleToId[title]) titleToId[title] = uuid;
    });
    const allTitles = Object.keys(titleToId);
    const pairs = [];
    for (const t of allTitles) {
      if (!t.endsWith(' ...') && !t.endsWith('...')) continue;
      const stem = t.replace(/\s*\.\.\.$/, '').slice(0, Math.max(20, t.length - 8));
      for (const u of allTitles) {
        if (u === t) continue;
        if (u.startsWith(stem) && u.length > t.length) {
          // truncated has a full counterpart — delete the truncated
          pairs.push({truncatedId: titleToId[t], full: u.slice(0, 50), truncated: t.slice(0, 50)});
          break;
        }
      }
    }
    return pairs;
  });

  // 4. Delete truncated-vs-full dups
  const truncLog = [];
  consecutiveFailures = 0;
  for (const p of truncDups) {
    try {
      await page.locator(`#source-item-more-button-${p.truncatedId}`).click({timeout: 5000});
      await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: '移除來源' }).click({timeout: 5000});
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '刪除', exact: true }).click({timeout: 5000});
      await page.waitForTimeout(700);
      truncLog.push({ok: true, truncated: p.truncated, full: p.full});
      consecutiveFailures = 0;
    } catch(e) {
      consecutiveFailures++;
      truncLog.push({ok: false, ...p, err: e.message?.slice(0, 100)});
      if (consecutiveFailures >= 3) break;
    }
  }

  // 5. Final count
  const finalSourceCount = await page.evaluate(() => {
    const containers = document.querySelectorAll('.single-source-container');
    const ids = new Set();
    containers.forEach(c => {
      const moreBtn = c.querySelector('[id^="source-item-more-button-"]');
      if (moreBtn) ids.add(moreBtn.id);
    });
    return ids.size;
  });

  return {
    summary: {
      initialSources: exactDups.totalSources,
      duplicateGroups: Object.keys(exactDups.dupGroups).length,
      exactDupsDeleted: exactLog.filter(l => l.ok).length,
      truncatedDupsDeleted: truncLog.filter(l => l.ok).length,
      totalDeleted: exactLog.filter(l => l.ok).length + truncLog.filter(l => l.ok).length,
      finalSourceCount
    },
    dupGroups: exactDups.dupGroups,
    truncatedPairs: truncDups,
    failures: [...exactLog, ...truncLog].filter(l => !l.ok)
  };
}

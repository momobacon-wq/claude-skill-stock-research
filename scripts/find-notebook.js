// stock-research Step 0.5: list all NotebookLM notebooks (title + id) so the caller can
// match an existing notebook for this stock by code/name.
//
// Usage:
//   1. mcp__playwright__browser_navigate → https://notebooklm.google.com/
//   2. mcp__playwright__browser_run_code_unsafe filename=<this file>
//      → returns { notebooks:[{id, title}], count }
//
// Then the caller matches title against the stock code (e.g. "1514") or name (e.g. "亞力").
// If a match exists → open https://notebooklm.google.com/notebook/<id> and run the
// source audit (notebook-source-audit.js). If none → create a new notebook (Step 1).
async (page) => {
  // give the home grid a moment to render (lazy-loaded)
  await page.waitForTimeout(2500);
  const notebooks = await page.evaluate(() => {
    // The title (.project-button-title) is NOT inside the notebook <a> — they are separate
    // elements in a card. For each title, walk up to the closest ancestor that contains a
    // /notebook/<uuid> anchor and pair them.
    const out = [];
    document.querySelectorAll('.project-button-title').forEach(tEl => {
      const title = (tEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title) return;
      let el = tEl, id = null;
      for (let i = 0; i < 6 && el; i++) {
        const a = el.querySelector && el.querySelector('a[href*="/notebook/"]');
        if (a) { const m = (a.getAttribute('href') || '').match(/\/notebook\/([0-9a-fA-F-]{36})/); if (m) { id = m[1]; break; } }
        el = el.parentElement;
      }
      if (id) out.push({ id, title });
    });
    const seen = new Set();
    return out.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });
  });
  return { notebooks, count: notebooks.length, note: '只列出首頁已載入(精選+最近)的筆記本;若目標股票不在其中視為無、走新建流程。' };
}

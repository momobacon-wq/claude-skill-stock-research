// stock-research Step 1.6: ask statementdog's built-in AI assistant to interpret
// each key indicator page, and collect the answers into one Markdown document.
//
// NOTE: statementdog only ships the AI chat entrypoint on SOME indicator pages
// (2026-07 實測 8932: income-statement / cash-flow-statement / roe-roa / turnover-days /
// financial-structure-ratio / monthly-revenue-growth-rate / pb / product-revenue 等有;
// monthly-revenue / eps / profit-margin / pe / broker-trading 沒有). Pages without an
// entrypoint are marked `skipped` (NOT a failure) and excluded from `remaining`.
//
// For each candidate page it clicks the inline suggestion 「幫我分析這個數據」, waits for
// streaming to finish (「停止」 button appears then disappears + answer length stabilizes),
// then serializes the answer HTML → Markdown deterministically (no LLM re-typing).
//
// RESUMABLE / BATCHED: one invocation processes pages until ~200s elapsed, then stops
// and returns { remaining:[...] }. State accumulates in statementdog-origin
// localStorage['__SD_AI']. Just re-run this script until remaining is empty —
// on the final run it builds the full Markdown into localStorage['__SD_AI_MD'].
//
//   STEP 1 (must be logged in to statementdog):
//     mcp__playwright__browser_navigate → https://statementdog.com/analysis/<code>/monthly-revenue
//   STEP 2 (repeat until remaining:[] — each run continues where the last stopped):
//     mcp__playwright__browser_run_code_unsafe filename=<this file>
//       → { code, done:[{page,ok,chars|err}], okTotal, skipped, remaining, mdStored }
//   STEP 3 (dump final markdown to home dir):
//     mcp__playwright__browser_evaluate
//       function: () => localStorage.getItem('__SD_AI_MD')
//       filename: sd_ai_<code>.md
//   STEP 4: move/rename to ~/statementdog_work/<code>/<name>_<code>_財報狗AI解讀_<YYYY-MM>.md
//           (<YYYY-MM> = 財報狗最新月營收月份，同主檔的新鮮度標記)
//
// To restart from scratch (e.g. new month):
//     browser_evaluate → () => { localStorage.removeItem('__SD_AI'); localStorage.removeItem('__SD_AI_MD'); }
async (page) => {
  const code = (page.url().match(/statementdog\.com\/analysis\/([A-Za-z0-9]+)/) || [])[1];
  if (!code) throw new Error('先 navigate 到 https://statementdog.com/analysis/<code>/monthly-revenue 再跑此腳本');
  const base = 'https://statementdog.com/analysis/' + code;
  const T0 = Date.now();
  const TIME_BUDGET_MS = 200000;   // stop starting new pages after this; caller re-runs
  const ANSWER_TIMEOUT_MS = 150000;

  // candidate pages (only those where statementdog actually offers AI chat will run;
  // the rest get skipped automatically)
  const PAGES = [
    ['income-statement', '損益表'],
    ['cash-flow-statement', '現金流量表'],
    ['operating-expense-ratio', '營業費用率'],
    ['roe-roa', 'ROE / ROA'],
    ['turnover-days', '營運週轉天數'],
    ['financial-structure-ratio', '財務結構與安全性'],
    ['monthly-revenue-growth-rate', '營收成長率'],
    ['pb', '股價淨值比評價'],
    ['product-revenue', '產品組合'],
  ];

  // ---- load accumulated state ----
  const state = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('__SD_AI') || 'null'); } catch (e) { return null; }
  }) || { code, items: [] };
  if (state.code !== code) { state.code = code; state.items = []; }  // switched stock → reset
  const settled = new Set(state.items.filter(i => i.ok || i.skipped).map(i => i.path));
  const persist = () => page.evaluate(s => localStorage.setItem('__SD_AI', s), JSON.stringify(state));

  const results = [];
  let consecutiveFail = 0;

  for (const [path, name] of PAGES) {
    if (settled.has(path)) continue;
    if (Date.now() - T0 > TIME_BUDGET_MS) break;
    if (consecutiveFail >= 2) break; // 2 pages fired-but-no-answer → likely AI quota / not logged in

    await page.goto(base + '/' + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // 1) fire the question via the inline suggestion (retry once — it renders late on slow pages)
    const clickSuggestion = () => page.evaluate(() => {
      const sugg = [...document.querySelectorAll('li p')].find(e => (e.textContent || '').trim() === '幫我分析這個數據');
      if (sugg) { (sugg.closest('li') || sugg).click(); return true; }
      return false;
    });
    let fired = await clickSuggestion();
    if (!fired) { await page.waitForTimeout(4000); fired = await clickSuggestion(); }
    if (!fired) {
      // this page simply doesn't have the AI feature → permanent skip, not a failure
      state.items = state.items.filter(i => i.path !== path);
      state.items.push({ path, name, ok: false, skipped: true });
      results.push({ page: name, path, ok: false, err: 'no-ai-on-page(skipped)' });
      await persist();
      continue;
    }

    // 2) wait for the answer to finish streaming.
    // Two UI variants exist: (a) a 「停止」 button shows while streaming (turnover-days
    // style), (b) no stop button at all — the answer article just grows then stalls
    // (income-statement style). So completion = answer length > 100, unchanged for
    // 3 consecutive 2s polls, AND no 停止 button present. Bail early if no answer
    // article ever appears (quota exhausted / not logged in).
    const tQ = Date.now();
    let stableLen = -1, stableCnt = 0, finished = false, everSeen = false;
    while (Date.now() - tQ < ANSWER_TIMEOUT_MS) {
      const st = await page.evaluate(() => {
        const arts = document.querySelectorAll('article');
        const last = arts[arts.length - 1];
        const stop = [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === '停止');
        return { len: last ? last.innerText.length : 0, stop };
      });
      if (st.len > 100) everSeen = true;
      if (!everSeen && Date.now() - tQ > 45000) break; // nothing ever streamed → give up early
      if (everSeen && !st.stop) {
        if (st.len === stableLen && ++stableCnt >= 3) { finished = true; break; }
        if (st.len !== stableLen) { stableLen = st.len; stableCnt = 0; }
      }
      await page.waitForTimeout(2000);
    }
    if (!finished && stableLen < 200) {
      results.push({ page: name, path, ok: false, err: everSeen ? 'stream-timeout' : 'no-answer(quota/未登入?)' });
      consecutiveFail++; continue;
    }

    // 3) serialize the last answer article → Markdown (+ best-effort reference links)
    const md = await page.evaluate(() => {
      const walk = (node) => {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        const kids = () => [...node.childNodes].map(walk).join('');
        switch (node.tagName) {
          case 'H1': case 'H2': return '\n### ' + kids().trim() + '\n\n';
          case 'H3': return '\n#### ' + kids().trim() + '\n\n';
          case 'H4': return '\n##### ' + kids().trim() + '\n\n';
          case 'P': return kids().trim() + '\n\n';
          case 'STRONG': case 'B': return '**' + kids() + '**';
          case 'EM': case 'I': return '*' + kids() + '*';
          case 'CODE': return '`' + kids() + '`';
          case 'HR': return '\n---\n\n';
          case 'BR': return '\n';
          case 'LI': return '- ' + kids().trim().replace(/\n{2,}/g, '\n  ') + '\n';
          case 'UL': case 'OL': return kids() + '\n';
          case 'TABLE': {
            const rows = [...node.querySelectorAll('tr')].map(tr => '| ' + [...tr.querySelectorAll('th,td')].map(c => c.textContent.trim().replace(/\|/g, '/')).join(' | ') + ' |');
            if (rows.length > 1) rows.splice(1, 0, '|' + ' --- |'.repeat((rows[0].match(/\|/g) || []).length - 1));
            return '\n' + rows.join('\n') + '\n\n';
          }
          default: return kids();
        }
      };
      const arts = document.querySelectorAll('article');
      const last = arts[arts.length - 1];
      if (!last) return null;
      let out = walk(last).replace(/\n{3,}/g, '\n\n').trim();
      const holder = last.closest('li');
      if (holder) {
        const links = [...new Map([...holder.querySelectorAll('a[href^="http"]')]
          .map(a => [a.href, (a.textContent || '').trim()])).entries()]
          .filter(([h, t]) => t.length > 3).slice(0, 10);
        if (links.length) out += '\n\n**AI 引用的參考連結**: ' + links.map(([h, t]) => `[${t}](${h})`).join('、');
      }
      return out;
    });
    if (!md || md.length < 200) {
      results.push({ page: name, path, ok: false, err: 'extract-empty' });
      consecutiveFail++; continue;
    }
    consecutiveFail = 0;
    state.items = state.items.filter(i => i.path !== path);
    state.items.push({ path, name, ok: true, md });
    results.push({ page: name, path, ok: true, chars: md.length });
    await persist(); // per page, so a timeout mid-run loses nothing
  }

  // ---- build final markdown when every page is settled (answered or skipped) ----
  const okItems = state.items.filter(i => i.ok);
  const okPaths = new Set(okItems.map(i => i.path));
  const skipped = state.items.filter(i => i.skipped).map(i => i.path);
  const remaining = PAGES.filter(([p]) => !okPaths.has(p) && !skipped.includes(p)).map(([p]) => p);
  let mdStored = false;
  if ((remaining.length === 0 || consecutiveFail >= 2) && okItems.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const order = PAGES.map(([p]) => p);
    const parts = okItems.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
    const doc = [
      `# ${code} 財報狗 AI 個股解讀`,
      '',
      `> 本文件由財報狗 (statementdog.com) 網站內建 AI 助手對各指標頁自動生成（逐頁點「幫我分析這個數據」），屬 **AI 分析觀點**，非原始財務數據；精確數字請以同筆記本的財報狗主檔 .md 為準。抓取日期：${today}。涵蓋 ${parts.length} 個指標頁。`,
      '',
      ...parts.map(i => `## ${i.name}（${i.path}）\n\n${i.md}\n`),
    ].join('\n');
    await page.evaluate(s => localStorage.setItem('__SD_AI_MD', s), doc);
    mdStored = true;
  }

  return {
    code,
    done: results,
    okTotal: okPaths.size,
    skipped,
    remaining,
    mdStored,
    note: mdStored
      ? '完成。用 browser_evaluate (() => localStorage.getItem("__SD_AI_MD"), filename: sd_ai_' + code + '.md) dump 後改名上傳'
      : (remaining.length ? '還有 remaining 頁未完成 — 直接再跑一次本腳本會從斷點續跑' : '全部頁面都沒有 AI 入口或失敗 — 檢查登入狀態'),
  };
}

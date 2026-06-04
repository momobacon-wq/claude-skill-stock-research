// stock-research: scrape ALL of a stock's 財報狗 (statementdog) analysis data in ONE call.
//
// The run_code_unsafe sandbox has NO `require`/fs, so this script stores the full
// result into the statementdog-origin localStorage key `__SD`, and returns only a
// small summary. You then dump it to disk with a follow-up browser_evaluate:
//
//   STEP 1 (login first, paid acct = full history):
//     mcp__playwright__browser_navigate → https://statementdog.com/analysis/<code>/monthly-revenue
//   STEP 2 (this script):
//     mcp__playwright__browser_run_code_unsafe filename=<this file>
//       → returns { code, sections:[{section,tabCount}], stored:true }
//   STEP 3 (dump localStorage → file in home dir, e.g. sd_<code>.json):
//     mcp__playwright__browser_evaluate
//       function: () => localStorage.getItem('__SD')
//       filename: sd_<code>.json
//   STEP 4 (build master Markdown):
//     node ~/.claude/skills/stock-research/scripts/convert-statementdog.js <code> "<name>" <path-to-sd_<code>.json>
//
// Handles both <table> pages and the <div>-grid "詳細數據" pages (e.g. 股利政策),
// clicking through every  li.sub-menu-list-item-link  指標子分頁 per section.
async (page) => {
  const code = (page.url().match(/statementdog\.com\/analysis\/([A-Za-z0-9]+)/) || [])[1];
  if (!code) throw new Error('先 navigate 到 https://statementdog.com/analysis/<code>/monthly-revenue 再跑此腳本');
  const base = 'https://statementdog.com/analysis/' + code;

  const DATA = [
    ['monthly-revenue', '財務報表'],
    ['profit-margin', '獲利能力'],
    ['financial-structure-ratio', '安全性分析'],
    ['monthly-revenue-growth-rate', '成長力分析'],
    ['pe', '價值評估'],
    ['broker-trading', '董監與籌碼'],
    ['long-term-and-short-term-monthly-revenue-yoy', '關鍵指標'],
    ['product-revenue', '產品組合'],
  ];

  const dataExtractor = async (sectionName) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const readData = () => {
      let tables = [...document.querySelectorAll('table')].map(t =>
        [...t.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(c => c.textContent.trim()))
      ).filter(r => r.length && r.some(x => x.join('').length));
      if (tables.length) return { mode: 'table', data: tables };
      let best = null;
      for (const parent of document.querySelectorAll('div,ul,section')) {
        const kids = [...parent.children]; if (kids.length < 4) continue;
        const rows = kids.map(k => [...k.children].filter(c => c.children.length === 0).map(c => c.textContent.trim()));
        const counts = {}; rows.forEach(r => counts[r.length] = (counts[r.length] || 0) + 1);
        const mode = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (mode >= 3 && counts[mode] >= 4) { const clean = rows.filter(r => r.length === mode); if (!best || clean.length > best.length) best = clean; }
      }
      return best ? { mode: 'grid', data: [best] } : { mode: 'none', data: [] };
    };
    const doOne = async (name) => {
      let r = readData();
      if (!(r.data.length && r.data[0].length > 1)) {
        const tog = [...document.querySelectorAll('li,button,span,div')].find(e => { const t = (e.textContent || '').trim(); return (t === '詳細數據' || t === '個股數據') && e.tagName !== 'A' && !e.closest('nav') && e.children.length <= 1; });
        if (tog) { tog.click(); await sleep(800); }
      }
      for (let i = 0; i < 8; i++) { await sleep(300); r = readData(); if (r.data.length && r.data[0].length > 1) break; }
      return { name, mode: r.mode, table: r.data[0] || [], extraTables: r.data.slice(1) };
    };
    const tabsEls = [...document.querySelectorAll('.sub-menu-list-item-link')].filter(li => { const t = (li.textContent || '').trim(); return t && t !== '電子書' && !/^\?|解讀|為何|怎麼走|主因/.test(t); });
    const result = [];
    if (tabsEls.length === 0) { result.push(await doOne('(default)')); }
    else { for (const li of tabsEls) { const name = (li.textContent || '').trim().replace(/\s+/g, ' '); li.click(); await sleep(500); result.push(await doOne(name)); } }
    return { kind: 'data', section: sectionName, url: location.pathname, tabCount: result.length, tabs: result };
  };

  const all = [];
  const summary = [];
  for (const [urlPath, name] of DATA) {
    await page.goto(base + '/' + urlPath, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const d = await page.evaluate(dataExtractor, name);
    all.push(d); summary.push({ section: name, tabCount: d.tabCount });
  }

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const overview = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button,a,span,div')].filter(e => /查看其他.*投資(亮點|風險)/.test((e.textContent || '').trim()) && e.children.length <= 1).forEach(e => e.click());
    await sleep(600);
    const items = [...new Set([...document.querySelectorAll('li')].map(li => (li.textContent || '').trim().replace(/\s+/g, ' ')).filter(t => /(漲幅比其他股票|跌幅|未來 90 天|連續|新高|低於|高於|成長|下滑|歷史)/.test(t) && t.length < 80))];
    const summaryTable = [...document.querySelectorAll('table')].map(t => [...t.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(c => c.textContent.trim())));
    const themes = [...new Set([...document.querySelectorAll('a[href*="/tags/"]')].map(a => (a.textContent || '').trim()).filter(Boolean))].slice(0, 40);
    const news = [...new Set([...document.querySelectorAll('a[href*="/news/"]')].map(a => (a.textContent || '').trim()).filter(t => t.length > 8))].slice(0, 15);
    return { kind: 'overview', items, summaryTable, themes, news };
  });
  all.push(overview); summary.push({ section: '最新動態', tabCount: overview.items.length });

  await page.goto(base + '/stock-health-check', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const health = await page.evaluate(() => {
    const txt = document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText;
    const itemsSample = [...new Set([...document.querySelectorAll('li,div,section')].map(e => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter(t => /(體質|地雷|營運|獲利|安全|成長|現金|穩定|本業|財務|是否|通過|警示|健康|偏弱|良好|危險)/.test(t) && t.length > 6 && t.length < 120))].slice(0, 40);
    return { kind: 'health', textLen: txt.length, text: txt.slice(0, 9000), itemsSample };
  });
  all.push(health); summary.push({ section: '股票健診', tabCount: (health.itemsSample || []).length });

  // store full payload into statementdog-origin localStorage (we are on statementdog now)
  await page.evaluate(s => localStorage.setItem('__SD', s), JSON.stringify({ code, sections: all }));
  return { code, sections: summary, stored: true, note: 'tabCount 多為 0 → 多半未登入/非台股；登入付費帳號可解鎖完整歷史。接著用 browser_evaluate dump localStorage[__SD] 到 sd_' + code + '.json' };
}

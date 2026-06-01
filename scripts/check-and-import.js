// stock-research: check Deep Research status, and import if ready — in ONE call.
//
// Usage: mcp__playwright__browser_run_code_unsafe filename=<this file>
//   (no arguments; reads the live page)
//
// Why this exists:
//   The old flow was snapshot → grep "已完成" → find 匯入 ref → click — many
//   tool calls per batch, and the manual import click kept getting fumbled,
//   so the run appeared to "stall at import". This collapses check + import
//   into one deterministic JS call using stable text/DOM, no aria refs.
//
// Returns one of:
//   { done:false, progress:"已完成 3/5 步驟" }            ← still running, sleep & re-run
//   { done:true, imported:true,  sources:27 }             ← imported OK
//   { done:true, imported:false, sources:27, err:"..." }  ← banner shown but click failed; retry
async (page) => {
  const state = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    const done = /Deep Research 已完成/.test(txt);
    const srcM = txt.match(/發現\s*(\d+)\s*個來源/);
    const stepM = txt.match(/已完成\s*(\d+)\s*個步驟\s*\(共\s*(\d+)\s*個\)/);
    let progress = 'unknown';
    if (/規劃中/.test(txt)) progress = '規劃中';
    else if (stepM) progress = `已完成 ${stepM[1]}/${stepM[2]} 步驟`;
    else if (/正在分析結果/.test(txt)) progress = '正在分析結果';
    else if (/正在研究網站|正在載入來源|正在探索/.test(txt)) progress = '正在研究網站';
    return { done, sources: srcM ? Number(srcM[1]) : null, progress };
  });

  if (!state.done) return { done: false, progress: state.progress };

  // Completion banner is up — click 匯入, with retries (this is the step that used to fail)
  let imported = false, err = null;
  for (let i = 0; i < 4 && !imported; i++) {
    try {
      await page.getByRole('button', { name: '匯入' }).first().click({ timeout: 5000 });
      imported = true;
    } catch (e) {
      err = e.message?.slice(0, 120);
      await page.waitForTimeout(900);
    }
  }
  await page.waitForTimeout(1500); // let import settle so the input box re-enables
  return { done: true, imported, sources: state.sources, err };
}

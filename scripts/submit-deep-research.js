// stock-research: ensure Deep Research mode, then submit the query — in ONE call.
//
// Usage:
//   1. First type the batch prompt with mcp__playwright__browser_type into the
//      textbox "根據輸入的查詢內容，探索來源" (the big prompt stays a normal type call —
//      embedding it in JS would be escaping-hell).
//   2. Then run THIS script via mcp__playwright__browser_run_code_unsafe filename=<this file>.
//
// Why this exists:
//   Replaces the fragile snapshot → grep "Fast/Deep Research" → click mode →
//   snapshot → grep "提交" → click sequence with one deterministic call.
//   Handles the "mode resets to Fast Research after batch 1" trap automatically.
//
// Returns: { switchedToDeep:bool, submitted:bool, err:string|null }
async (page) => {
  let switchedToDeep = false;
  // The mode button's label IS the current mode. If it says Fast, switch to Deep.
  try {
    const modeBtn = page.getByRole('button', { name: /^(Fast|Deep) Research$/ }).first();
    // NOTE: innerText includes a leading icon ligature (e.g. "search_spark Fast Research
    // keyboard_arrow_down"), so startsWith('Fast') NEVER matches. Detect by substring instead:
    // switch only when the label contains "Fast Research" and NOT "Deep Research".
    const label = (await modeBtn.innerText({ timeout: 3000 })).replace(/\s+/g, ' ').trim();
    if (label.includes('Fast Research') && !label.includes('Deep Research')) {
      await modeBtn.click({ timeout: 5000 });
      await page.waitForTimeout(450);
      try {
        await page.getByRole('menuitem', { name: 'Deep Research 深度報告和結果' }).click({ timeout: 5000 });
      } catch (e) {
        await page.getByRole('menuitem', { name: /Deep Research/ }).first().click({ timeout: 5000 });
      }
      await page.waitForTimeout(450);
      switchedToDeep = true;
    }
  } catch (e) { /* mode control may differ; submit anyway and let caller verify */ }

  // Submit (scoped to the discovery query box to avoid the other disabled 提交 button)
  let submitted = false, err = null;
  for (let i = 0; i < 3 && !submitted; i++) {
    try {
      await page.locator('source-discovery-query-box')
        .getByRole('button', { name: '提交' }).click({ timeout: 5000 });
      submitted = true;
    } catch (e) {
      err = e.message?.slice(0, 120);
      await page.waitForTimeout(700);
    }
  }
  return { switchedToDeep, submitted, err };
}

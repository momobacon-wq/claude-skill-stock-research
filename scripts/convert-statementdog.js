// stock-research: deterministically convert scraped 財報狗 data → one master Markdown.
//
// Usage:  node convert-statementdog.js <code> "<公司名>" <path-to-sd_<code>.json>
//   <sd json> is the localStorage[__SD] dump produced after scrape-statementdog.js
//   (an object { code, sections:[ {kind:'data'|'overview'|'health', ...}, ... ] }).
//   The dump may be a JSON string OR a double-encoded string (localStorage.getItem) —
//   both are handled.
//   writes ~/statementdog_work/<code>/<name>_<code>_財報狗.md
//
// Numbers are copied VERBATIM (never re-typed by an LLM). Wide time-series tables
// (cols > rows) are transposed so periods become rows → readable + NotebookLM-friendly.
const fs = require('fs');
const path = require('path');
const os = require('os');

const code = process.argv[2];
const name = process.argv[3] || code;
const jsonPath = process.argv[4];
if (!code || !jsonPath) { console.error('usage: node convert-statementdog.js <code> "<name>" <sd_json_path>'); process.exit(1); }

let raw = fs.readFileSync(jsonPath, 'utf8').trim();
let payload = JSON.parse(raw);
if (typeof payload === 'string') payload = JSON.parse(payload); // double-encoded (localStorage string)
const sections = payload.sections || [];

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function mdTable(rows) {
  if (!rows || !rows.length) return '_(無資料)_\n';
  const width = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => { const c = r.slice(); while (c.length < width) c.push(''); return c; });
  let out = '| ' + norm[0].map(esc).join(' | ') + ' |\n| ' + norm[0].map(() => '---').join(' | ') + ' |\n';
  for (const r of norm.slice(1)) out += '| ' + r.map(esc).join(' | ') + ' |\n';
  return out;
}
function maybeTranspose(t) {
  if (!t || !t.length) return t;
  const cols = Math.max(...t.map(r => r.length));
  if (cols > t.length) { const o = []; for (let j = 0; j < cols; j++) o.push(t.map(r => r[j] != null ? r[j] : '')); return o; }
  return t;
}
function dataMd(d) {
  let md = `# ${d.section}\n\n> 來源：財報狗 ${d.url}\n\n`;
  for (const tab of d.tabs) {
    md += `## ${tab.name}\n\n`;
    const tbls = [tab.table, ...(tab.extraTables || [])].filter(t => t && t.length);
    if (!tbls.length) { md += '_(此頁為互動明細，未擷取靜態表)_\n\n'; continue; }
    tbls.forEach((t, i) => { if (i > 0) md += `\n*(附表 ${i + 1})*\n\n`; md += mdTable(maybeTranspose(t)) + '\n'; });
  }
  return md;
}
function overviewMd(d) {
  let md = `# 最新動態（投資亮點 / 風險 / 題材 / 重要數據）\n\n## 投資亮點與風險\n\n`;
  (d.items || []).forEach(t => md += `- ${t}\n`);
  md += `\n## 重要數據摘要\n\n`; (d.summaryTable || []).forEach(t => md += mdTable(t) + '\n');
  md += `## 題材標籤\n\n` + (d.themes || []).join('、') + '\n\n## 相關新聞標題\n\n';
  (d.news || []).forEach(t => md += `- ${t}\n`);
  return md;
}
function healthMd(d) {
  let md = `# 股票健診\n\n`;
  if (d.text) md += '```\n' + d.text.trim() + '\n```\n\n';
  if (d.itemsSample && d.itemsSample.length) { md += `## 健診項目（擷取）\n\n`; d.itemsSample.forEach(t => md += `- ${t}\n`); }
  return md;
}

// order: overview + health first (context), then the 8 data sections in scrape order
const dataSecs = sections.filter(s => s.kind === 'data');
const overview = sections.find(s => s.kind === 'overview');
const health = sections.find(s => s.kind === 'health');

let md = `# ${name} ${code} 財報狗完整財務資料\n\n`;
md += `> 資料來源：財報狗 statementdog.com。所有數字為擷取當日網站數據，含完整歷史。\n`;
md += `> 本檔為結構化量化財務數據，與本筆記本的 Deep Research 質化報告互補。\n\n---\n\n`;
if (overview) md += overviewMd(overview) + '\n---\n\n';
if (health) md += healthMd(health) + '\n---\n\n';
for (const d of dataSecs) md += dataMd(d) + '\n---\n\n';

const dir = path.join(os.homedir(), 'statementdog_work', code);
fs.mkdirSync(dir, { recursive: true });
const safe = name.replace(/[\\/:*?"<>|]/g, '');
const out = path.join(dir, `${safe}_${code}_財報狗.md`);
fs.writeFileSync(out, md, 'utf8');
console.log('wrote', out, Math.round(md.length / 1024) + 'KB', md.split('\n').length + ' lines');

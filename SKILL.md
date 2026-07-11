---
name: stock-research
description: 用 NotebookLM Deep Research 對台股(或任何上市公司)做多面向深度研究 — 新增筆記本、跑 8 批主題深度研究 (公司基本面/財務展望/護城河/風險/技術/ESG/經營團隊/季報)、批次匯入 sources、自動清重複,最後給筆記本連結。台股還會(預設)先抓財報狗(statementdog)全部結構化財務數據(數十個指標表、含全歷史:損益/資產/負債/現金流/三率/估值河流圖/股利/籌碼/產品組合等)轉成 Markdown 上傳當來源,給筆記本一份精確量化基礎與 Deep Research 質化報告互補;並(預設)驅動財報狗網頁內建 AI 助手對 9 個關鍵指標頁逐頁問「幫我分析這個數據」,把 AI 解讀彙整成另一份 Markdown 一併上傳(質化解讀第三來源)。**開工前會先檢查 NotebookLM 是否已有對應筆記本,有就沿用:財報狗資料過期才重撈並刪舊、Deep Research 沒跑過才跑,省時省配額。** **也是 `/stock-research` 斜線指令的完整實作**(`/stock-research 7768 頌勝科技` 會走這個 skill)。Trigger 詞包括:「研究 X 股票」、「deep research 2330 台積電」、「幫我用 notebooklm 研究 X」、「stock research X」、「`/stock-research` <code> <name>」、「研究這檔股票」、「幫我深度研究 X 公司」。使用者通常會給股票代號 + 公司名,可能再加上想聚焦的子主題 (例如「只跑風險和財報」)。整個流程約 1-1.5 小時(8 批 × 5-10 分鐘 deep research),會主動用背景 sleep 等待,不會無謂 polling。
argument-hint: <股票代號> <公司名> [batches=all|basic,fin,...] [statementdog=on|off] [sdai=on|off]
---

# Stock Deep Research (NotebookLM)

對任何上市公司(主要為台股)在 NotebookLM 跑多批次 Deep Research,產出一本內容完整的研究筆記本。

## 何時觸發

- 使用者打 `/stock-research <代號> <名稱>` 例如 `/stock-research 7768 頌勝科技`
- 使用者用自然語言:「幫我研究 6446 藥華藥」「deep research 2330 台積電」「用 notebooklm 研究 X 公司」
- 使用者要求對某檔股票做全面性研究/盡職調查

## Prerequisites

- Playwright MCP 已安裝(`mcp__playwright__browser_*` tool 可用)
- 已在 Chromium 登入 NotebookLM (Google 帳號;沒登入會跳到登入頁,提示使用者手動登入後 Enter 繼續)
- 有 Deep Research 配額(每帳號每天有上限,8 批會用完不少配額)

## 輸入解析

從使用者輸入抽出兩個必要參數:
- `code`: 股票代號 (數字,通常 4 位,可能 5-6 位例如 6488)
- `name`: 公司中文名 (例如 「頌勝科技」、「台積電」、「藥華藥」)

若使用者只給代號沒給名稱,可以自己用 web search / web_fetch 補名稱(查 TWSE 公開資訊觀測站);若都沒給,反問使用者。

可選參數:
- `batches`: 想跑的子集,預設 `all` (全部 8 批)。可寫 `risk,fin` 代表只跑風險與財報。
  - Batch ID 對照: `basic` (公司基本面+新聞), `fin` (財務+展望), `moat` (護城河+競爭), `risk` (風險), `tech` (技術細節), `esg` (ESG), `mgmt` (經營團隊), `qreport` (季報細項)

## Workflow

### Step 0 — 規劃與告知使用者

開工前先告訴使用者:
- 確認 code + name
- (台股) 會先抓財報狗結構化財務數據上傳 (Step 1.5,~2 分鐘);非台股或 `statementdog=off` 則略過
- (台股) 會再驅動財報狗內建 AI 助手對 8 個關鍵指標頁產生解讀並上傳 (Step 1.6,~5-10 分鐘);`sdai=off` 可略過
- 列出將跑哪幾批 (預設 8 批)
- 預估時間 ~1-1.5 小時 (8 批 × 5-10 分鐘 deep research + 匯入時間)
- 若使用者趕時間,建議只跑核心 2-3 批 (`basic,fin,risk` 是必看)

建立 task list (TaskCreate) — 1 個「財報狗數據」task (台股) + 每批 1 個 task + 1 個「dedup」task。

### Step 0.5 — 前置判斷:沿用既有筆記本，只補缺的（最重要的省時/省配額步驟）

**目的**: 同一檔股票可能之前已經研究過。開工前先檢查 NotebookLM 是否已有對應筆記本 — 有的話就沿用，**財報狗資料過期才重撈（並刪舊）、Deep Research 沒跑過才跑**，避免重複燒 Deep Research 配額。

1. **找筆記本**: `browser_navigate` 到 `https://notebooklm.google.com/` → 跑 `scripts/find-notebook.js`，拿到 `{notebooks:[{id,title}]}`。在 title 裡用**股票代號(如 `1514`) 或 公司名(如 `亞力`)** 比對。
   - **比對不到** → 沒有既有筆記本，走原流程：Step 1 新建 → Step 1.5 財報狗 → Step 2-4 全部跑。
   - **比對到多本** → 選 title 最貼近本研究的那本（通常含代號或完整公司名）；不確定就用 AskUserQuestion 問使用者。
   - 注意：有些舊筆記本標題沒有代號（例如「宜鼎國際：邊緣AI…」沒有 5289），所以**代號和公司名都要試**。
2. **比對到 → 沿用**: 設定 `notebookUrl = https://notebooklm.google.com/notebook/<id>`（**跳過 Step 1 新建**）。開啟它，跑 `scripts/notebook-source-audit.js`，拿到 `{financialSources, latestFinancialPeriod, hasDeepResearch}`。
3. **財報狗新鮮度判斷**（台股）:
   - 取財報狗當前最新月份（便宜，不用整包抓）：`browser_navigate` 到 `https://statementdog.com/analysis/<code>/monthly-revenue`，讀頁面 `<title>`，用 `/(\d{4})年(\d{1,2})月營收/` 解析出 `curPeriod`（例如 `2026年4月` → `2026-04`，月份補零）。
   - **若 `latestFinancialPeriod` 為 null（舊檔沒有月份標記）或 < `curPeriod`（過期）** → 更新：
     a. 跑 `scripts/delete-old-statementdog.js` 刪掉舊的財報狗 `.md`（含主檔與 AI 解讀檔；**只刪結尾 `.md` 的我方上傳檔，不會動到 Deep Research 爬到的財報狗新聞頁**）。
     b. 走 **Step 1.5** 重新抓 → 轉 → 上傳（新檔名含月份標記 `_YYYY-MM`，下次才比得出來），再走 **Step 1.6** 重新產 AI 解讀。
   - **若 `latestFinancialPeriod === curPeriod`（已是最新）** → 跳過財報狗主檔。但要**再檢查 `financialSources` 裡有沒有 `財報狗AI解讀` 檔**（title 含 `財報狗AI解讀`）— 主檔是新的但 AI 檔缺（例如上次 sdai 失敗/跳過）且本次 `sdai=on`，就單獨補跑 Step 1.6。
4. **Deep Research 判斷**:
   - **`hasDeepResearch === true`**（既有筆記本已有 ≥5 個非財報狗來源）→ **跳過全部 8 批 + dedup**（Step 2、3、4 全略過）。
   - 否則 → 照常跑 Step 2-3 八批 + Step 4 dedup。
5. **報告**：明確告訴使用者「沿用既有筆記本 / 財報狗已更新到 YYYY-MM（或已是最新略過） / Deep Research 已存在略過（或本次補跑）」。

> 一句話流程：**找到本** → 財報狗舊就換新、Deep Research 有就不跑；**找不到本** → 全新跑。

### Step 1 — 開 NotebookLM 新筆記本（僅在 Step 0.5 找不到既有筆記本時）

```
mcp__playwright__browser_navigate → https://notebooklm.google.com
mcp__playwright__browser_snapshot → 找「建立新的筆記本」按鈕的 ref
mcp__playwright__browser_click → 點建立
```

若 snapshot 結果太大會被存檔,grep 找 `"建立新的筆記本"` 即可拿 ref。

預期跳到 `https://notebooklm.google.com/notebook/<uuid>?addSource=true`,輸入框 placeholder 是「在網路上搜尋新來源」。

### Step 1.5 — 匯入財報狗結構化財務數據 (台股預設 ON,`statementdog=off` 可跳過)

**目的**: 在跑質化的 Deep Research 前,先把財報狗(statementdog.com)的**精確量化財務數據**(數十個指標表、含全歷史) 抓成一份 Markdown 上傳當來源,讓筆記本同時有「硬數字」與「Deep Research 質化分析」。**只適用台股**(美股/海外非台股自動跳過此步)。

**前置**: 瀏覽器需登入財報狗(**付費帳號才解鎖完整歷史**;沒登入仍可抓到部分)。若 Step 1.5 跑出來各 section 的 `tabCount` 多為 0,多半是沒登入或非台股 → 提示使用者登入後重跑,或直接跳過繼續 Deep Research。

**核心原則 (同 Deep Research 步驟): 脆弱的多頁抓取一律走 `scripts/scrape-statementdog.js`,不要手刻 navigate+evaluate ×20。** 數字一律由腳本確定性搬運,**絕不讓 LLM 重打數字**(避免幻覺竄改財報)。

1. **抓取 (1 個 run_code 呼叫)**:
   - 先 `browser_navigate` 到 `https://statementdog.com/analysis/<code>/monthly-revenue` (腳本從 URL 讀 code)。
   - 跑 `scripts/scrape-statementdog.js` (`browser_run_code_unsafe filename=...`)。它一次走訪 8 個資料分頁(每頁點過所有 `li.sub-menu-list-item-link` 指標子分頁,自動處理 `<table>` 與股利政策那種 `<div>` 格狀「詳細數據」頁)+ 最新動態 + 股票健診,把完整 payload 存進財報狗網域的 `localStorage['__SD']`,回傳 `{code, sections:[{section,tabCount}], stored:true}`。
2. **Dump 到磁碟 (1 個 evaluate 呼叫)**: `browser_evaluate` `function: () => localStorage.getItem('__SD')`, `filename: sd_<code>.json` (存到 home 目錄)。
3. **轉成主檔 Markdown (1 個 node 呼叫)**: `node ~/.claude/skills/stock-research/scripts/convert-statementdog.js <code> "<name>" <sd_<code>.json 的實際路徑>`。確定性轉換(寬時間序列自動轉置成期間為列),輸出 `~/statementdog_work/<code>/<name>_<code>_財報狗.md` (約 70-90KB)。
4. **上傳到筆記本當來源**: 回 NotebookLM 該筆記本 → 來源分頁 → **新增來源** → **上傳檔案** → `browser_file_upload` 丟上一步的 `.md` 路徑。等幾秒確認來源清單出現該檔(類型 markdown、無錯誤)。
5. (選用,需使用者同意才跑 Workflow) 想要更厚的洞見,可用 `Workflow` 對各 section 並行寫「重點解讀」+ 一份「投資總覽摘要」再一起上傳;預設不做,維持輕量、數字確定性。

完成後進 Step 1.6(或 `sdai=off` 時直接進 Step 2)。財報狗來源不佔 Deep Research 配額。

### Step 1.6 — 財報狗 AI 助手逐頁解讀 (台股預設 ON,`sdai=off` 可跳過)

**目的**: 財報狗部分指標頁內建 AI 對話視窗(圖表下方有「幫我分析這個數據」建議提問;**不是每頁都有** — 2026-07 實測損益表/現金流量表/營業費用率/ROE-ROA/營運週轉天數/財務結構/營收成長率/PB/產品組合這 9 頁有,月營收/EPS/利潤比率/PE/籌碼沒有)。這步驅動它對這 **9 個關鍵指標頁**各生成一份解讀,彙整成一份 Markdown 上傳當第三來源 — 與「主檔硬數字」「Deep Research 質化報告」互補的**站方 AI 觀點**。沒有 AI 入口的頁會自動標 `skipped`,不算失敗。

**前置**: 同 Step 1.5 需登入財報狗。AI 回答屬生成內容,文件開頭已內建免責標記(「屬 AI 分析觀點,非原始數據」),NotebookLM 引用時能分清楚。

1. **問答收集 (1-3 個 run_code 呼叫)**:
   - 若剛跑完 Step 1.5 已在財報狗網域可直接跑;否則先 `browser_navigate` 到 `https://statementdog.com/analysis/<code>/monthly-revenue`。
   - 跑 `scripts/ask-statementdog-ai.js` (`browser_run_code_unsafe filename=...`)。它逐頁點「幫我分析這個數據」→ 等串流結束(「停止」鈕消失+長度穩定)→ 確定性把回答 HTML 轉 Markdown,累積存進 `localStorage['__SD_AI']`。
   - **內建時間預算 ~200s/次,超過就先返回 `{remaining:[...]}`** — `remaining` 非空就**直接再跑同一支腳本**,會從斷點續跑(一般 2-3 次跑完 8 頁,總計 ~5-10 分鐘)。
   - 若回傳連續失敗中止(`no-answer(quota/未登入?)`),多半是沒登入或站方 AI 額度用盡 → 告知使用者並跳過此步,不影響主流程。
2. **Dump 到磁碟 (1 個 evaluate 呼叫)**: `remaining` 空(`mdStored:true`)後,`browser_evaluate` `function: () => localStorage.getItem('__SD_AI_MD')`, `filename: sd_ai_<code>.md` (存到 home 目錄)。**注意 dump 出來是 JSON 字串字面值**(帶引號與 `\n` 跳脫),要解一層再存。
3. **解跳脫+改名歸位 (1 個 PowerShell 呼叫)**: `$raw = Get-Content ~\sd_ai_<code>.md -Raw | ConvertFrom-Json; Set-Content ~\statementdog_work\<code>\<name>_<code>_財報狗AI解讀_<YYYY-MM>.md -Value $raw -Encoding utf8` — `<YYYY-MM>` 用 Step 0.5/1.5 拿到的財報狗最新月營收月份(和主檔同一個新鮮度標記,Step 0.5 的 audit 才能一起判過期)。
4. **上傳到筆記本當來源**: 同 Step 1.5 流程(新增來源 → 上傳檔案 → `browser_file_upload`)。
5. **重跑重置**: 下次要對同一檔重抓時(過期重跑),先 `browser_evaluate` `() => { localStorage.removeItem('__SD_AI'); localStorage.removeItem('__SD_AI_MD'); }` 清舊狀態再跑,否則會拿到上個月的快取答案。

### Step 2 — 切到 Deep Research 模式

預設按鈕是 "Fast Research",要先切到 "Deep Research"。

```
找 "Fast Research" 按鈕 → click → 出現選單 → click "Deep Research 深度報告和結果"
```

**重要陷阱**: 第一批送出後,模式有時會重置回 Fast Research。**每批送出前都要重新檢查模式**,若是 Fast Research 就切回 Deep Research。從 Batch 2 開始通常會保持 Deep Research,但仍要 verify。

### Step 3 — 對每個 batch 跑一輪

**核心原則: 脆弱的 UI 動作一律走 `scripts/*.js`,不要手刻 `snapshot → grep → 找 ref → click`。**
手動點擊每批要 6~10 個工具呼叫,呼叫越多越容易把 click 打成壞格式而卡在「匯入」。改用腳本後每批只剩 3~4 個穩定呼叫。

對每個要跑的 batch (見 `## Batch 提示詞模板` 區段):

1. **填 prompt**: 在輸入框 (`textbox "根據輸入的查詢內容，探索來源"`) 用 `mcp__playwright__browser_type` 填入該 batch 的 prompt (替換 `{code}` 與 `{name}`)。大段 prompt 維持用 type,不要塞進 JS (跳脫地獄)。
2. **切模式 + 送出 (一支腳本)**: 跑 `scripts/submit-deep-research.js` (`browser_run_code_unsafe filename=...`)。它會自動偵測模式、是 Fast 就切回 Deep、再點「提交」,回傳 `{switchedToDeep, submitted, err}`。若 `submitted:false` 才 fallback 去 snapshot 找 ref。
3. **背景等待 6-9 分鐘** (詳見 ## 等待策略),不要主動 poll。
4. **檢查 + 匯入 (一支腳本)**: 收到 task notification 後跑 `scripts/check-and-import.js`。它一次完成「判斷是否已完成 → 若完成就點匯入」:
   - 回傳 `{done:false, progress:"已完成 3/5 步驟"}` → 還在跑,再背景 sleep 一輪後重跑此腳本。
   - 回傳 `{done:true, imported:true, sources:N}` → 該批匯入成功,記下 `sources` 數。
   - 回傳 `{done:true, imported:false, err:...}` → banner 在但點擊失敗,直接再跑一次此腳本即可 (它內建 4 次重試,通常一次就過)。
   - **不要再手動找「匯入」按鈕 ref 來點** — 那正是舊版卡在匯入的元兇。
5. 更新 task list 該 batch 為 completed,下一 batch 進 in_progress。
6. **送下一批前,等研究面板解鎖**(見 ## 已知陷阱 #13): 匯入成功後研究框會被「來源處理中」鎖成 `readonly`,要 `?addSource=true` 重開 + 輪詢 `source-discovery-query-box textarea` 的 `readOnly===false`(來源多時背景 sleep 3-4 分鐘再輪詢)才能 type 下一批。

> 提示: 配合 `/goal 跑到結束不要停在匯入` 設一個 Stop hook,可在沒跑完 8 批+dedup 前擋住結束 turn,是最有效的「不要中途停」防呆。

### Step 4 — 全部跑完後,清重複 sources

8 批跑完通常會累積 ~150 個 sources,其中 30-60 個是重複的 (同篇文章被多批抓到)。**先切到「來源」分頁讓 source list 渲染**(見 ## 已知陷阱 #14),再**使用 `scripts/dedup-sources.js` 的 Playwright 程式碼**,透過 `mcp__playwright__browser_run_code_unsafe` 一次跑完整個去重流程(自動偵測+刪除重複)。

腳本會印出: 偵測到的重複群組、實際刪除數量、最終 source 總數。

### Step 5 — 報告結果給使用者

格式:
```
✅ 完成: <code> <name> Deep Research

財報狗結構化財務數據: ✅ 已上傳 <name>_<code>_財報狗.md (NN 個指標表/全歷史)  ← 台股才有

8 批 Deep Research 報告:
| Batch | 主題 | 原始來源數 |
| 1 | 公司基本面+新聞 | XX |
| 2 | 財務+展望 | XX |
...

清重複: 刪 XX 個,最終 XXX 個 sources

筆記本: https://notebooklm.google.com/notebook/<uuid>
```

## 等待策略

Deep Research 一批的時間**高度依股票知名度而變**:
- **小/中型股 (例如 7768 頌勝、6446 藥華藥、4966 譜瑞-KY)**: 5-10 分鐘
- **超大型股 (台積電 2330、聯發科 2454、鴻海 2317、台達電 2308、聯電 2303、廣達 2382 等熱門權值股)**: **60-90 分鐘**;NotebookLM 的 deep research crawler 找到的網站數量是小型股的 8-10 倍,refinement 時間也大幅拉長

正常流程:
1. 送出 → 「規劃中…」 30-90s
2. 「已完成 X/5 步驟」 → 「正在研究網站...」 — 小型股 3-8 分鐘,大型股 20-60 分鐘
3. 「正在分析結果...」 — 小型股 1-2 分鐘,大型股 5-30 分鐘
4. 「Deep Research 已完成!發現 X 個來源」+ 出現「匯入」按鈕

**進度文字會反覆跳,看似卡住但其實正常**: 步驟 2-3 之間,文字可能反覆切換「已完成 3 個步驟 (共 5 個)」↔「正在分析結果...」長達 20-40 分鐘 (尤其大型股)。**不要因此判定卡住而中斷**,只要「停止探索來源」按鈕還在就是 still running。真的卡住的特徵是 console error 暴增 + 進度文字完全靜止 >10 分鐘。

**不要用 `mcp__playwright__browser_wait_for`** — 實測它對長 wait (>30s) 不可靠,常常提早回來 (約 50s 就 return)。

**用 Bash run_in_background 等**:
```bash
sleep 480 && echo ready
```
(`run_in_background: true`, `timeout: 600000`)

收到 task notification 後再 snapshot 檢查。若還沒完成 (snapshot 沒「Deep Research 已完成」),再 sleep 180-300s 一次。**大型股要有耐心,連續 sleep 5-8 次都是正常範圍**。

**忽略舊的 sleep 通知**: 跑大型股長 deep research 過程中,先前的 background sleep 會陸續完成 — 你會收到一連串「Background command X completed」通知,其中很多是過期的 (sleep 結束時 deep research 已經跑完了)。**收到通知後務必先 snapshot 看當前狀態,不要對舊通知無腦反應**;若狀態已是「Deep Research 已完成」,直接進匯入步驟即可。

**SLEEP 注意**: 不要直接 `Bash sleep` 不開 run_in_background — 會被 sandbox 擋。一定要 `run_in_background: true`。

**⚠️ Subagent vs 主 agent 等待模式不同 — 這是最容易踩雷的差異**:

- **主 agent (直接 user 對話)**: 用 `Bash run_in_background: true` 後可以結束本 turn,harness 會在 sleep 完成時自動 fire 新 turn 把 notification 給你。這是預設模式。
- **Subagent (被 `Agent` tool 起出來的)**: **絕對不可以**結束 turn 等通知! Subagent 結束 turn = subagent 整個任務終止,回給 parent。Parent 不會自動把 notification 餵回給已死的 subagent。
  - 正確做法: 在**同一個 turn 內**用**同步、chunked while-loop** Bash 等待。**注意**: sandbox 會擋掉單發長 sleep — 連 `sleep 480` (不論有沒有 `run_in_background: true`) 都會被擋。**canonical 寫法**是 30s chunk 累加:
    ```bash
    i=0; while [ $i -lt 18 ]; do sleep 30; i=$((i+1)); done; echo done
    ```
    (這個會撐 9 分鐘。設 `timeout: 600000` 不開 `run_in_background`。)
  - 9-10 分鐘到了就 snapshot 檢查,沒完成 (snapshot 沒「Deep Research 已完成」) 再下一輪 chunked while。
  - 大型股 60-90 分鐘可能要連續 sleep 8-10 次,但都在同一個 turn 內。Subagent 必須跑完全部 batch + dedup 才能 return。
  - 如果你是被 `Agent` tool 起出來執行 stock-research 的 subagent,**忽略上面那段「結束 turn 等通知」的指引** — 那是給主 agent 看的。

## Batch 提示詞模板

每個 prompt 中的 `{code}` 與 `{name}` 替換成股票代號與公司中文名。

### Batch 1 — basic (公司基本面 + 新聞)
```
台灣興櫃/上市公司「{name}」(股票代號 {code}) 的公司基本介紹、主要業務與產品線、組織架構與經營團隊、近一年 (2025-2026) 的重大新聞、營運事件、法說會公告、股價重要事件、董事會決議、媒體報導、產業地位變化等。請涵蓋繁體中文與英文資料,以台灣本地新聞與公開資訊觀測站、券商研究報告為主。
```

### Batch 2 — fin (財務資訊與未來展望)
```
{name} (股票代號 {code}) 財務資訊與未來展望深度分析。涵蓋: (1) 近 5 年營收、毛利率、營業利益率、稅後淨利、EPS、ROE、ROA、自由現金流、負債比、股利政策; (2) 季度與月度營收趨勢、淡旺季變化; (3) 法人說明會內容、管理層 guidance、產能擴張計畫、新產品 roadmap; (4) 未來 1-3 年成長動能、客戶導入進度、ASP 與出貨量趨勢、產品組合 (product mix) 變化、毛利率提升空間; (5) 海內外營收占比; (6) 所在產業景氣循環對營運影響; (7) 券商目標價與評等變動。資料來源請優先採用公開資訊觀測站、法說會簡報、財經媒體 (鉅亨、工商、經濟日報、MoneyDJ)、券商研究報告。
```

### Batch 3 — moat (護城河與競爭格局)
```
{name} (股票代號 {code}) 護城河與競爭格局深度分析。涵蓋: (1) 公司的核心競爭優勢、技術壁壘、專利布局、Know-How 累積、研發投入占比; (2) 主要客戶結構、客戶集中度、客戶導入週期、認證難度; (3) 上游原物料供應商與議價能力; (4) 產業全球主要競爭者各家市佔率、產品差異化、定價策略; (5) 台灣本土同業比較; (6) 進入障礙、規模經濟、轉換成本、品牌效應; (7) 國產化替代趨勢對公司的影響。請優先採用券商深度報告、產業研究機構 (IC Insights、Yole、TrendForce) 報告與英文外電。
```

### Batch 4 — risk (風險與潛在利空)
```
{name} (股票代號 {code}) 風險與潛在利空深度分析。涵蓋: (1) 產業景氣循環風險、終端需求變化對營收衝擊; (2) 客戶集中度風險、單一客戶砍單或減產的曝險; (3) 競爭加劇: 國際大廠價格戰、中國紅色供應鏈崛起; (4) 技術迭代風險; (5) 原物料成本波動風險; (6) 匯率風險 (台幣/美元/人民幣); (7) 地緣政治風險: 美中科技戰、出口管制、台海情勢; (8) 公司治理風險: 大股東持股變動、內部人申讓、董監事異動、會計師意見; (9) 過往股價重挫、財報疑慮、訴訟、環保/工安事件; (10) 估值偏高或評等下修風險、籌碼面、融資餘額、外資/投信買賣超。請優先採用財經媒體、券商賣方研究報告、PTT 股板、Mobile01、雪球財經等社群輿論。
```

### Batch 5 — tech (技術細節與產品深度)
```
{name} (股票代號 {code}) 技術細節與產品深度分析。涵蓋: (1) 公司核心技術的科學原理、材料、製程; (2) 製程流程細節與品質檢驗; (3) 主要產品線細項與規格分類; (4) 自主研發 vs 技轉、與國際大廠在技術上的差異; (5) 專利布局、申請件數、被引用次數、自主智慧財產; (6) 技術 roadmap 與下世代產品; (7) 跨足新領域 (新材料/新應用) 的進度; (8) 研發團隊、研發人員占比、與工研院/材料所/大學的合作。
```

### Batch 6 — esg (ESG 與永續經營)
```
{name} (股票代號 {code}) ESG 與永續經營深度研究。涵蓋: (1) 公司治理: 公司治理評鑑等級、董事會獨立性、獨立董事比例、薪酬委員會、審計委員會、內部稽核、揭露透明度; (2) 環境: 永續報告書 / TCFD / GHG 盤查、Scope 1/2/3 碳排放、用水/能源/廢棄物管理、製程減排、化學品管理、ISO 14001 / 14064; (3) 社會: 員工結構、職災率、人均教育訓練、薪酬、女性主管比例、勞資關係、供應鏈管理; (4) 永續金融: ESG 評等 (MSCI、Sustainalytics、台灣公司治理 100 指數、富時 ESG 等); (5) 與大客戶 (台積電 SBTi、Apple supplier code、RBA) 的供應商 ESG 要求是否合規; (6) 綠電採購、淨零承諾、SBTi 進度; (7) 重大爭議: 違規、罰款、環保事件、勞檢、訴訟; (8) ESG 在估值與機構投資人決策上的影響。
```

### Batch 7 — mgmt (經營團隊背景)
```
{name} (股票代號 {code}) 經營團隊與管理層深度檔案。涵蓋: (1) 董事長 / 總經理 / 副總 / 財務長 / 研發長 等核心高管的姓名、學經歷、過往任職公司、產業資歷、技術背景; (2) 創辦人/家族持股 vs 法人董事; (3) 董事會結構: 董事人數、獨立董事比例、董事會成員背景、董事兼任其他公司; (4) 經理人薪酬區間、員工分紅、股票選擇權、限制性股票 (RSU) 計畫; (5) 大股東結構、前 10 大股東名單、持股比例變化、董監持股質設、內部人申讓申報; (6) 法人 / 外資 / 投信 對管理層的評價; (7) 公司轉型/成立的關鍵決策者、創業故事; (8) 接班規劃、ESOP、組織文化、產官學人脈關係。請優先採用公開資訊觀測站年報、財經人物專訪 (天下、商周、財訊、今周刊、Bloomberg、Reuters)。
```

### Batch 8 — qreport (最新季報細項)
```
{name} (股票代號 {code}) 最新季報與年報深度解讀,聚焦最近 4 個季度與最近 2 個年度。涵蓋: (1) 三大財務報表逐項解讀: 合併綜合損益表、合併資產負債表、合併現金流量表,逐季 / 逐年 YoY 與 QoQ 變化; (2) 各產品線 / 各區域 (台灣、中國、其他亞太、北美、歐洲) 營收占比與成長率; (3) 毛利率拆解 (產品 mix / ASP / 原物料 / 匯率 / 稼動率); (4) 營業費用結構 (R&D / SG&A) 與占比; (5) 業外損益、匯兌損益、轉投資、權益法投資; (6) 現金流結構: 營業活動現金流、投資活動 (CapEx、購置不動產廠房設備)、融資活動 (現金股利、股票發行/買回、舉債); (7) 重要科目變化: 應收帳款週轉天數、存貨週轉天數、應付帳款、有息負債、淨負債比; (8) 重要附註揭露、關係人交易、訴訟、或有負債、衍生性商品; (9) 法說會 Q&A 重點、管理層對下一季與下一年的 guidance; (10) 與同業同期數字比較; (11) 重大會計政策變動、會計師查核意見。請優先採用公開資訊觀測站 (mops.twse.com.tw)、季報原始 PDF、券商法說會記要、財報狗等。
```

## 已知陷阱

0. **(最重要) 別手刻匯入/送出點擊**: 用 `scripts/submit-deep-research.js` 與 `scripts/check-and-import.js` (見 ## 腳本)。手動 `snapshot → grep → 找 ref → click 匯入` 是過去「每次卡在匯入」的根因 — 呼叫次數一多就容易把 click 打成壞格式,而且匯入剛好落在喚醒回合的起點特別顯眼。腳本用穩定 DOM selector + 內建重試,一發到位。
1. **模式重置**: 第一批送出後 mode 可能回到 Fast Research。`submit-deep-research.js` 已自動處理 (偵測到 Fast 就切回 Deep);手動路徑才需每批重新確認。
2. **`browser_wait_for` 不可靠**: 對 >30s 的等待會提早 return,改用上面 ## 等待策略 描述的同步/背景 sleep 方法。
3. **`browser_type` 後 submit button 仍 disabled**: 罕見;若發生,改用 type 後 press_key Enter 或 re-snapshot 找新 ref。
4. **Snapshot 很大 (常 80k+ tokens)**: 一律 `filename` 參數存檔,然後用 Grep 找關鍵字。常用 grep pattern:
   - `Deep Research 已完成|匯入|發現.*個來源|正在|步驟|disabled|textbox`
   - `提交.*ref|arrow_forward|Fast Research|Deep Research" \[ref`
5. **沒登入 NotebookLM**: 第一次跑會跳 Google 登入頁,提示使用者「請去瀏覽器登入後告訴我 ok 再繼續」。
6. **Deep Research 配額**: 每帳號每天有上限 (通常 ~10 次)。若跑到一半失敗顯示 quota,告訴使用者明天再跑剩下的批次。
7. **textarea 在前批未匯入前 disabled**: 跑完 Batch N 的 Deep Research 後,**一定要先點「匯入」** Batch N 的結果,輸入框才會解除 disabled 讓你送 Batch N+1。不要還沒匯入就試圖打下一批 prompt。
8. **NotebookLM 自動改 notebook 標題**: 匯入第一批後 NotebookLM 會根據 Deep Research 內容自動把筆記本標題從 "Untitled notebook" 改成主題標題 (例如「譜瑞-KY產品亮點與財務營運動態」)。**這是正常的,不用改回**。如果要客製化標題,告知使用者最後可以手動改。
9. **少數 sources ingest 失敗 (silent)**: 偶有 source 無法匯入 (常見:paywalled 新聞、某些 PDF、需登入的網站)。Source list 不會顯示失敗 row,只是該篇直接消失。**對 source 總數 (final_count) 略低於 raw count 的情況不要驚慌**,不影響整體覆蓋。
10. **批次間 source count 與 notebook 總數會不一致**: 個別 batch 報「找到 X 個 sources」加總,跟匯入後 notebook 的 source 總數常差 2-5 個 — NotebookLM 在匯入階段就會自動 dedupe 部分 cross-batch 重複。報告時以**匯入後的 notebook source count** 為準,而不是各批的 sum。
11. **(財報狗 Step 1.5) 沒登入 / 非台股 → tabCount 多為 0**: `scrape-statementdog.js` 回傳的 `sections` 裡若 `tabCount` 普遍 0 或極低,代表瀏覽器沒登入財報狗(只拿得到公開的少量資料)或這檔不是台股(財報狗沒有該頁)。提示使用者登入付費帳號後重跑此步,或直接 `statementdog=off` 跳過、只跑 Deep Research。
12. **(財報狗 Step 1.5) `run_code_unsafe` 沒有 `require`**: 不要在抓取腳本裡用 `fs`/`require` — 沙箱會丟 `require is not defined`。落地一律走「localStorage `__SD` → browser_evaluate `filename` dump → node convert」三段式。`browser_evaluate` 的 `filename` 只能存 basename 到 home 目錄(不能帶子路徑)。
13. **(批次間最重要) 匯入後研究框會被「來源處理中」鎖住 `readonly`**: 每批 `check-and-import` 匯入成功後,NotebookLM 會在剛匯入的那批 sources **背景處理(ingest)完成前**,把 `source-discovery-query-box textarea` 設成 `readonly=true`、把「網路」corpus 鈕設成 `disabled` — 整個研究面板鎖住,**不是 `disabled` 而是 `readonly`**(所以只檢查 `.disabled` 會誤判成可用)。**送下一批前務必**: (a) `browser_navigate` 到 `?addSource=true`,(b) 用 `browser_evaluate` 輪詢 `document.querySelector('source-discovery-query-box textarea').readOnly === false` 直到解鎖(來源多時要 3-5 分鐘,背景 sleep 後重開再輪詢),(c) 解鎖後才 `browser_type` 填 prompt。沒等解鎖就 type 會 timeout(element is not editable)。注意:這個鎖跟 trap #7 的「前批未匯入→textarea disabled」是兩回事,#13 是「已匯入但 sources 還在 ingest」。
14. **(dedup) 跑 `dedup-sources.js` 前要先切到「來源」分頁**: dedup 靠 `.single-source-container` 抓 source list,但頁面預設停在「對話」分頁時這些容器不在 DOM,腳本會回傳 `initialSources:0` 什麼都沒刪。先 `browser_evaluate` 點「來源」tab(`[role=tab]` 或 button 文字 `^來源$`)、等 ~2.5s 讓清單渲染(確認 `.single-source-container` 數量 > 0)再跑 dedup。(`notebook-source-audit.js`、`delete-old-statementdog.js` 已內建切分頁。)
15. **(Step 1.6 財報狗 AI) 幾個實務點**: (a) 一次 `run_code` 只跑 ~200s 就返回,`remaining` 非空**再跑同支腳本即可續跑**,不要自己手刻逐頁點擊; (b) 連續 2 頁失敗會自動中止 — 多半是未登入或站方 AI 額度用盡,跳過此步繼續主流程即可,**不是 fatal**; (c) 串流完成靠「停止」鈕消失+回答長度穩定判定,**不要**用 `browser_wait_for`; (d) 過期重跑前務必先清 `localStorage['__SD_AI']` 與 `__SD_AI_MD`,否則會沿用舊快取答案; (e) AI 檔與主檔共用同一個 `_YYYY-MM` 新鮮度標記,audit/delete 腳本已同時涵蓋兩者。
16. **(Step 0.5 關鍵) 「我方財報狗 `.md`」vs「Deep Research 爬到的財報狗新聞頁」要分清楚**: Deep Research 常會抓到 statementdog.com 的個股新聞/數據頁,**它們的標題也含「財報狗」**(例如「亞力(1514)2026年第1季EPS為0.73元 - 財報狗」)。判斷/刪除我方上傳的財報狗主檔時**只能比對結尾 `.md`** 的標題(`/財報狗(_\d{4}-\d{2})?\.md$/`),否則 `delete-old-statementdog.js` 會誤刪一堆 Deep Research 來源。新鮮度月份標記也是從 `財報狗_YYYY-MM.md` 檔名解析(`convert-statementdog.js` 會把最新月營收月份寫進檔名與 H1);舊版上傳檔沒有月份標記 → `period:null` → 一律當過期重抓(可接受,重抓後就有標記)。

## 失敗與恢復

- **某批送出但沒完成 (snapshot 顯示 error)**: 不算 fatal,跳過該 batch 繼續下一批,最後在結果報告中標記。
- **匯入按鈕沒出現**: 再等 60s 後 snapshot;還是沒有就 click 「查看來源」展開,改用「全部加入」之類的替代路徑。
- **使用者中途想改方向**: 隨時可以中斷,已完成的 batch 都已 import 到筆記本不會消失。

## 腳本

三支腳本都是 Playwright async function,一律用 `mcp__playwright__browser_run_code_unsafe filename=<路徑>` 跑 (用 `filename` 比貼整段 `code` 乾淨)。共同設計哲學: 只用穩定 DOM selector (`.single-source-container`、`source-item-more-button-<uuid>`、`getByRole`),不依賴會變動的 aria ref,並內建重試。

| 腳本 | 何時跑 | 回傳 |
|---|---|---|
| `find-notebook.js` | Step 0.5,在 NotebookLM 首頁 | `{notebooks:[{id,title}]}` — 列出已載入筆記本供代號/名稱比對 |
| `notebook-source-audit.js` | Step 0.5,開啟既有筆記本後 | `{financialSources:[{id,title,period}], latestFinancialPeriod, otherSourceCount, hasDeepResearch}` — 判斷財報狗新鮮度與是否已跑 Deep Research |
| `delete-old-statementdog.js` | Step 0.5,財報狗過期、上傳新檔前 | `{attempted, deleted}` — 刪掉舊的財報狗 `.md`(只刪我方上傳檔) |
| `scrape-statementdog.js` | Step 1.5,先 navigate 到 `statementdog.com/analysis/<code>/monthly-revenue` 後 | `{code, sections:[{section,tabCount}], stored:true}` — 一次抓完 10 頁存進 `localStorage['__SD']` |
| `convert-statementdog.js` | Step 1.5,dump `__SD` 到 `sd_<code>.json` 後 (用 `node` 跑,非 Playwright) | 印出主檔路徑 — 確定性把 raw → `~/statementdog_work/<code>/<name>_<code>_財報狗.md`(數字零失真) |
| `ask-statementdog-ai.js` | Step 1.6,在財報狗任一 analysis 頁 | `{done, okTotal, remaining, mdStored}` — 逐頁問站方 AI「幫我分析這個數據」,`remaining` 非空就再跑一次續跑;完成後 dump `localStorage['__SD_AI_MD']` |
| `submit-deep-research.js` | 每批 `browser_type` 填完 prompt 後 | `{switchedToDeep, submitted, err}` — 自動切 Deep + 點提交 |
| `check-and-import.js` | 每批背景等待後 | `{done, progress}` 或 `{done:true, imported, sources}` — 判斷完成並匯入 |
| `dedup-sources.js` | 8 批全匯入後 | `{summary, dupGroups, finalSourceCount}` — 清重複 |

### scrape-statementdog.js / convert-statementdog.js (財報狗結構化數據,見 Step 1.5)

- `scrape-statementdog.js` 是 Playwright `run_code_unsafe` 腳本,**該沙箱沒有 `require`/fs**,所以它把結果存進財報狗網域 `localStorage['__SD']`,再由一支 `browser_evaluate` (`() => localStorage.getItem('__SD')`, `filename: sd_<code>.json`) dump 到磁碟。
- 抓取細節:每個大分頁的指標子分頁是 `li.sub-menu-list-item-link`(`selected` 為現用),JS `click()` 切換;多數頁是 `<table>`(指標為列、期間為欄),少數(如股利政策)是 `<div>` 格狀需先點「詳細數據」分頁;**切忌用過廣選擇器點到導覽列「個股」會跳走到 2330**。
- `convert-statementdog.js` 是 **node** 腳本(用 Bash 跑,不是 Playwright):`node convert-statementdog.js <code> "<name>" <sd_json路徑>`;寬表(cols>rows)自動轉置成期間為列,輸出單一主檔。

### dedup-sources.js

它會:
1. 偵測所有 source 的 aria-label,group by title
2. 對每個 group 保留第一個 UUID,其他刪除
3. 額外處理「截斷標題 vs 全標題」的隱藏重複 (e.g. `"從鞋墊...供應 ..."` 對 `"從鞋墊...供應鏈 - 今周刊"`)
4. 回傳 `{summary, deleted, finalSourceCount}`

每個刪除動作走流程: click 「更多」 → click 「移除來源」 menuitem → click 「刪除」 dialog button。

## 對使用者的對話建議

- 開工前確認 code + name,並讓使用者知道要 ~1 小時。
- 跑到一半使用者可能會問「進度如何」,直接報「正在 Batch X 的 deep research,預估還 Y 分鐘」。
- 完成後給:筆記本連結、批次表格、清重複統計、建議下一步 (例如「可以到對話面板問整合性問題」、「Studio 可生成簡報/心智圖/投資論文」)。

---
name: stock-research
description: 用 NotebookLM Deep Research 對台股(或任何上市公司)做多面向深度研究 — 新增筆記本、跑 8 批主題深度研究 (公司基本面/財務展望/護城河/風險/技術/ESG/經營團隊/季報)、批次匯入 sources、自動清重複,最後給筆記本連結。**也是 `/stock-research` 斜線指令的完整實作**(`/stock-research 7768 頌勝科技` 會走這個 skill)。Trigger 詞包括:「研究 X 股票」、「deep research 2330 台積電」、「幫我用 notebooklm 研究 X」、「stock research X」、「`/stock-research` <code> <name>」、「研究這檔股票」、「幫我深度研究 X 公司」。使用者通常會給股票代號 + 公司名,可能再加上想聚焦的子主題 (例如「只跑風險和財報」)。整個流程約 1-1.5 小時(8 批 × 5-10 分鐘 deep research),會主動用背景 sleep 等待,不會無謂 polling。
argument-hint: <股票代號> <公司名> [batches=all|basic,fin,...]
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
- 列出將跑哪幾批 (預設 8 批)
- 預估時間 ~1-1.5 小時 (8 批 × 5-10 分鐘 deep research + 匯入時間)
- 若使用者趕時間,建議只跑核心 2-3 批 (`basic,fin,risk` 是必看)

建立 task list (TaskCreate) — 每批 1 個 task,加 1 個「dedup」task。

### Step 1 — 開 NotebookLM 新筆記本

```
mcp__playwright__browser_navigate → https://notebooklm.google.com
mcp__playwright__browser_snapshot → 找「建立新的筆記本」按鈕的 ref
mcp__playwright__browser_click → 點建立
```

若 snapshot 結果太大會被存檔,grep 找 `"建立新的筆記本"` 即可拿 ref。

預期跳到 `https://notebooklm.google.com/notebook/<uuid>?addSource=true`,輸入框 placeholder 是「在網路上搜尋新來源」。

### Step 2 — 切到 Deep Research 模式

預設按鈕是 "Fast Research",要先切到 "Deep Research"。

```
找 "Fast Research" 按鈕 → click → 出現選單 → click "Deep Research 深度報告和結果"
```

**重要陷阱**: 第一批送出後,模式有時會重置回 Fast Research。**每批送出前都要重新檢查模式**,若是 Fast Research 就切回 Deep Research。從 Batch 2 開始通常會保持 Deep Research,但仍要 verify。

### Step 3 — 對每個 batch 跑一輪

對每個要跑的 batch (見 `## Batch 提示詞模板` 區段):

1. 在輸入框 (`textbox "根據輸入的查詢內容，探索來源"`) `mcp__playwright__browser_type` 填入該 batch 的 prompt (替換 `{code}` 與 `{name}` 變數)
2. 確認模式是 Deep Research (見 Step 2)
3. Click `button "提交"` (送出後輸入框會 disabled、出現 progressbar「正在載入來源」/「規劃中…」)
4. **背景等待 6-9 分鐘** (詳見 ## 等待策略),不要主動 poll
5. 收到 task notification 後 snapshot,grep `"Deep Research 已完成"`
   - 若還在跑(找不到「已完成」),snapshot 找「正在分析結果...」或「已完成 X/5 步驟」,再等 2-3 分鐘
6. 找到「匯入」按鈕的 ref,click 匯入。Deep Research 報告 + 所有 sources (通常 10-40 個) 會進筆記本
7. 更新 task list 該 batch 為 completed,下一 batch 進 in_progress

### Step 4 — 全部跑完後,清重複 sources

8 批跑完通常會累積 ~150 個 sources,其中 30-60 個是重複的 (同篇文章被多批抓到)。**使用 `scripts/dedup-sources.js` 的 Playwright 程式碼**,透過 `mcp__playwright__browser_run_code_unsafe` 一次跑完整個去重流程(自動偵測+刪除重複)。

腳本會印出: 偵測到的重複群組、實際刪除數量、最終 source 總數。

### Step 5 — 報告結果給使用者

格式:
```
✅ 完成: <code> <name> Deep Research

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

1. **模式重置**: 第一批送出後 mode 可能回到 Fast Research。每批送出前都重新確認。
2. **`browser_wait_for` 不可靠**: 對 >30s 的等待會提早 return,改用 Bash `sleep N && echo ready` + `run_in_background: true`。
3. **`browser_type` 後 submit button 仍 disabled**: 罕見;若發生,改用 type 後 press_key Enter 或 re-snapshot 找新 ref。
4. **Snapshot 很大 (常 80k+ tokens)**: 一律 `filename` 參數存檔,然後用 Grep 找關鍵字。常用 grep pattern:
   - `Deep Research 已完成|匯入|發現.*個來源|正在|步驟|disabled|textbox`
   - `提交.*ref|arrow_forward|Fast Research|Deep Research" \[ref`
5. **沒登入 NotebookLM**: 第一次跑會跳 Google 登入頁,提示使用者「請去瀏覽器登入後告訴我 ok 再繼續」。
6. **Deep Research 配額**: 每帳號每天有上限 (通常 ~10 次)。若跑到一半失敗顯示 quota,告訴使用者明天再跑剩下的批次。

## 失敗與恢復

- **某批送出但沒完成 (snapshot 顯示 error)**: 不算 fatal,跳過該 batch 繼續下一批,最後在結果報告中標記。
- **匯入按鈕沒出現**: 再等 60s 後 snapshot;還是沒有就 click 「查看來源」展開,改用「全部加入」之類的替代路徑。
- **使用者中途想改方向**: 隨時可以中斷,已完成的 batch 都已 import 到筆記本不會消失。

## Dedup 腳本

`scripts/dedup-sources.js` 是 Playwright async function,用法:
```
mcp__playwright__browser_run_code_unsafe code=<貼整個檔案內容>
```

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

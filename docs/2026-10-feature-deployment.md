# FitConnect：Gemini、運動紀錄管理、週報與 Email 驗證

本次程式包含資料庫結構變更。請先備份資料庫，在維護期間完成遷移後才開放新版網站。不要清空資料表或重新建立正式資料庫。

正式環境是自己的 mini PC，PHP 與 PostgreSQL 由 Docker Compose 管理，不使用代管資料庫或雲端部署平台。實際上線順序、Compose 環境變數與 Git 分類請先看 [mini PC 部署步驟](mini-pc-deployment.md)。本文件補充各項新功能的設定與驗收。

## 一、先準備環境變數

金鑰只放在後端伺服器的環境變數。不要寫進 JS、HTML、Dockerfile 或 GitHub。你先前貼在對話中的 Google 金鑰應撤銷並重新建立。

| 名稱 | 設定內容 |
| --- | --- |
| `DATABASE_URL` | 沿用目前可連線的 PostgreSQL 連線字串 |
| `DB_PASSWORD` | 選填；PHP 的資料庫連線密碼覆蓋值。不是修改 PostgreSQL 帳號密碼的指令 |
| `APP_BASE_URL` | 使用者實際開啟的 HTTPS 網址，例如 `https://fitconnect.example.com`；若有子目錄需包含，結尾不加 `/` |
| `APP_ENV` | 正式站設為 `production` |
| `GEMINI_API_KEY` | Google AI Studio 新建立的金鑰 |
| `GEMINI_MODEL` | 預設 `gemini-3.5-flash-lite`；請以該 Google 專案實際開放的模型名稱為準 |
| `RESEND_API_KEY` | Resend 的寄信金鑰，可沿用現有金鑰 |
| `RESEND_FROM_EMAIL` | Resend 已驗證網域的寄件地址，例如 `accounts@your-domain.com` |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 **LINE Login** Channel 的 Channel ID；不是 Messaging API Channel ID，也不是 LIFF ID |
| `LIFF_ID`、其他 LINE 變數 | 沿用現有設定 |

`OPENAI_API_KEY`、`OPENAI_MODEL` 已不再使用，可以從伺服器的 PHP 服務設定刪除。`.env.example` 只是一份範本，PHP 不會自動載入 `.env`。

- 若使用 Docker Compose：在 PHP 服務透過 `env_file` 或 `environment` 注入，再重新建立容器；只重新啟動舊容器不會更新環境變數。
- 若直接使用 Apache/PHP-FPM：在服務或容器層設定環境變數，確認 PHP 執行程序讀得到。不要只在 SSH 的另一個終端設定。
- HTTPS 反向代理的站點必須把 `APP_BASE_URL` 設為正式 HTTPS 網址，確保登入 Cookie 使用 Secure。

## 二、Google API 與資料範圍

1. 開啟 https://aistudio.google.com/，選擇 FitConnect 專案，到 API Keys 建立新金鑰。
2. 在專案用量頁確認該模型可用及其額度。免費額度不是無限服務，且同專案共用。
3. 金鑰填入後端 `GEMINI_API_KEY`，不要傳給前端。
4. 檢查目前 Gemini 服務條款：https://ai.google.dev/gemini-api/terms 。免費服務不應提交敏感、機密或個人資料，且 API Client 有未滿 18 歲使用者限制。若網站會處理真人個人化資料，須先採用適用的服務方案與資料處理方式；付費也不會解除年齡限制。

AI 呼叫會傳送目前登入者的運動摘要（期間、次數、分鐘、估計熱量與運動種類）、使用者提問與最多六則近期對話，不傳姓名、Email、LINE ID、密碼雜湊或完整個人資料。摘要仍可能屬於個人資料，移除姓名不等於完全匿名；不要直接把正式真人資料拿到不適用的免費服務測試。

數字由 PostgreSQL 計算後直接顯示，AI 只補定性建議。模型若產生額外阿拉伯數字、截斷內容或無效格式，系統會拒絕該回覆；這能降低亂編數字，無法保證自然語言建議永遠正確。資料庫讀取失敗時不會假裝看過紀錄。

## 三、Resend 寄信設定

1. 登入 https://resend.com/，到 Domains 加入你能管理 DNS 的網域或寄信子網域。
2. 依畫面要求新增 DNS 紀錄（例如 DKIM/SPF），等待顯示 Verified。
3. 到 API Keys 建立寄信金鑰；設定 `RESEND_API_KEY` 與該網域下的 `RESEND_FROM_EMAIL`。
4. 新註冊帳號需完成 Email 驗證才可登入。舊帳號會保留原密碼與資料，但也需從登入頁「重寄驗證信」補驗證；沒有自動把舊信箱標為已驗證。

驗證信有效 24 小時，密碼重設信有效 30 分鐘；連結只可使用一次，資料庫只存連結 Token 的雜湊。重寄至少間隔 60 秒，另有限流。若註冊時寄信失敗，帳號仍保留，前端會明確提示稍後重寄。

若舊帳號使用無法收信的測試地址，需管理員先核實身分再修正信箱，不能自動跳過驗證。

郵件連結使用網址 `#` 之後的片段，避免 Token 出現在一般伺服器網址紀錄與 Referrer。開啟後需按確認驗證；郵件掃描器單純開啟網址不會消耗驗證。請確保首頁包含新版 JS，且正式網域導向不會丟失網址片段。

## 四、套用資料庫遷移

請先備份，再將新版程式部署到維護中的服務。於 PHP 容器或同環境的終端執行：

```sh
php db/migrate.php
```

正式上線應先停止舊 PHP 服務，使用已更新的映像執行一次性遷移，再啟動新版，請依 mini PC 部署步驟操作。下方 `exec` 只適用於容器內已經有新版程式、環境變數也已更新，而且站台仍在維護中的情況：

```sh
docker exec <PHP容器名稱> php /var/www/html/db/migrate.php
```

成功會看到 `Applied 20261022_accounts_workouts.sql` 與 `Database is up to date.`。同一份遷移可以重跑，已完成的項目不會重複執行。執行遷移的資料庫角色需有建表、ALTER 等權限。

Email 唯一性改為不區分大小寫。若遷移提示信箱重複（例如同時有 `User@example.com` 與 `user@example.com`），遷移會整筆回復；需先人工確認這些帳號的歸屬與處理方式，不會自動合併或刪除資料。
LINE 綁定亦檢查唯一性；若舊資料有同一個 LINE ID 綁定多個帳號，也需先人工核實，不會任意選擇其中一個帳號。

遷移會新增信箱驗證狀態、登入版本、一次性連結與限流資料表，以及紀錄體重與修改版本欄位；既有運動資料會保留，總排行榜會校正一次。日常 API 不再執行建表與全站總分重算。

若資料庫連線失敗，請先檢查 `DATABASE_URL`、網路與 SSL 設定，不要繼續開放新版。若要回復程式版本，先評估舊版本會重新執行全量總分計算，勿直接刪除新增欄位或資料表。

## 五、LINE LIFF 必要設定

1. 到 https://developers.line.biz/console/，開啟 LIFF 所屬 LINE Login Channel。
2. 從 Basic settings 取得 Channel ID，設為 `LINE_LOGIN_CHANNEL_ID`。
3. 檢查 LIFF App 的 Scope 包含 `openid`，並保留原本需要的權限。
4. 確認 Endpoint URL 指向目前正式網址的 `LIFF/index.php`，重新開啟 LIFF 並同意授權。

後端現在驗證 LINE ID Token，不再相信自行填寫的 `lineUserId`。LINE 綁定需要網站帳號已完成 Email 驗證。LINE 文字選單功能不變。

## 六、同步規則與手機/PWA

- 新增、修改與刪除會在同一筆資料庫交易中更新紀錄、該使用者總熱量與成就資格；失敗會一起回復。
- 修改或刪除後，不再符合門檻的成就會撤銷。日後再次達標可重新獲得；先前寄出的成就信無法收回。歷史排行榜快照保留當時資料，當前排行榜從目前資料計算。
- 新紀錄保存當時體重，日後修改種類或分鐘依該體重計算。舊紀錄沒有當時體重，修改種類或分鐘時採目前體重並提示；只改日期不更動原熱量。
- 週報計算本週一零時至查詢當下；比較上週相同經過時間。當日分析比較昨日相同時間。統一使用台北時區。
- 讀取報告不呼叫 Google，不消耗 AI 額度。「請 AI 解讀」才呼叫 Gemini。一般聊天也會重新讀取所選期間的後端資料。
- Service Worker 只快取指定靜態檔案，API、驗證連結與寫入不快取。安裝新版後需關閉舊分頁並重新開啟 PWA；舊版離線快取會在啟用新版時清除。
- Apache 請確保啟用 rewrite 且允許此專案的 `.htaccess` 生效，用以禁止瀏覽資料庫腳本、測試與設定檔。Dockerfile 已啟用 rewrite；若自行使用 Nginx，需在站台設定中對上述目錄與內部 PHP 檔加入等效拒絕規則。

## 七、上線驗收

1. 使用測試信箱註冊，收到驗證信；驗證後可登入，重複點擊連結應失敗。
2. 忘記密碼後收到重設信；重設成功後舊密碼不能登入，先前已登入的分頁也應失效。
3. 新增運動、修改分鐘與刪除，檢查歷史列表、分析、所有期間排行榜與週報一致。
4. 使用兩個帳號，確認不能修改或刪除對方紀錄，且報告不混用。
5. 在手機瀏覽器與已安裝 PWA 測試列表、修改視窗、快捷報告、聊天輸入與返回登入；Android/iOS 實機鍵盤和安全區仍應實機驗收。
6. 檢查 Google 用量與 Resend 郵件送達紀錄。不要以只有 PHP 語法檢查通過就認定金鑰、DNS、郵件與正式網路連線已驗證。

## 本機可重跑測試

安裝隔離測試依賴（不會進正式容器）：

```sh
npm install --prefix .test-runtime --ignore-scripts @electric-sql/pglite @electric-sql/pglite-socket
node tests/integration.cjs --ui
```

測試使用記憶體中的 PGlite PostgreSQL 與本機 PHP，結束後清除；不連正式資料庫、不呼叫 Google、不寄真實郵件。若不同電腦，設定 `PHP_BIN` 為有 mbstring、curl、pdo_pgsql 的 PHP 執行檔；UI 測試另以 `PLAYWRIGHT_PATH` 指向已安裝的 Playwright。PGlite 不能代替正式 PostgreSQL 的多連線併發壓力測試。

本次另外使用真正的 PostgreSQL 18 執行相同驗證（Windows 測試套件僅放 `.test-runtime`，未註冊系統服務）：

```sh
npm install --prefix .test-runtime --ignore-scripts @embedded-postgres/windows-x64 pg
node tests/integration.cjs --native --ui
```

UI 測試目前使用已安裝的 Microsoft Edge。`--native` 會建立臨時資料目錄，測試結束後停止 PostgreSQL 並刪除該臨時目錄；不會接觸原有資料庫。

## 本機預覽

```sh
node tests/integration.cjs --native --preview
```

網址為 `http://127.0.0.1:8094`。這是隔離的範例資料，帳號 `athlete-a@example.test`，密碼 `FitconnectTest123!`。不會寄真實郵件或使用真實 Gemini 金鑰。可操作紀錄列表、修改、刪除、週報與當日分析。

若預覽在終端執行，按 Ctrl+C 關閉。若由背景啟動，在專案目錄執行以下 PowerShell 指令可通知預覽停止並清除其臨時資料庫：

```powershell
New-Item .test-runtime/stop-preview -ItemType File -Force
```

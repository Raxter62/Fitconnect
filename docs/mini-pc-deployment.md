# FitConnect：mini PC / Docker Compose 上線步驟

## 先確認這次要做什麼

- PHP 網站與 PostgreSQL 都留在你自己的 mini PC，不建立新的正式資料庫、不遷往雲端。
- 程式透過 PHP 的 `getenv()` 讀環境變數。`config.php` 是讀取設定的程式，可以放 Git；真正的密碼與金鑰不能放 Git。
- 只有 Google Gemini、Resend 與 LINE 是外部 API。使用 Gemini 不代表把整個資料庫搬到 Google。
- 目前電腦上的 `http://127.0.0.1:8094` 是隔離的測試預覽，不是 mini PC 的正式站，也不是正式會員資料。

下方 `<PHP服務名稱>`、`<DB服務名稱>`、`<DB帳號>`、`<DB名稱>` 都要換成你的實際值，不能直接照貼尖括號。尚未取得你的 Compose 檔，因此不猜服務名稱、網域、資料庫密碼或 volume 路徑。

## 1. 先在開發電腦整理 Git

### 應提交到 GitHub

| 類別 | 檔案或目錄 |
| --- | --- |
| 網站與 API | 根目錄的正式 PHP、`index.html`、`LIFF/`、`LLM/`、`public/` |
| 帳號與報告新功能 | `auth.php`、`reports.php`、`public/js/features.js`，以及這次修改的既有程式 |
| 資料庫結構與升級程式 | `db/schema.sql`、`db/migrate.php`、`db/migrations/20261022_accounts_workouts.sql` |
| PWA | `manifest.json`、`service-worker.js`、圖示與其他靜態素材 |
| 部署規則 | `Dockerfile`、`.htaccess`、`.gitignore`、`.dockerignore`、只有空值/假資料的 `.env.example` |
| 自架設定 | 不含真密碼與金鑰的 `compose.yaml` / `docker-compose.yml`，以及需要的非機密反向代理設定 |
| 說明與測試原始碼 | `docs/`、`illustrate/`、`tests/` |
| 本地圖示套件 | `public/vendor/lucide.min.js` 與 `lucide.LICENSE`，兩個都需要；不是可刪的測試依賴 |

目前儲存庫沒有正式 Compose 檔。上傳前先把現有 Compose 裡的密碼改成 `${變數名稱}` 或 `env_file`，不可直接把伺服器檔案原樣貼上 GitHub。若 Compose 在另一個私人維運專案，可留在原處，不必搬進這個專案。

### 不應提交，留在自己的伺服器

| 類別 | 範例與注意事項 |
| --- | --- |
| 真實環境變數 | `.env`、`.env.php`、`.env.production`；範本 `.env.example` 例外 |
| 私密憑證 | `*.key`、`*.pem`、`credentials*.json`、`service-account*.json`、`secrets/`、`.secrets/` |
| 資料庫內容 | Docker named volumes、`pgdata/`、`postgres-data/`、`.volumes/`；這些不是程式碼 |
| 正式資料備份 | `backups/`、`*.dump`、`*.backup`、`*.sql.gz`；純文字 SQL 備份也請放 `backups/` |
| 執行產物 | `logs/`、`*.log`、`tmp/`、`cache/` |
| 本機測試產物 | `.test-runtime/`、`test-results/`、`node_modules/` |
| 私人機器覆寫 | `compose.override.yaml/yml`、`docker-compose.override.yaml/yml`；預設忽略，若要分享先改成不含機密的範本 |
| 開發診斷工具 | `db_test.php`、`test_email.php`，不需要部署到正式站 |

**不要把所有 `*.sql` 都忽略。** 結構與遷移 SQL 要版本控管，只有真實資料匯出不應提交。若你的實際 PostgreSQL bind mount 不叫上述名稱，要把實際資料目錄另外加入 `.gitignore` 與 `.dockerignore`；最好放在程式目錄外。

這次已移除「整個 `/docs` 都忽略」的規則，讓教學與部署說明可以提交；它們仍不會進正式 Docker 映像。新增的資料目錄與憑證忽略規則也同步加入 Docker 建置排除。

### 特別注意：兩個檔案已經被 Git 追蹤

檢查發現 `db_test.php`、`test_email.php` 雖然在 `.gitignore` 裡，**仍已受 Git 追蹤**。忽略規則不會自動取消既有追蹤。你可以在開發電腦執行以下指令，只從 Git 移除、保留本機檔案：

```sh
git rm --cached -- db_test.php test_email.php
```

此操作會在下一次提交刪除儲存庫中的兩支工具，伺服器更新時也會移除它們；不會刪正式 API。我沒有替你執行這個指令，也沒有替你提交或推送。

接著檢查並提交這次程式變更：

```sh
git status --short
git diff --check
git add -A
git diff --cached --stat
git diff --cached
git commit -m "Add Gemini coach, workout management and account verification"
git push
```

執行 `git add -A` 前先確認上方忽略規則已生效。`git diff --cached` 是讓你在自己的電腦檢查內容，不要把帶有金鑰的輸出貼到對話。曾提交過的密碼即使現在刪除仍可能留在 Git 歷史，必須撤銷或輪替；不能只加 ignore 就算處理完成。

## 2. 到 mini PC 找到原本的 Compose 專案

進入原本啟動 FitConnect 的 Compose 目錄，使用同一組 `-f`、`--env-file` 與專案名稱設定。不要另開新目錄啟動一套同名資料庫。

```sh
docker compose config --services
docker compose ps
git status --short
```

記下網站 PHP 與 PostgreSQL 的**服務名稱**，不是隨機產生的容器 ID。以下指令都假設 Compose 可以從這個目錄直接找到；若平常有指定 `-f`，每一步都要保留。

若 Git 顯示伺服器有本地修改，先確認、備份與整理，不要用強制重設覆蓋。若不是 Git checkout，而是由其他工具部署映像，請沿用該工具的更新流程，不能直接套用下方 `git pull`。

不要把完整 `docker compose config`、`docker inspect` 或 `printenv` 輸出貼出來，可能包含密碼。`config --services` 只列服務名，`config --quiet` 只驗證設定。

## 3. 維護模式與備份，資料庫不要停掉或重建

先讓反向代理顯示維護畫面（若原本已有此功能），停止舊 PHP 服務，避免備份後又有新的寫入：

```sh
docker compose stop <PHP服務名稱>
```

PostgreSQL 繼續運行。如果還有其他程式會寫入這個資料庫，也要先暫停那些寫入。

在 PostgreSQL 容器內產生備份，帳號與資料庫名稱沿用現有設定：

```sh
docker compose exec <DB服務名稱> pg_dump -U <DB帳號> -d <DB名稱> --format=custom --file=/tmp/fitconnect-before-upgrade.dump
docker compose exec <DB服務名稱> pg_restore --list /tmp/fitconnect-before-upgrade.dump
```

若要求密碼，使用你原本的資料庫認證，不要把密碼直接寫進指令。備份失敗就先停在這裡，不要執行遷移。

在主機建立 `backups/` 資料夾後，將備份複製出容器：

```sh
docker compose cp <DB服務名稱>:/tmp/fitconnect-before-upgrade.dump backups/fitconnect-before-upgrade.dump
```

檢查主機備份非空，最好再存一份到受保護的另一台設備。`pg_restore --list` 只是可讀性檢查，不等於完整還原演練。另備份原本 Compose 與環境檔，限制檔案權限，勿提交 GitHub。若有舊的同名備份，改用不同日期檔名，不要覆寫唯一備份。

**不要執行 `docker compose down -v`、清除 volume、刪除資料目錄，或為了升級網頁更換 PostgreSQL 大版本。**

## 4. 拉新版程式，保留原本 Compose 與資料位置

確認開發電腦已推送後，在 mini PC 的程式 checkout 執行：

```sh
git pull --ff-only
```

若出現衝突就停止處理，不能強行覆蓋。保留現有 PostgreSQL 的映像大版本、資料 volume、資料庫名稱、使用者、密碼、network 與 Compose 專案名稱。這次不是建立空白資料庫。

## 5. 將環境變數交給 PHP 服務

### 環境檔與 Compose 的差別

- `.env.example`：程式設定欄位的空白範本，可提交。
- `.env`：Compose 通常會拿它做 `${名稱}` 替換；不代表所有欄位都會進 PHP 容器。
- `env_file` / `environment`：明確把變數交給指定服務，PHP 才能透過 `getenv()` 讀取。

你可以沿用現有 PHP 的變數注入方式。若尚未設定，建議在 **Compose 檔同一目錄** 建立私人 `.env.php`，從新版 `.env.example` 參考欄位填寫；不要覆蓋既有 `.env`。在現有 PHP 服務下合併以下設定，而不是用這個片段取代整份 Compose：

```yaml
services:
  web: # 換成原本的 PHP 服務名稱
    env_file:
      - ./.env.php
```

若原服務已有 `env_file`，將必要欄位加到它原本讀取的檔案即可。若同名變數也寫在 `environment`，`environment` 的設定優先，不能讓舊值或空值蓋掉新檔案。不要把 PHP 專用 API 金鑰也傳進 PostgreSQL 服務。

主機上有一份 `.env.php` 並不代表網頁訪客可讀；仍應限制權限。Linux 上可依實際執行身分設為擁有者讀寫，例如 `chmod 600 .env.php`；部署帳號必須能讀取。此檔不進 Git、不進 Docker 映像，啟動時才由 Compose 注入。主機的 Docker 管理員仍可能讀取容器環境；環境變數不是加密保險箱。

### 要填哪些值

| 名稱 | 在自己的 mini PC 要填什麼 |
| --- | --- |
| `DATABASE_URL` | 優先沿用目前有效的 PostgreSQL 連線字串，不要照抄範本的假帳密 |
| `DB_PASSWORD` | 選填；若設定會覆蓋 URL 內的密碼，必須與現有 DB 帳號相同；不是 PostgreSQL 初始化用的 `POSTGRES_PASSWORD` |
| `APP_BASE_URL` | 真正對外的 HTTPS 網址，例如 `https://fitconnect.example.com`；不能用本機預覽網址 |
| `APP_ENV` | `production` |
| `GEMINI_API_KEY` | 新建且未公開的 Google 金鑰；先前在對話貼出的必須撤銷 |
| `GEMINI_MODEL` | 你的 Google 專案可用的模型 ID；範本預設以實際可用性為準 |
| `RESEND_API_KEY` | Resend 寄信金鑰 |
| `RESEND_FROM_EMAIL` | 已通過 Resend 網域驗證的寄件地址 |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 LINE Login Channel 的 Channel ID，不是 Messaging API Channel ID |
| `LIFF_ID`、既有 LINE 變數 | 保留目前有效設定 |

不要在已初始化的 PostgreSQL volume 上隨意更改 `POSTGRES_PASSWORD`，它不是替既有帳號改密碼的方式。不要誤把 API 金鑰加進 `index.html`、前端 JS 或 Dockerfile。

若舊設定使用 `SUPABASE_DB_PASSWORD`，新版改讀通用的 `DB_PASSWORD`，請把同一個有效密碼移至 `DB_PASSWORD`；沒有用到舊變數就不需新增。`OPENAI_API_KEY`、`OPENAI_MODEL` 已不使用，可從 PHP 服務設定移除。

### `DATABASE_URL` 的主機與 SSL

同一 Docker network 裡，PHP 應使用 PostgreSQL 的**服務名稱與容器內連接埠**。例如資料庫服務叫 `db`，容器內埠是 `5432`，URL 的主機應為 `db:5432`，不是某個會變動的容器 IP。不同 Compose 專案需要現有共用 network；不要只改一個主機名就假設能連。

PHP 容器內的 `127.0.0.1` 是 PHP 容器自己，不是 mini PC 主機，也不是另一個 DB 容器（使用 host networking 等特殊設定者另論）。不要為了容器互連將 PostgreSQL 的 5432 暴露到公網。

若你現有 PostgreSQL 在受控 Docker 私人網路、沒有設定 TLS，URL 可明確包含 `?sslmode=disable`。若已配置 TLS，沿用可用的 SSL 驗證與憑證設定；跨不可信網路不能關閉 SSL。`config.php` 未指定時仍預設 `require`，不會自動把所有環境都改成不加密。

密碼直接放在 URL 時，`@`、`#`、`/` 等特殊字元要做 URL 編碼；或將原始密碼放 `DB_PASSWORD`。Compose 環境檔含 `$` 等特殊字元時注意插值規則，必要時使用單引號保留原值，並在自己的主機驗證，勿公開輸出密碼。

修改後先驗證設定語法：

```sh
docker compose config --quiet
```

## 6. 建置新版 PHP，再執行一次性遷移

下列以現有 PHP 服務使用本專案 Dockerfile 的 `build` 為前提，既有 build context 必須指向剛更新的程式目錄：

```sh
docker compose build <PHP服務名稱>
docker compose run --rm --no-deps <PHP服務名稱> php -m
docker compose run --rm --no-deps <PHP服務名稱> php /var/www/html/db/migrate.php
```

`php -m` 應包含 `PDO`、`pdo_pgsql`、`curl`、`mbstring`。這個臨時 PHP 容器使用該服務的環境與 network，連到原本仍在運行的 PostgreSQL；`--no-deps` 不啟停資料庫，`--rm` 只刪除此臨時容器。

若目前 PHP 服務只有 `image:` 而沒有 `build:`，先經原本的映像建置/發佈流程取得包含這次程式的新映像，再 `docker compose pull <PHP服務名稱>`；不能用舊映像跑遷移。若有程式 bind mount，也要確定容器內看到新版檔案，不被舊掛載蓋掉。

首次成功應顯示：

```text
Applied 20261022_accounts_workouts.sql
Database is up to date.
```

如果遷移已執行過，只會確認已是最新版。它會保留既有資料、新增欄位與表格，並校正一次總分。登入的 DB 角色需有建表與修改結構權限。

出現大小寫重複 Email 或重複 LINE 綁定時，遷移會回復而不自動刪帳號；先人工確認歸屬。任何錯誤都先停下，保留維護狀態，不要硬啟動新版，也不要自行刪表。

## 7. 只重新建立 PHP 服務

遷移成功後：

```sh
docker compose up -d --no-deps --force-recreate <PHP服務名稱>
docker compose ps
docker compose logs --tail=80 <PHP服務名稱>
```

這樣新環境變數才會套用，單純 `docker compose restart` 不會載入更新的容器環境設定。不需要重建 PostgreSQL。紀錄仍可能包含個人資料，分享前先遮蔽。

## 8. 正式網址驗收後再解除維護

1. 先設定好 Resend 的寄信網域/DNS，再用測試信箱確認驗證信與忘記密碼信可收到。舊帳號資料保留，但也需「重寄驗證信」完成驗證才可登入。
2. `APP_BASE_URL` 必須指向正式 HTTPS 網域；確認郵件連結開回同一個站。不要把正式站設成 `localhost`。
3. LINE LIFF Scope 加上 `openid`，`LINE_LOGIN_CHANNEL_ID` 填正確；驗證後的網站帳號測試綁定與新增紀錄。
4. 用測試帳號新增、修改、刪除紀錄，對照圖表、總排行榜/期間排行榜、成就與週報。查週報本身不耗 Google 額度。
5. 確認 Gemini 專案的模型、額度、金鑰權限與適用的資料條款，再測試「請 AI 解讀」；免費服務不是無限額，也不能因去掉姓名就視為匿名資料。詳細範圍見功能部署說明。
6. 網址測試 `/.env`、`/.env.php`、`/db/schema.sql`、`/config.php`、`/tests/contracts.php` 應為拒絕存取或不存在，不能顯示內容。`.htaccess` 必須生效；若換用 Nginx，它不會讀 `.htaccess`，需等效拒絕規則。
7. 手機瀏覽器和已安裝 PWA 都關閉重開，確認新列表、修改視窗與聊天版面。不要清除伺服器資料庫來解決舊前端快取。

Gemini、Resend、LINE 的申請與設定細節見 [新功能部署說明](2026-10-feature-deployment.md)。正式寄信、實際外部 API 與你的反向代理需要在 mini PC 驗收；本機測試通過不代表那些服務已設定成功。

## 官方參考

- [Compose 環境變數注入](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Compose 服務間網路與主機名稱](https://docs.docker.com/compose/how-tos/networking/)
- [Compose 一次性 run 指令](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Git ignore 與已追蹤檔案](https://git-scm.com/docs/gitignore)

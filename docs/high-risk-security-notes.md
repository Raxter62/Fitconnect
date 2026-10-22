# FitConnect 高風險問題修復筆記

這份文件用 0 基礎角度說明這次修掉的高風險問題。你可以先把網站想成一間健身房：

- 前端 JavaScript 是櫃台與按鈕。
- PHP API 是櫃台後面的工作人員。
- PostgreSQL 資料庫是會員資料櫃。
- Session 是「這個瀏覽器目前是誰」的臨時識別證。

## 1. 錯誤訊息外洩

### 白話

網站出錯時，不應該把「資料庫錯在哪、程式檔案路徑、行號」直接顯示給使用者。這些資訊對正常使用者沒有幫助，但對攻擊者很有用。

### 技術說明

以前 `submit.php` 的 catch 區塊會回傳類似 `file`、`line`、完整 database error。這叫做 error information disclosure。攻擊者可以利用這些訊息猜資料表名稱、欄位名稱、伺服器路徑。

### 這次修法

- `submit.php` 新增 `fc_api_error_payload()`。
- `config.php` 新增 `fc_is_debug_env()`。
- 只有 `APP_ENV=dev`、`development`、`local` 時才回傳詳細錯誤。
- 正式環境只回傳簡短錯誤，例如 `Database error` 或 `Server error`。

## 2. 重要動作沒有強制 POST 與 CSRF

### 白話

查資料可以用 GET，但「新增、修改、刪除、登出、綁定」這些會改資料的動作，應該只能用 POST。否則使用者點到惡意圖片、連結或第三方頁面時，有機會被偷偷觸發操作。

CSRF 可以想成「每次登入後，網站發一張只有自己知道的暗號卡」。前端送出修改請求時要附上暗號，後端確認暗號正確才接受。

### 技術說明

CSRF 是 Cross-Site Request Forgery。攻擊者不一定知道你的密碼，但可以誘導你的瀏覽器帶著既有 cookie 對 FitConnect 發請求。如果 API 只看 session cookie，不檢查 token，就可能被偽造操作。

### 這次修法

- `submit.php` 新增 `requirePost()`，重要 action 必須是 POST。
- `submit.php` 新增 `csrfToken()` 與 `requireCsrf()`。
- 登入成功後回傳 `csrf_token`。新版註冊需先完成 Email 驗證，不會自動登入。
- `public/js/main.js` 用 `authJsonHeaders()` 幫 POST 加上 `X-CSRF-Token`。
- `logout`、`update_profile`、`update_avatar`、`add_workout`、`generate_bind_code`、`line_unbind`、`ai_coach` 都受保護。

## 3. XSS：把資料直接塞進 innerHTML

### 白話

如果把使用者名字、成就名稱、排行榜名字直接當 HTML 插入頁面，壞人可能把名字改成一段 `<script>` 或惡意 HTML，讓別人的瀏覽器執行。

### 技術說明

XSS 是 Cross-Site Scripting。危險點通常是：

- `element.innerHTML = 使用者資料`
- template string 裡面直接放 API 回傳資料
- 沒檢查就把資料塞到 `src`、`href` 等屬性

### 這次修法

- 排行榜列 `renderRow()` 改用 `document.createElement()` 與 `textContent`。
- 成就通知 `showAchievementNotification()` 改用 DOM 建立，不再把 title 直接塞進 HTML。
- 成就圖片檔名加上格式白名單，只允許英數字、`.`、`_`、`-`。
- 編輯個人資料彈窗不再把暱稱、身高、體重直接寫進 HTML attribute，改成建立後用 `.value` 指派。

## 4. 測試工具公開暴露

### 白話

像 `db_test.php`、`test_email.php` 這類檔案是開發時看資料庫或寄信測試用，不應該讓正式網站訪客能直接打開。

### 技術說明

Debug endpoint 常常會洩漏環境變數、資料庫連線狀態、第三方服務設定。就算它本身沒有密碼，也會降低攻擊難度。

### 這次修法

- `db_test.php`
- `test_email.php`
- `view_qr.php`

這三個檔案都加上：

```php
if (getenv('ALLOW_DEBUG_TOOLS') !== '1') {
    http_response_code(404);
    exit('Not found');
}
```

意思是：除非環境變數明確設定 `ALLOW_DEBUG_TOOLS=1`，否則外界看到的就像檔案不存在。

## 5. 資料同步與資料庫衝突

### 白話

如果資料庫裡有「運動紀錄總熱量」這種加總表，但舊資料沒有補進去，排行榜或統計就會和實際紀錄不同步。

另外，如果同一時間發生兩次成就解鎖，不能讓其中一次把整個新增運動流程炸掉。

### 技術說明

這類問題不是畫面錯，而是資料來源之間不同步：

- `workouts` 是每筆運動紀錄。
- `user_totals` 是每個使用者累積總熱量。
- 如果只從某一天之後才開始寫 `user_totals`，舊的 `workouts` 就不會被算進總排行榜。

### 這次修法

- 新版改由 `php db/migrate.php` 明確執行結構更新與一次性的總熱量回填，不在每次 API 請求中建表或重算全站。
- 遷移會建立不分大小寫的 Email 唯一索引與 LINE 綁定唯一索引；舊資料若有衝突會中止並回復，必須先人工確認，不能自動合併。
- 新增、修改與刪除運動時，在同一筆交易中更新該使用者總分與成就；任何一步失敗會一起回復。
- `mail.php` 的成就新增改成 `ON CONFLICT DO NOTHING`，避免同一成就重複新增時丟錯。
- `submit.php` 的 `get_stats` 發生資料庫錯誤時改回 HTTP 500，不再假裝成功回空資料。

## 可優化 7：inline onclick、inline style、innerHTML 是什麼？

### inline onclick

像這樣直接寫在 HTML 裡：

```html
<button onclick="saveProfile()">儲存</button>
```

優點是初學者容易懂。缺點是 JavaScript 和 HTML 綁太緊，之後要重構、測試、套安全政策會比較麻煩。更乾淨的寫法是用 `addEventListener()`。

### inline style

像這樣直接把 CSS 寫在元素上：

```html
<button style="color: white;">儲存</button>
```

優點是快速。缺點是樣式分散在很多地方，之後要統一設計會比較難。更好的長期做法是放到 `public/css/style.css`，用 class 管理。

### innerHTML

`innerHTML` 是把一段字串當成 HTML 放進頁面：

```js
box.innerHTML = '<p>Hello</p>';
```

如果字串完全是自己寫死的，風險較低。如果字串裡混到使用者資料或 API 資料，就要非常小心，因為瀏覽器可能把惡意內容當成 HTML 執行。安全做法是：

```js
const p = document.createElement('p');
p.textContent = userName;
box.appendChild(p);
```

這次沒有大規模重構所有 inline onclick/style，因為你指定先解釋；但已經把會混入使用者/API 資料的高風險 `innerHTML` 改掉。

# FitConnect (WTF text) 系統架構文檔

## 1. 系統架構圖 (System Architecture)

本專案採用前後端分離的概念，但部署於單一 Railway 服務（PHP/Apache）。

```mermaid
---
config:
  theme: neutral
  look: neo
  layout: elk
---
flowchart TB
 subgraph Frontend["Frontend (Browser/PWA)"]
        Index["index.html"]
        MainJS["main.js (Logic/Auth)"]
        AIChatJS["ai_chat.js (Chat UI)"]
        SW["service-worker.js (PWA Cache)"]
  end
 subgraph Services["Internal Services"]
        MailPHP["mail.php (Resend Wrapper)"]
        CoachPHP["LLM/coach.php (AI Logic)"]
        Config["config.php (Env Vars)"]
  end
 subgraph Backend["Backend (Railway / Apache + PHP)"]
        SubmitPHP["submit.php (Main API Gateway)"]
        LineWebhook["linebot_webhook.php (LINE Bot)"]
        Services
  end
 subgraph External["External Services"]
        Supabase["🗄️ Supabase (PostgreSQL)"]
        ResendAPI["📧 Resend API (Email)"]
        OpenAI["🧠 LLM API (AI Coach)"]
        LinePlatform["🟢 LINE Platform"]
  end
    UserMobile["📱 User (Mobile/PWA)"] --> Index
    UserDesktop["💻 User (Desktop)"] --> Index
    Index --> MainJS
    MainJS -- HTTP POST (JSON) --> SubmitPHP
    AIChatJS -- HTTP POST --> SubmitPHP
    SW -.-> Index
    SubmitPHP --> Config & MailPHP & CoachPHP
    LineWebhook --> Config & CoachPHP
    SubmitPHP -- PDO/SQL --> Supabase
    LineWebhook -- PDO/SQL --> Supabase
    MailPHP -- API Request --> ResendAPI
    CoachPHP -- API Request --> OpenAI
    LinePlatform -- Webhook POST --> LineWebhook
    LineWebhook -- Reply API --> LinePlatform
    LineUser["💬 LINE App User"] --> LinePlatform

    style Services stroke:#FFE0B2,fill:#FFE0B2
    style Backend stroke:#FFD600,fill:#FFD600
    style Frontend stroke:#2962FF,fill:#2962FF
    style External stroke:#00C853,fill:#00C853
```

---

## 2. 核心流程圖 (Core Processes)

### 2.1 登入與註冊流程 (Auth Flow)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend (main.js)
    participant API as submit.php
    participant DB as Supabase

    Note over U, FE: 註冊流程
    U->>FE: 輸入 Email, 密碼, 暱稱
    FE->>API: POST ?action=register
    API->>DB: 檢查 Email 是否重複
    alt Email 重複
        API-->>FE: Return Error
        FE-->>U: 顯示錯誤訊息
    else Email 可用
        API->>API: Hash Password
        API->>DB: INSERT users
        API->>API: Set $_SESSION['user_id']
        API-->>FE: Return Success (Auto Login)
        FE->>U: 跳轉至主控台 (Dashboard)
    end

    Note over U, FE: 登入流程
    U->>FE: 輸入 Email, 密碼
    FE->>API: POST ?action=login
    API->>DB: SELECT user by Email
    API->>API: Verify Password Hash
    alt 驗證成功
        API->>API: Set $_SESSION['user_id']
        API-->>FE: Return Success
        FE->>FE: checkLogin() (Auto Redirect)
    else 驗證失敗
        API-->>FE: Return Error
    end
```

### 2.2 運動紀錄與 AI 教練流程 (Workout & AI)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend
    participant API as submit.php
    participant AI as LLM/Coach
    participant DB as Supabase

    Note over U, DB: 新增運動紀錄
    U->>FE: 填寫運動資料 (時間/種類)
    FE->>API: POST ?action=add_workout
    API->>DB: INSERT workout_logs
    API->>DB: UPDATE user_totals (Accumulate)
    API-->>FE: Return Success
    FE->>U: 更新圖表 & 排行榜

    Note over U, DB: 問 AI 教練
    U->>FE: 發送訊息 "怎麼減肥?"
    FE->>API: POST ?action=ai_coach
    API->>DB: Get recent logs (Context)
    API->>AI: generate_coach_advice(Context + Query)
    AI-->>API: Response "多做重訓..."
    API-->>FE: Return AI Response
    FE->>U: 顯示氣泡框回覆
```

### 2.3 LINE 綁定流程 (LINE Binding)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend
    participant API as submit.php
    participant LB as LineWebhook
    participant LINE as LINE App
    participant DB as Supabase

    U->>FE: 點擊 "產生綁定碼"
    FE->>API: POST ?action=generate_bind_code
    API->>API: Generate Random Code (e.g. 123456)
    API->>DB: Save code + user_id (Temporarily)
    API-->>FE: Return Code
    FE->>U: 顯示 Code & QR Code
    U->>LINE: 掃碼加入好友
    LINE->>LB: User sends "123456"
    LB->>DB: Search code
    alt Code Valid
        DB-->>LB: Return user_id
        LB->>DB: UPDATE users SET line_user_id = ...
        LB->>LINE: Reply "綁定成功！"
        Note over FE: 前端 Polling 偵測到綁定完成
        FE->>U: 顯示 "已綁定" 狀態
    else Code Invalid
        LB->>LINE: Reply "無效的代碼"
    end
```

---

## 3. 資料庫實體關係圖 (Database ER Diagram)

```mermaid
erDiagram
    users ||--o{ workouts : "records"
    users ||--o{ email_notifications : "receives"
    users ||--o{ achievements : "unlocks"
    users ||--o{ leaderboard_snapshots : "has_history"
    users ||--|| user_totals : "has_cache"

    users {
        int id PK "Serial ID"
        string email "Unique Email"
        string password_hash "Hashed Password"
        string display_name "User Nickname"
        string line_user_id "LINE User ID"
        string line_bind_code "Binding Code"
        datetime line_bind_code_expires_at "Code Expiry"
        int height "Height in cm"
        int weight "Weight in kg"
        int avatar_id "Avatar ID"
        datetime created_at "Registration Time"
    }

    workouts {
        int id PK "Serial ID"
        int user_id FK "User Reference"
        datetime date "Workout Date"
        string type "Workout Type"
        int minutes "Duration"
        int calories "Burned Calories"
        datetime created_at "Record Time"
    }

    user_totals {
        int user_id PK, FK "User Reference"
        bigint total_calories "Cached Total Calories"
    }

    leaderboard_snapshots {
        int id PK "Serial ID"
        date date "Snapshot Date"
        int user_id FK "User Reference"
        int rank "Rank on Date"
        int total_minutes "Total Minutes on Date"
        datetime created_at "Snapshot Time"
    }

    email_notifications {
        int id PK "Serial ID"
        int user_id FK "User Reference"
        string type "Email Type"
        datetime created_at "Creation Time"
        datetime sent_at "Sent Time"
    }

    achievements {
        int id PK "Serial ID"
        int user_id FK "User Reference"
        string type "Achievement Type"
        datetime unlocked_at "Unlock Time"
    }
```
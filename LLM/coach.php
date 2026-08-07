<?php
// LLM/coach.php
require_once __DIR__ . '/../config.php';

/**
 * Configuration:
 * - OPENAI_API_KEY: Set in Railway Variables.
 * - OPENAI_MODEL: Default 'gpt-4o'.
 * - COACH_REFUSAL_TEXT: Optional custom refusal message.
 */

function coach_refusal_text(): string {
    return getenv('COACH_REFUSAL_TEXT') ?: '這個問題和運動無關，我沒辦法回答喔，我可以給您運動建議、訓練計畫、動作/恢復、熱量消耗、運動消耗比例、營養建議、睡眠恢復等相關的問題';
}

function openai_model(): string {
    return getenv('OPENAI_MODEL') ?: 'gpt-4o';
}

/**
 * Determine if the query is related to the coach's domain.
 */
function is_coach_related(string $text): bool {
    $t = mb_strtolower($text, 'UTF-8');

    $keywords = [
        // Sport / Training
        '運動','健身','訓練','跑步','慢跑','衝刺','重訓','重量訓練','深蹲','硬舉','臥推',
        '游泳','腳踏車','自行車','瑜珈','有氧','無氧','核心','拉伸','伸展','恢復',
        // Metrics / Nutrition
        '卡路里','熱量','消耗','tdee','bmr','代謝','減脂','增肌','體脂','bmi','體重','身高',
        '蛋白質','碳水','脂肪','飲食','補給','睡眠','休息','心率','配速','步數',
        // Context
        'ai教練','教練','菜單','訓練計畫','運動建議','熱量比例'
    ];

    foreach ($keywords as $k) {
        if (mb_strpos($t, mb_strtolower($k, 'UTF-8')) !== false) return true;
    }
    return false;
}

/**
 * Get PDO connection.
 * Uses global $pdo from config.php if available.
 */
function get_coach_pdo(): PDO {
    global $pdo;
    if (isset($pdo) && $pdo instanceof PDO) {
        return $pdo;
    }

    // Fallback: This shouldn't happen if config.php is loaded correctly,
    // but useful for isolated testing.
    $url = getenv('DATABASE_URL');
    if ($url) {
        $parts = parse_url($url);
        $dsn = "pgsql:host=" . ($parts['host'] ?? 'localhost') .
               ";port=" . ($parts['port'] ?? 5432) .
               ";dbname=" . ltrim($parts['path'] ?? '', '/') .
               ";sslmode=require";
        return new PDO($dsn, $parts['user'] ?? '', $parts['pass'] ?? '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    throw new Exception("Database connection not available.");
}

function table_exists(PDO $pdo, string $table): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = :t LIMIT 1");
    $stmt->execute([':t' => $table]);
    return (bool)$stmt->fetchColumn();
}

/**
 * Build context string for the user.
 */
function build_user_context(PDO $pdo, int $userId): array {
    // 1. Profile
    $profileText = "（查無此使用者資料）";
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $userId]);
    $u = $stmt->fetch();

    if ($u) {
        $name   = $u['display_name'] ?? "User{$userId}";
        $height = $u['height'] ?? '未設定';
        $weight = $u['weight'] ?? '未設定';
        
        $profileText = "使用者：{$name}\n身高：{$height} cm\n體重：{$weight} kg";
    }

    // 2. Workouts
    $historyText = "（無近期運動紀錄）";
    $stmt = $pdo->prepare("
        SELECT date, type, minutes, calories 
        FROM workouts 
        WHERE user_id = :id 
        ORDER BY date DESC 
        LIMIT 30
    ");
    $stmt->execute([':id' => $userId]);
    $rows = $stmt->fetchAll();

    if ($rows) {
        $lines = [];
        foreach ($rows as $r) {
            // Force timezone to Asia/Taipei for display
            $dt = new DateTime($r['date']);
            $dt->setTimezone(new DateTimeZone('Asia/Taipei'));
            $ts = $dt->format('Y-m-d H:i');
            
            $type = $r['type'];
            $min  = $r['minutes'];
            $kcal = $r['calories'];
            $lines[] = "- {$ts} {$type} / {$min}分鐘 / {$kcal}大卡";
        }
        $historyText = implode("\n", $lines);
    }

    return [$profileText, $historyText];
}

/**
 * Extract text from OpenAI Chat Completion response.
 */
function extract_output_text(array $json): ?string {
    if (isset($json['choices'][0]['message']['content'])) {
        return $json['choices'][0]['message']['content'];
    }
    return null;
}

/**
 * Main Entry Point
 */
function askCoachFromDb(int $userId, string $userMessage): string {
    // 1. Domain Check
    if (!is_coach_related($userMessage)) {
        return coach_refusal_text();
    }

    // 2. Check Key
    $apiKey = defined('OPENAI_API_KEY') ? OPENAI_API_KEY : getenv('OPENAI_API_KEY');
    if (!$apiKey) return "錯誤：未設定 OPENAI_API_KEY。";

    // 3. Build Context
    try {
        $pdo = get_coach_pdo();
        [$profileText, $historyText] = build_user_context($pdo, $userId);
    } catch (Throwable $e) {
        $profileText = "（DB 讀取失敗）";
        $historyText = "（無法取得紀錄）";
    }

    // 4. Prompt Engineering
    $systemPrompt = 
"你是一位專屬運動/健康 AI 教練。你只能回答以下範圍：
- 運動建議、訓練計畫、動作/恢復
- 熱量消耗、運動消耗比例、營養（蛋白質/碳水/脂肪）、睡眠恢復
- 與 AI 教練或此平台紀錄/分析相關

如果使用者問題不在以上範圍，你必須只回：".coach_refusal_text()."

【使用者資料】
{$profileText}

【近期運動紀錄】
{$historyText}

回答指引：
1. 先給結論
2. 再給具體建議（條列式）
3. 如果缺少資料，問 1~2 個最關鍵的問題。
";

    // 5. Call OpenAI API (Chat Completions)
    $payload = [
        "model" => openai_model(),
        "messages" => [
            ["role" => "system", "content" => $systemPrompt],
            ["role" => "user", "content" => $userMessage]
        ],
        "temperature" => 0.4,
        "max_tokens" => 500
    ];

    $ch = curl_init("https://api.openai.com/v1/chat/completions");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "Authorization: Bearer {$apiKey}",
        ],
        CURLOPT_TIMEOUT => 30,
    ]);

    $raw = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($raw === false) return "連線錯誤：{$err}";

    $json = json_decode($raw, true);
    
    // Error Handling
    if (isset($json['error'])) {
        $msg = $json['error']['message'] ?? "Unknown Error";
        return "AI 呼叫失敗：{$msg}";
    }
    
    $text = extract_output_text($json);
    return $text ?: "AI 暫時無法回應，請稍後再試。";
}

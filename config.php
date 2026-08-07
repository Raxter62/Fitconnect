<?php
// config.php - 資料庫連線與全域設定
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

function fc_json_fatal(string $msg, ?string $detail = null): void {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => $msg,
        'error'   => $detail,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

function fc_env_str(string $key): string {
    $v = getenv($key);
    if ($v === false) return '';
    $v = trim($v);

    // 去掉前後引號（Railway UI 有時候貼上會不小心帶到）
    if ($v !== '' && (
        ($v[0] === '"' && substr($v, -1) === '"') ||
        ($v[0] === "'" && substr($v, -1) === "'")
    )) {
        $v = substr($v, 1, -1);
    }
    return trim($v);
}

// ---- 1) 讀 DATABASE_URL ----
$databaseUrl = fc_env_str('DATABASE_URL');
if ($databaseUrl === '') {
    fc_json_fatal('Missing DATABASE_URL', 'Please set DATABASE_URL to Supabase/Neon Postgres connection string.');
}

// 防呆：若你不小心還放著占位字
if (stripos($databaseUrl, '[YOUR-PASSWORD]') !== false || stripos($databaseUrl, 'YOUR_PASSWORD') !== false) {
    fc_json_fatal('DATABASE_URL still contains password placeholder', 'Replace [YOUR-PASSWORD] or set SUPABASE_DB_PASSWORD in Railway Variables.');
}

$dbConfig = parse_url($databaseUrl);
if ($dbConfig === false || !is_array($dbConfig)) {
    fc_json_fatal('Invalid DATABASE_URL (parse_url failed)', 'Check for quotes/spaces/newlines in Railway Variables.');
}

$scheme = strtolower((string)($dbConfig['scheme'] ?? ''));
if ($scheme === 'postgres' || $scheme === 'postgresql') $scheme = 'pgsql';

$host   = (string)($dbConfig['host'] ?? '');
$port   = (int)($dbConfig['port'] ?? 0);
$user   = isset($dbConfig['user']) ? rawurldecode((string)$dbConfig['user']) : '';
$pass   = isset($dbConfig['pass']) ? rawurldecode((string)$dbConfig['pass']) : '';
$dbname = isset($dbConfig['path']) ? rawurldecode(ltrim((string)$dbConfig['path'], '/')) : '';
$query  = (string)($dbConfig['query'] ?? '');

// ---- 2) Supabase 密碼覆蓋（避開 URL 特殊字元/encoding 地雷）----
$passOverride = fc_env_str('SUPABASE_DB_PASSWORD');
if ($passOverride === '') $passOverride = fc_env_str('DB_PASSWORD');
if ($passOverride !== '') {
    $pass = $passOverride; // 用原始密碼，不做 urldecode
}

// 基本檢查
if ($scheme !== 'pgsql') {
    fc_json_fatal('Unsupported scheme in DATABASE_URL', "scheme={$scheme}");
}
if ($host === '' || $user === '' || $dbname === '') {
    fc_json_fatal('Incomplete DATABASE_URL', 'host/user/dbname is missing.');
}
if ($port === 0) $port = 5432;

// ---- 3) DSN 組裝（強制 sslmode=require，避免某些環境握手不一致）----
parse_str($query, $q);
if (!isset($q['sslmode']) || $q['sslmode'] === '') {
    $q['sslmode'] = 'require';
}

$extraDsn = '';
if (!empty($q)) {
    $pairs = [];
    foreach ($q as $k => $v) {
        $pairs[] = $k . '=' . $v;
    }
    $extraDsn = ';' . implode(';', $pairs);
}

$dsn = "pgsql:host={$host};port={$port};dbname={$dbname}{$extraDsn}";

// ---- 4) 連線 ----
$pdo = null;
try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    fc_json_fatal('DB connection failed', $e->getMessage());
}

// ---- 5) 建表----
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            line_user_id TEXT,
            line_bind_code VARCHAR(10),
            line_bind_code_expires_at TIMESTAMPTZ,
            height NUMERIC(5,1),
            weight NUMERIC(5,1),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS workouts (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TIMESTAMPTZ NOT NULL,
            type TEXT NOT NULL,
            minutes INTEGER NOT NULL,
            calories INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_totals (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            total_calories BIGINT NOT NULL DEFAULT 0
        );
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
            id BIGSERIAL PRIMARY KEY,
            date DATE NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            rank INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS email_notifications (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            sent_at TIMESTAMPTZ DEFAULT NULL
        );
    ");

    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_leaderboard_date ON leaderboard_snapshots(date);");
    
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS achievements (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            unlocked_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, type)
        );
    ");
} catch (PDOException $e) {
    fc_json_fatal('DB schema init failed', $e->getMessage());
}

// ---- 6) 其他金鑰（保持原功能）----
define('OPENAI_API_KEY',      getenv('OPENAI_API_KEY') ?: '');
define('LINE_CHANNEL_SECRET', getenv('LINE_CHANNEL_SECRET') ?: '');
define('LINE_CHANNEL_ACCESS', getenv('LINE_CHANNEL_ACCESS') ?: '');
define('LINE_CHANNEL_TOKEN',  getenv('LINE_CHANNEL_TOKEN') ?: '');
define('LIFF_ID',           getenv('LIFF_ID') ?: '');
define('RESEND_API_KEY',      getenv('RESEND_API_KEY') ?: '');
define('RESEND_FROM_EMAIL',   getenv('RESEND_FROM_EMAIL') ?: 'onboarding@resend.dev');

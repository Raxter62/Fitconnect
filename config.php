<?php
// config.php - 資料庫連線與全域設定
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set('Asia/Taipei');

function fc_is_debug_env(): bool {
    $env = strtolower((string)(getenv('APP_ENV') ?: ''));
    return in_array($env, ['dev', 'development', 'local'], true);
}

function fc_json_fatal(string $msg, ?string $detail = null): void {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    $payload = [
        'success' => false,
        'message' => $msg,
    ];
    if (fc_is_debug_env() && $detail !== null) {
        $payload['error'] = $detail;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit(PHP_SAPI === 'cli' ? 1 : 0);
}

function fc_env_str(string $key): string {
    $v = getenv($key);
    if ($v === false) return '';
    $v = trim($v);

    // 移除貼上環境變數時可能一起帶入的外層引號。
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
    fc_json_fatal('Missing DATABASE_URL', 'Set DATABASE_URL to your PostgreSQL connection string in the PHP service environment.');
}

// 防呆：若你不小心還放著占位字
if (stripos($databaseUrl, '[YOUR-PASSWORD]') !== false || stripos($databaseUrl, 'YOUR_PASSWORD') !== false) {
    fc_json_fatal('DATABASE_URL still contains password placeholder', 'Replace the password placeholder in the PHP service environment.');
}

$dbConfig = parse_url($databaseUrl);
if ($dbConfig === false || !is_array($dbConfig)) {
    fc_json_fatal('Invalid DATABASE_URL (parse_url failed)', 'Check DATABASE_URL in the PHP service environment for quotes, spaces or newlines.');
}

$scheme = strtolower((string)($dbConfig['scheme'] ?? ''));
if ($scheme === 'postgres' || $scheme === 'postgresql') $scheme = 'pgsql';

$host   = (string)($dbConfig['host'] ?? '');
$port   = (int)($dbConfig['port'] ?? 0);
$user   = isset($dbConfig['user']) ? rawurldecode((string)$dbConfig['user']) : '';
$pass   = isset($dbConfig['pass']) ? rawurldecode((string)$dbConfig['pass']) : '';
$dbname = isset($dbConfig['path']) ? rawurldecode(ltrim((string)$dbConfig['path'], '/')) : '';
$query  = (string)($dbConfig['query'] ?? '');

// ---- 2) 可選的原始密碼覆蓋，避免 URL 特殊字元編碼問題 ----
$passOverride = fc_env_str('DB_PASSWORD');
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

// ---- 3) DSN 組裝：沿用連線字串的 SSL 設定，未指定時要求 TLS ----
parse_str($query, $q);
if (!isset($q['sslmode']) || $q['sslmode'] === '') {
    $q['sslmode'] = 'require';
}
$q['connect_timeout'] = '8';

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

// Schema changes run explicitly through: php db/migrate.php.
$pdo->exec("SET TIME ZONE 'Asia/Taipei'");
$pdo->exec("SET statement_timeout = '15s'");

// ---- 6) 其他金鑰（保持原功能）----
define('GEMINI_API_KEY',      fc_env_str('GEMINI_API_KEY'));
define('GEMINI_MODEL',        fc_env_str('GEMINI_MODEL') ?: 'gemini-3.5-flash-lite');
define('APP_BASE_URL',        rtrim(fc_env_str('APP_BASE_URL'), '/'));
define('LINE_CHANNEL_SECRET', getenv('LINE_CHANNEL_SECRET') ?: '');
define('LINE_CHANNEL_ACCESS', getenv('LINE_CHANNEL_ACCESS') ?: '');
define('LINE_CHANNEL_TOKEN',  getenv('LINE_CHANNEL_TOKEN') ?: '');
define('LIFF_ID',           getenv('LIFF_ID') ?: '');
define('RESEND_API_KEY',      getenv('RESEND_API_KEY') ?: '');
define('RESEND_FROM_EMAIL',   getenv('RESEND_FROM_EMAIL') ?: 'onboarding@resend.dev');

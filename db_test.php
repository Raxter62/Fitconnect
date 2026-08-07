<?php
declare(strict_types=1);

function env_str(string $k): string {
    $v = getenv($k);
    if ($v === false) return '';
    $v = trim($v);
    if ($v !== '' && (
        ($v[0] === '"' && substr($v, -1) === '"') ||
        ($v[0] === "'" && substr($v, -1) === "'")
    )) $v = substr($v, 1, -1);
    return trim($v);
}

header('Content-Type: text/plain; charset=utf-8');

$url = env_str('DATABASE_URL');
if ($url === '') {
    echo "No DATABASE_URL\n";
    exit;
}

if (stripos($url, '[YOUR-PASSWORD]') !== false) {
    echo "DATABASE_URL contains [YOUR-PASSWORD] placeholder.\n";
    echo "Fix: replace it OR set SUPABASE_DB_PASSWORD in Railway Variables.\n";
    exit;
}

$db = parse_url($url);
if ($db === false) {
    echo "parse_url failed. Check quotes/spaces/newlines in DATABASE_URL.\n";
    exit;
}

$scheme = strtolower($db['scheme'] ?? '');
if ($scheme === 'postgres' || $scheme === 'postgresql') $scheme = 'pgsql';

$host = $db['host'] ?? '';
$port = $db['port'] ?? 5432;
$user = rawurldecode($db['user'] ?? '');
$pass = rawurldecode($db['pass'] ?? '');
$name = rawurldecode(ltrim($db['path'] ?? '', '/'));
$query = $db['query'] ?? '';

$passOverride = env_str('SUPABASE_DB_PASSWORD');
if ($passOverride === '') $passOverride = env_str('DB_PASSWORD');
if ($passOverride !== '') $pass = $passOverride;

parse_str($query, $q);
if (!isset($q['sslmode']) || $q['sslmode'] === '') $q['sslmode'] = 'require';

$extra = '';
if (!empty($q)) {
    $pairs = [];
    foreach ($q as $k => $v) $pairs[] = $k . '=' . $v;
    $extra = ';' . implode(';', $pairs);
}

$dsn = "pgsql:host=$host;port=$port;dbname=$name$extra";

echo "Parsed:\n";
echo "  scheme=$scheme\n";
echo "  host=$host\n";
echo "  port=$port\n";
echo "  user=$user\n";
echo "  db=$name\n";
echo "  pass_len=" . strlen($pass) . "\n";
echo "  sslmode=" . ($q['sslmode'] ?? '(none)') . "\n\n";

if ($pass === '') {
    echo "Password is empty.\n";
    echo "Fix: set SUPABASE_DB_PASSWORD (recommended) OR put password into DATABASE_URL.\n";
    exit;
}

try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $now = $pdo->query("select now()")->fetchColumn();
    echo "OK\n";
    echo "now=$now\n";
} catch (PDOException $e) {
    echo "CONNECT FAILED\n";
    echo $e->getMessage() . "\n\n";
    echo "Most likely causes:\n";
    echo "1) Wrong Database password (reset it in Supabase Database Settings)\n";
    echo "2) Password contains special chars and DATABASE_URL parsing broke -> use SUPABASE_DB_PASSWORD\n";
    echo "3) Railway still using old DATABASE_URL (redeploy/restart after changing vars)\n";
}

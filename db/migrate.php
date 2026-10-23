<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../config.php';
$pdo->exec('SET statement_timeout = 0');
$pdo->beginTransaction();
try {
    $pdo->exec('SELECT pg_advisory_xact_lock(82022610)');
    $pdo->exec(file_get_contents(__DIR__ . '/schema.sql'));
    $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    foreach (glob(__DIR__ . '/migrations/*.sql') as $path) {
        $name = basename($path);
        $check = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE name = ?');
        $check->execute([$name]);
        if ($check->fetchColumn()) continue;
        $pdo->exec(file_get_contents($path));
        $pdo->prepare('INSERT INTO schema_migrations (name) VALUES (?)')->execute([$name]);
        echo "Applied {$name}\n";
    }
    $pdo->commit();
    echo "Database is up to date.\n";
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Migration failed: ' . $e->getMessage() . "\n");
    exit(1);
}

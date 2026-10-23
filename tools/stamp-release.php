<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function fc_release_plan(string $root): array {
    $release = json_decode(file_get_contents($root . '/release.json'), true, 512, JSON_THROW_ON_ERROR);
    $base = $release['version'] ?? '';
    if (!is_string($base) || !preg_match('/^\d{4}\.\d{2}\.\d{2}\.\d+$/D', $base)) {
        throw new RuntimeException('Invalid release version');
    }
    $pattern = '/' . preg_quote($base, '/') . '(?:-[a-f0-9]{12})?/';
    $files = ['index.html', 'service-worker.js', 'manifest.json', 'Dockerfile', '.htaccess', 'release.json', 'tools/stamp-release.php'];
    foreach (['public', 'LLM', 'LIFF', 'db'] as $directory) {
        $path = $root . '/' . $directory;
        if (!is_dir($path)) continue;
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && !$file->isLink()) $files[] = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
        }
    }
    foreach (glob($root . '/*.php') as $path) {
        if (!in_array(basename($path), ['db_test.php', 'test_email.php'], true)) $files[] = basename($path);
    }
    sort($files, SORT_STRING);
    $hash = hash_init('sha256');
    $templates = [];
    foreach ($files as $file) {
        hash_update($hash, $file . "\0");
        if (in_array($file, ['index.html', 'service-worker.js'], true)) {
            $contents = file_get_contents($root . '/' . $file);
            $templates[$file] = preg_replace($pattern, $base, $contents, -1, $count);
            if (!$count) throw new RuntimeException('Release marker missing in ' . $file);
            hash_update($hash, $templates[$file]);
        } elseif (!hash_update_file($hash, $root . '/' . $file)) {
            throw new RuntimeException('Unable to read release input: ' . $file);
        }
        hash_update($hash, "\0");
    }
    // Normalize earlier stamps so rebuilding identical code keeps the same identity.
    $version = $base . '-' . substr(hash_final($hash), 0, 12);
    foreach ($templates as $file => $contents) $templates[$file] = str_replace($base, $version, $contents);
    return ['version' => $version, 'files' => $templates];
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        $root = dirname(__DIR__);
        $plan = fc_release_plan($root);
        if (!in_array('--check', $argv, true)) {
            foreach ($plan['files'] as $file => $contents) {
                if (file_put_contents($root . '/' . $file, $contents) === false) throw new RuntimeException('Unable to stamp ' . $file);
            }
        }
        echo $plan['version'] . "\n";
    } catch (Throwable $error) {
        fwrite(STDERR, 'Release build failed: ' . $error->getMessage() . "\n");
        exit(1);
    }
}

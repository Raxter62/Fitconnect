<?php
declare(strict_types=1);

function fc_start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strpos((string)getenv('APP_BASE_URL'), 'https://') === 0,
        'samesite' => 'Lax',
        'path' => '/',
    ]);
    session_start();
}

function fc_check_session(PDO $pdo): void {
    if (!isset($_SESSION['user_id'])) return;
    $stmt = $pdo->prepare('SELECT auth_version, email_verified_at FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user || !$user['email_verified_at']
        || (int)($user['auth_version'] ?? 0) !== (int)($_SESSION['auth_version'] ?? 0)) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
}

function fc_rate_limit(PDO $pdo, string $key, int $limit, int $seconds = 900): bool {
    $stmt = $pdo->prepare("INSERT INTO account_rate_limits (key_hash) VALUES (:key)
        ON CONFLICT (key_hash) DO UPDATE SET
            attempts = CASE WHEN account_rate_limits.window_started_at <= NOW() - make_interval(secs => :seconds)
                THEN 1 ELSE account_rate_limits.attempts + 1 END,
            window_started_at = CASE WHEN account_rate_limits.window_started_at <= NOW() - make_interval(secs => :window)
                THEN NOW() ELSE account_rate_limits.window_started_at END
        RETURNING attempts");
    $stmt->execute([':key' => hash('sha256', $key), ':seconds' => $seconds, ':window' => $seconds]);
    return (int)$stmt->fetchColumn() <= $limit;
}

function fc_auth_throttle(PDO $pdo, string $action, string $email): void {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (!fc_rate_limit($pdo, "{$action}:ip:{$ip}", 30)
        || ($email !== '' && !fc_rate_limit($pdo, "{$action}:email:{$email}", $action === 'login' ? 10 : 5))) {
        http_response_code(429);
        header('Retry-After: 900');
        sendResponse(['success' => false, 'message' => '嘗試次數過多，請於 15 分鐘後再試。']);
    }
}

function fc_valid_password(string $password): bool {
    // PASSWORD_DEFAULT currently uses bcrypt, which accepts at most 72 bytes.
    return mb_strlen($password, 'UTF-8') >= 8 && strlen($password) <= 72;
}

function fc_account_url(string $purpose, string $token): string {
    $base = defined('APP_BASE_URL') ? APP_BASE_URL : '';
    if (!filter_var($base, FILTER_VALIDATE_URL)
        || !in_array(parse_url($base, PHP_URL_SCHEME), ['https', 'http'], true)
        || parse_url($base, PHP_URL_QUERY) || parse_url($base, PHP_URL_FRAGMENT)) {
        throw new RuntimeException('APP_BASE_URL is missing or invalid');
    }
    return $base . '/#auth=' . $purpose . '&token=' . rawurlencode($token);
}

function fc_send_account_link(PDO $pdo, array $user, string $purpose): bool {
    $token = bin2hex(random_bytes(32));
    $url = fc_account_url($purpose, $token);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('SELECT id FROM users WHERE id = ? FOR UPDATE')->execute([$user['id']]);
        $recent = $pdo->prepare("SELECT 1 FROM account_tokens WHERE user_id = ? AND purpose = ?
            AND created_at > NOW() - INTERVAL '60 seconds'");
        $recent->execute([$user['id'], $purpose]);
        if ($recent->fetchColumn()) {
            $pdo->commit();
            return true;
        }
        $pdo->prepare('UPDATE account_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
            ->execute([$user['id'], $purpose]);
        $minutes = $purpose === 'verify' ? 1440 : 30;
        $stmt = $pdo->prepare('INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
            VALUES (?, ?, ?, NOW() + make_interval(mins => ?))');
        $stmt->execute([hash('sha256', $token), $user['id'], $purpose, $minutes]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $title = $purpose === 'verify' ? '驗證您的 Email' : '重設您的密碼';
    $expiry = $purpose === 'verify' ? '24 小時' : '30 分鐘';
    $safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
    $sent = sendResendEmail($user['email'], "【FitConnect】{$title}",
        "<h2>{$title}</h2><p>此連結於 {$expiry}內有效，且只能使用一次。</p>"
        . "<p><a href=\"{$safeUrl}\">{$title}</a></p><p>若您沒有提出申請，請忽略這封信。</p>");
    if (!$sent) {
        $pdo->prepare('DELETE FROM account_tokens WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    return $sent;
}

function fc_consume_account_token(PDO $pdo, string $purpose, string $token, string $password = ''): bool {
    if (!preg_match('/^[a-f0-9]{64}$/D', $token)) return false;
    $hash = hash('sha256', $token);
    $pdo->beginTransaction();
    try {
        // Lock the user first, matching token issuance order to avoid deadlocks.
        $stmt = $pdo->prepare('SELECT u.id FROM users u JOIN account_tokens t ON t.user_id = u.id
            WHERE t.token_hash = ? AND t.purpose = ? FOR UPDATE OF u');
        $stmt->execute([$hash, $purpose]);
        $userId = $stmt->fetchColumn();
        $consume = $pdo->prepare('UPDATE account_tokens SET used_at = NOW()
            WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW() RETURNING user_id');
        $consume->execute([$hash, $purpose]);
        if (!$userId || !$consume->fetchColumn()) {
            $pdo->rollBack();
            return false;
        }
        if ($purpose === 'verify') {
            $pdo->prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?')->execute([$userId]);
        } else {
            $pdo->prepare('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
        }
        $pdo->prepare('UPDATE account_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
            ->execute([$userId, $purpose]);
        $pdo->commit();
        return true;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function fc_handle_account_action(PDO $pdo, string $action, array $input): void {
    if (!in_array($action, ['register', 'login', 'forgot_password', 'resend_verification', 'verify_email', 'reset_password'], true)) return;
    $email = mb_strtolower(trim(is_string($input['email'] ?? null) ? $input['email'] : ''), 'UTF-8');
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    fc_auth_throttle($pdo, $action, $email);
    if (in_array($action, ['verify_email', 'reset_password'], true)) {
        if ($action === 'reset_password' && !fc_valid_password($password)) {
            sendResponse(['success' => false, 'message' => '密碼至少 8 個字元，且不可超過 72 位元組。']);
        }
        $token = is_string($input['token'] ?? null) ? $input['token'] : '';
        $ok = fc_consume_account_token($pdo, $action === 'verify_email' ? 'verify' : 'reset', $token, $password);
        sendResponse(['success' => $ok, 'message' => $ok
            ? ($action === 'verify_email' ? 'Email 驗證完成，請登入。' : '密碼已重設，請重新登入。')
            : '連結無效、已使用或已過期，請重新申請。']);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        sendResponse(['success' => false, 'message' => '請輸入有效的 Email。']);
    }
    $stmt = $pdo->prepare('SELECT id, email, password_hash, email_verified_at, auth_version FROM users WHERE LOWER(email) = ? LIMIT 1');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if (in_array($action, ['forgot_password', 'resend_verification'], true)) {
        if ($user && ($action === 'forgot_password' || !$user['email_verified_at'])) {
            try {
                fc_send_account_link($pdo, $user, $action === 'forgot_password' ? 'reset' : 'verify');
            } catch (Throwable $e) {
                error_log('Account email unavailable: ' . get_class($e));
            }
        }
        sendResponse(['success' => true, 'message' => '若此信箱符合申請條件，將收到郵件；請同時檢查垃圾郵件，重寄需間隔 60 秒。']);
    }
    if ($action === 'login') {
        if (!$user || !password_verify($password, $user['password_hash'])) {
            sendResponse(['success' => false, 'message' => 'Email 或密碼不正確。']);
        }
        if (!$user['email_verified_at']) {
            sendResponse(['success' => false, 'verification_required' => true, 'message' => '請先完成 Email 驗證，可在下方重新寄送驗證信。']);
        }
        session_regenerate_id(true);
        $_SESSION = ['user_id' => (int)$user['id'], 'auth_version' => (int)$user['auth_version']];
        sendResponse(['success' => true, 'csrf_token' => csrfToken()]);
    }
    $name = trim(is_string($input['display_name'] ?? null) ? $input['display_name'] : '');
    if ($name === '' || mb_strlen($name) > 60 || !fc_valid_password($password)) {
        sendResponse(['success' => false, 'message' => '請填寫暱稱（最多 60 字）與至少 8 個字元的密碼（最多 72 位元組）。']);
    }
    if ($user) {
        sendResponse(['success' => false, 'message' => '此信箱無法註冊，請登入或使用忘記密碼。']);
    }
    try {
        $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id, email');
        $stmt->execute([$email, password_hash($password, PASSWORD_DEFAULT), $name]);
        $user = $stmt->fetch();
    } catch (PDOException $e) {
        if ($e->getCode() !== '23505') throw $e;
        sendResponse(['success' => false, 'message' => '此信箱無法註冊，請登入或使用忘記密碼。']);
    }
    $sent = false;
    try {
        $sent = fc_send_account_link($pdo, $user, 'verify');
    } catch (Throwable $e) {
        error_log('Registration email unavailable: ' . get_class($e));
    }
    sendResponse(['success' => true, 'verification_required' => true, 'email_sent' => $sent,
        'message' => $sent ? '帳號已建立，請到信箱完成驗證後登入。' : '帳號已建立，但暫時無法寄送驗證信。請稍後重寄或聯絡管理員。']);
}

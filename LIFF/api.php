<?php
// LIFF/api.php
require_once '../config.php';
require_once __DIR__ . '/../mail.php';
require_once __DIR__ . '/../workout.php';
require_once __DIR__ . '/../auth.php';

header('Content-Type: application/json');
header('Cache-Control: no-store, private');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => '此操作需要 POST。']);
    exit;
}

// Helper to get raw input
$input = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? $input['action'] ?? '';
$idToken = is_string($input['idToken'] ?? null) ? $input['idToken'] : '';
$channelId = fc_env_str('LINE_LOGIN_CHANNEL_ID');
$lineUserId = '';
if ($channelId === '' || $idToken === '') {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => '無法驗證 LINE 身分，請重新開啟頁面或聯絡管理員。']);
    exit;
}
$verify = curl_init('https://api.line.me/oauth2/v2.1/verify');
curl_setopt_array($verify, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POSTFIELDS => http_build_query(['id_token' => $idToken, 'client_id' => $channelId]),
    CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10,
]);
$verified = curl_exec($verify);
$verifyStatus = (int)curl_getinfo($verify, CURLINFO_HTTP_CODE);
curl_close($verify);
$identity = is_string($verified) ? json_decode($verified, true) : null;
if ($verifyStatus === 200 && is_array($identity) && is_string($identity['sub'] ?? null)
    && (string)($identity['aud'] ?? '') === $channelId && (int)($identity['exp'] ?? 0) > time()) {
    $lineUserId = $identity['sub'];
}

if (!$pdo) {
    error_log("LIFF/api.php: DB Connection Failed");
    echo json_encode(['success' => false, 'message' => 'DB Connection Failed']);
    exit;
}

// Ensure Timezone matches submit.php to avoid NOW() mismatch
try {
    $pdo->exec("SET TIME ZONE 'Asia/Taipei'");
} catch (Exception $e) {
    error_log("LIFF/api.php: Set Timezone Failed: " . $e->getMessage());
}

if (!$lineUserId) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Missing Line User ID']);
    exit;
}

// Check binding status helper
function getUserByLineId($pdo, $lineId) {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE line_user_id = ?");
    $stmt->execute([$lineId]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

// Actions
try {
    if (!fc_rate_limit($pdo, 'liff:' . $lineUserId, 60, 60)) {
        http_response_code(429);
        echo json_encode(['success' => false, 'message' => '操作過於頻繁，請稍後再試。']);
        exit;
    }
    if ($action === 'get_user_status') {
        $user = getUserByLineId($pdo, $lineUserId);
        if ($user) {
            echo json_encode([
                'success' => true,
                'bound' => true,
                'user' => [
                    'display_name' => $user['display_name'],
                    'height' => $user['height'],
                    'weight' => $user['weight']
                ]
            ]);
        } else {
            echo json_encode(['success' => true, 'bound' => false]);
        }
    }
    
    elseif ($action === 'bind_user') {
        $code = strtoupper(trim($input['code'] ?? ''));
        if (!fc_rate_limit($pdo, 'line-bind:' . $lineUserId, 5)) throw new InvalidArgumentException('綁定嘗試過多，請稍後再試。');

        if (!$code) {
            throw new Exception("請輸入綁定碼");
        }
        
        $stmt = $pdo->prepare("UPDATE users SET line_user_id = ?, line_bind_code = NULL, line_bind_code_expires_at = NULL
            WHERE line_bind_code = ? AND line_bind_code_expires_at > NOW() AND email_verified_at IS NOT NULL RETURNING id");
        $stmt->execute([$lineUserId, $code]);
        $user = $stmt->fetch();

        if ($user) {
            echo json_encode(['success' => true, 'message' => '綁定成功']);
        } else {
            error_log("LIFF Bind Failed: Code not found or expired.");
            throw new Exception("驗證碼錯誤或已過期");
        }
    }

    elseif ($action === 'unbind_user') {
        $update = $pdo->prepare("UPDATE users SET line_user_id = NULL WHERE line_user_id = ?");
        $update->execute([$lineUserId]);
        echo json_encode(['success' => true, 'message' => '已解除綁定']);
    }

    elseif ($action === 'add_workout') {
        $user = getUserByLineId($pdo, $lineUserId);
        if (!$user) throw new Exception("尚未綁定帳號");

        // Append time to ensure Y-m-d 00:00:00 format
        $dateInput = $input['date'] ?? date('Y-m-d');
        // Simple check if it already has time or just append 00:00:00
        if (strlen($dateInput) <= 10) {
            $date = $dateInput . " 00:00:00";
        } else {
            $date = $dateInput;
        }
        $type = $input['type'] ?? '';
        $minutes = (int)($input['minutes'] ?? 0);
        
        if (!$type || $minutes <= 0) throw new Exception("資料不完整");

        $requestKey = is_string($input['request_key'] ?? null) ? $input['request_key'] : null;
        $result = fc_record_workout($pdo, (int)$user['id'], $date, $type, $minutes, null, $requestKey);
        
        echo json_encode([
            'success' => true,
            'message' => '紀錄已新增',
            'calories' => $result['calories'],
            'achievements' => $result['achievements'],
        ]);
    }

    elseif ($action === 'update_profile') {
        $user = getUserByLineId($pdo, $lineUserId);
        if (!$user) throw new Exception("尚未綁定帳號");

        $name = $input['display_name'] ?? $user['display_name'];
        $height = round((float)($input['height'] ?? $user['height']), 1);
        $weight = round((float)($input['weight'] ?? $user['weight']), 1);

        $stmt = $pdo->prepare("UPDATE users SET display_name = ?, height = ?, weight = ? WHERE id = ?");
        $stmt->execute([$name, $height, $weight, $user['id']]);

        echo json_encode(['success' => true, 'message' => '個人資料已更新']);
    }

    else {
        echo json_encode(['success' => false, 'message' => 'Invalid Action']);
    }

} catch (Exception $e) {
    http_response_code($e instanceof PDOException ? 500 : 400);
    echo json_encode(['success' => false, 'message' => $e instanceof PDOException ? '暫時無法完成操作，請稍後再試。' : $e->getMessage()]);
}

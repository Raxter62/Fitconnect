<?php
// LIFF/api.php
require_once '../config.php';

header('Content-Type: application/json');

// Helper to get raw input
$input = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? $input['action'] ?? '';
$lineUserId = $input['lineUserId'] ?? '';

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
    error_log("LIFF/api.php: Missing Line User ID. Input: " . print_r($input, true));
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
        error_log("LIFF Bind Attempt: User=$lineUserId, Code=$code");

        if (!$code) {
            throw new Exception("請輸入綁定碼");
        }
        
        $stmt = $pdo->prepare("SELECT id FROM users WHERE line_bind_code = ? AND line_bind_code_expires_at > NOW()");
        $stmt->execute([$code]);
        $user = $stmt->fetch();

        if ($user) {
            $update = $pdo->prepare("UPDATE users SET line_user_id = ?, line_bind_code = NULL, line_bind_code_expires_at = NULL WHERE id = ?");
            $update->execute([$lineUserId, $user['id']]);
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

        // Calculate Calories
        $MET_VALUES = [
            '跑步' => 10, '重訓' => 4, '腳踏車' => 8, '游泳' => 6, '瑜珈' => 3, '其他' => 2
        ];
        $met = $MET_VALUES[$type] ?? 2;
        $weight = (float)($user['weight'] ?? 0);
        
        $calories = 0;
        if ($weight > 0) {
            $calories = round((($met * 3.5 * $weight) / 200) * $minutes);
        }

        $stmt = $pdo->prepare("INSERT INTO workouts (user_id, date, type, minutes, calories) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$user['id'], $date, $type, $minutes, $calories]);


        // Update User Totals (Postgres UPSERT)
        $stmt = $pdo->prepare(
            'INSERT INTO user_totals (user_id, total_calories) VALUES (:uid, :cal) 
             ON CONFLICT (user_id) DO UPDATE SET total_calories = user_totals.total_calories + :cal'
        );
        $stmt->execute([':uid' => $user['id'], ':cal' => $calories]);

        // Gamification Checks
        // Require mail.php if not already (it is require_once logic, but paths might differ locally)
        // Since api.php is in LIFF/, mail.php is in ../mail.php
        if (file_exists(__DIR__ . '/../mail.php')) {
            require_once __DIR__ . '/../mail.php';
            if (function_exists('checkAchievements')) {
                // Get pre-ranks if we want rank change notification? 
                // Too complex for now? Let's just do achievements.
                checkAchievements($pdo, $user['id']);
            }
            // Trigger Leaderboard Snapshot check? Maybe overkill for every request, but acceptable.
            if (function_exists('logLeaderboardSnapshot')) {
                logLeaderboardSnapshot($pdo);
            }
        }
        
        echo json_encode(['success' => true, 'message' => '紀錄已新增', 'calories' => $calories]);
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
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}

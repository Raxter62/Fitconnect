<?php
// includes/gamification.php

function getMetricValue(array $row, string $key): int {
    return isset($row[$key]) ? (int)$row[$key] : 0;
}

/**
 * Send Email via Resend API (using curl)
 */
function sendResendEmail(string $to, string $subject, string $htmlBody, ?PDO $pdo = null, int $userId = 0, string $type = 'general'): bool {
    $apiKey = defined('RESEND_API_KEY') ? RESEND_API_KEY : getenv('RESEND_API_KEY');
    if (!$apiKey) {
        error_log("RESEND_API_KEY not set.");
        return false;
    }

    $url = "https://api.resend.com/emails";
    $headers = [
        "Authorization: Bearer $apiKey",
        "Content-Type: application/json"
    ];

    $data = [
        "from" => "FitConnect <" . (defined('RESEND_FROM_EMAIL') ? RESEND_FROM_EMAIL : 'onboarding@resend.dev') . ">",
        "to" => [$to],
        "subject" => $subject,
        "html" => $htmlBody
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $success = ($httpCode >= 200 && $httpCode < 300);

    if ($pdo && $userId > 0 && $success) {
        try {
            $stmt = $pdo->prepare("INSERT INTO email_notifications (user_id, type, sent_at) VALUES (?, ?, NOW())");
            $stmt->execute([$userId, $type]);
        } catch (Exception $e) {
            error_log("Failed to log email: " . $e->getMessage());
        }
    }

    if ($success) {
        return true;
    } else {
        error_log("Resend Email Failed: $result");
        return false;
    }
}

/**
 * Check and Unlock Achievements
 * Triggered after detailed workout insertion.
 */
function checkAchievements(PDO $pdo, int $userId): array {
    $newlyUnlocked = [];

    // 1. Get User's current stats (Totals) and streaks
    // Totals by Type
    $stmt = $pdo->prepare("SELECT type, SUM(minutes) as total_min FROM workouts WHERE user_id = ? GROUP BY type");
    $stmt->execute([$userId]);
    $typeTotals = []; // 'Running' => 100
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $typeTotals[$row['type']] = (int)$row['total_min'];
    }

    // Total Calories
    $stmt = $pdo->prepare("SELECT SUM(calories) as total_cal FROM workouts WHERE user_id = ?");
    $stmt->execute([$userId]);
    $totalCal = (int)$stmt->fetchColumn();

    // Streak Calculation (Max Streak)
    // Get all distinct dates
    $stmt = $pdo->prepare("SELECT DISTINCT date(date) as d FROM workouts WHERE user_id = ? ORDER BY d DESC");
    $stmt->execute([$userId]);
    $dates = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    $maxStreak = 0;
    $currentSeq = 0;

    if (count($dates) > 0) {
        $currentSeq = 1;
        $maxStreak = 1;
        $prev = $dates[0];

        for ($i = 1; $i < count($dates); $i++) {
            $curr = $dates[$i];
            // Check if current date is exactly 1 day before previous date
            $expected = date('Y-m-d', strtotime("$prev -1 day"));
            
            if ($curr === $expected) {
                $currentSeq++;
            } else {
                $currentSeq = 1; // Reset sequence
            }

            if ($currentSeq > $maxStreak) {
                $maxStreak = $currentSeq;
            }
            
            $prev = $curr;
        }
    }

    // 2. Define Achievements List
    // type: DB key, title: Display Name, img: Image file, check: Closure
    $rules = [
        // Streaks
        ['id' => 'streak_3', 'title' => '連續運動3天', 'img' => 'Achievement1.png', 'cond' => fn() => $maxStreak >= 3],
        ['id' => 'streak_7', 'title' => '連續運動7天', 'img' => 'Achievement2.png', 'cond' => fn() => $maxStreak >= 7],
        ['id' => 'streak_30', 'title' => '連續運動30天', 'img' => 'Achievement3.png', 'cond' => fn() => $maxStreak >= 30],

        // Calories
        ['id' => 'cal_1000', 'title' => '總消耗卡路里達1000', 'img' => 'Achievement4.png', 'cond' => fn() => $totalCal >= 1000],
        ['id' => 'cal_2000', 'title' => '總消耗卡路里達2000', 'img' => 'Achievement5.png', 'cond' => fn() => $totalCal >= 2000],
        ['id' => 'cal_3000', 'title' => '總消耗卡路里達3000', 'img' => 'Achievement6.png', 'cond' => fn() => $totalCal >= 3000],
        ['id' => 'cal_5000', 'title' => '總消耗卡路里達5000', 'img' => 'Achievement7.png', 'cond' => fn() => $totalCal >= 5000],

        // Types (Map DB types to Rule types if naming differs, assuming exact match for now)
        ['id' => 'run_100', 'title' => '總跑步時間達100分鐘', 'img' => 'Achievement8.png', 'cond' => fn() => ($typeTotals['跑步'] ?? 0) >= 100],
        ['id' => 'weight_100', 'title' => '總重訓時間達100分鐘', 'img' => 'Achievement9.png', 'cond' => fn() => ($typeTotals['重訓'] ?? 0) >= 100],
        ['id' => 'bike_100', 'title' => '總腳踏車時間達100分鐘', 'img' => 'Achievement10.png', 'cond' => fn() => ($typeTotals['腳踏車'] ?? 0) >= 100],
        ['id' => 'swim_100', 'title' => '總游泳時間達100分鐘', 'img' => 'Achievement11.png', 'cond' => fn() => ($typeTotals['游泳'] ?? 0) >= 100],
        ['id' => 'yoga_100', 'title' => '總瑜珈時間達100分鐘', 'img' => 'Achievement12.png', 'cond' => fn() => ($typeTotals['瑜珈'] ?? 0) >= 100],
    ];

    // 3. Check and Insert
    // Get existing achievements
    $stmt = $pdo->prepare("SELECT type FROM achievements WHERE user_id = ?");
    $stmt->execute([$userId]);
    $existing = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $protocol = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? "https" : "http";
    $baseUrl = "$protocol://$host/public/image/Achievement";

    foreach ($rules as $rule) {
        if (!in_array($rule['id'], $existing) && $rule['cond']()) {
            // Unlock!
            $stmt = $pdo->prepare("INSERT INTO achievements (user_id, type) VALUES (?, ?)");
            $stmt->execute([$userId, $rule['id']]);
            // Return full info for frontend notification
            $newlyUnlocked[] = ['title' => $rule['title'], 'img' => $rule['img']];

            // Send Email
            $userEmail = getUserEmail($pdo, $userId);
            if ($userEmail) {
                $imgUrl = "$baseUrl/{$rule['img']}";
                $html = "
                    <h1>恭喜！您已解鎖成就：{$rule['title']}</h1>
                    <p>繼續保持運動的好習慣！</p>
                    <img src='$imgUrl' style='max-width: 300px; border-radius: 10px; margin-top: 20px;' alt='Achievement'>
                ";
                sendResendEmail($userEmail, "【FitConnect】成就解鎖通知", $html, $pdo, $userId, 'achievement');
            }
        }
    }

    return $newlyUnlocked;
}

/**
 * Get User Email Helper
 */
function getUserEmail(PDO $pdo, int $userId): ?string {
    $stmt = $pdo->prepare("SELECT email FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    return $stmt->fetchColumn() ?: null;
}

/**
 * Snapshot Leaderboard (Daily)
 * Should be called once per day or check if exists.
 */
function logLeaderboardSnapshot(PDO $pdo): void {
    $today = date('Y-m-d');
    
    // Check if snapshot exists for today
    $stmt = $pdo->prepare("SELECT 1 FROM leaderboard_snapshots WHERE date = ? LIMIT 1");
    $stmt->execute([$today]);
    if ($stmt->fetch()) return; // Already logged

    // Use user_totals (All Time) as the metric for snapshot
    $sql = "
        SELECT u.id, t.total_calories as total_cal
        FROM users u 
        JOIN user_totals t ON u.id = t.user_id 
        ORDER BY total_cal DESC
    ";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $rank = 1;
    $pdo->beginTransaction();
    try {
        // Removed total_minutes column
        $insert = $pdo->prepare("INSERT INTO leaderboard_snapshots (date, user_id, rank) VALUES (?, ?, ?)");
        foreach ($rows as $r) {
            $insert->execute([$today, $r['id'], $rank++]);
        }
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        error_log("Snapshot error: " . $e->getMessage());
    }
}

/**
 * Check Rank changes and Notify
 * Passed in $preUpdateRanks (Map: userId -> rank)
 */
function checkLeaderboardChanges(PDO $pdo, array $preUpdateRanks): void {
    // Calculate New Ranks (All Time)
    $sql = "
        SELECT u.id, t.total_calories as total_cal
        FROM users u 
        JOIN user_totals t ON u.id = t.user_id 
        ORDER BY total_cal DESC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Build Post-Update Map
    $postUpdateRanks = [];
    foreach ($rows as $index => $r) {
        $postUpdateRanks[$r['id']] = $index + 1;
    }

    // Compare
    foreach ($preUpdateRanks as $uid => $oldRank) {
        if (!isset($postUpdateRanks[$uid])) continue; // Should exist if they had a rank
        
        $newRank = $postUpdateRanks[$uid];
        
        // If rank dropped (numeric value increased, e.g. 1 -> 2)
        if ($newRank > $oldRank) {
            // Notify!
            $email = getUserEmail($pdo, $uid);
            if ($email) {
                // Determine who surpassed (the person who is now at $oldRank, or just generally)
                // "Your rank dropped from X to Y"
                $subject = "【FitConnect】您的排行榜名次下降了！";
                $html = "
                    <h2>排名變動通知</h2>
                    <p>您的排名已從第 <strong>$oldRank</strong> 名下降至第 <strong>$newRank</strong> 名。</p>
                    <p>快去運動奪回您的寶座吧！</p>
                ";
                sendResendEmail($email, $subject, $html, $pdo, $uid, 'rank_drop');
            }
        }
    }
}

/**
 * Helper to get current ranks for comparison
 */
function getCurrentRanks(PDO $pdo): array {
    $sql = "
        SELECT u.id, t.total_calories as total_cal
        FROM users u 
        JOIN user_totals t ON u.id = t.user_id 
        ORDER BY total_cal DESC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    $ranks = [];
    foreach ($rows as $index => $r) {
        $ranks[$r['id']] = $index + 1;
    }
    return $ranks;
}

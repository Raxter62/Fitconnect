<?php
// Shared workout helpers used by the main web API and LIFF API.

function fc_met_values(): array {
    return [
        '跑步' => 10,
        '重訓' => 4,
        '腳踏車' => 8,
        '游泳' => 6,
        '瑜珈' => 3,
        '其他' => 2,
    ];
}

function fc_calculate_calories(string $type, int $minutes, float $weight): int {
    if ($minutes <= 0 || $weight <= 0) return 0;

    $met = fc_met_values()[$type] ?? 2;
    return (int)round((($met * 3.5 * $weight) / 200) * $minutes);
}

function fc_record_workout(PDO $pdo, int $userId, string $date, string $type, int $minutes, ?float $weight = null): array {
    if ($date === '' || $type === '' || $minutes <= 0) {
        throw new InvalidArgumentException('Invalid workout data');
    }

    if ($weight === null) {
        $stmt = $pdo->prepare('SELECT weight FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $weight = (float)($stmt->fetchColumn() ?: 0);
    }

    $calories = fc_calculate_calories($type, $minutes, (float)$weight);
    $preRanks = function_exists('getCurrentRanks') ? getCurrentRanks($pdo) : [];

    $stmt = $pdo->prepare(
        'INSERT INTO workouts (user_id, date, type, minutes, calories) VALUES (:uid, :date, :type, :min, :cal)'
    );
    $stmt->execute([
        ':uid' => $userId,
        ':date' => $date,
        ':type' => $type,
        ':min' => $minutes,
        ':cal' => $calories,
    ]);

    $stmt = $pdo->prepare(
        'INSERT INTO user_totals (user_id, total_calories) VALUES (:uid, :cal)
         ON CONFLICT (user_id) DO UPDATE SET total_calories = user_totals.total_calories + :cal'
    );
    $stmt->execute([':uid' => $userId, ':cal' => $calories]);

    $achievements = [];
    if (function_exists('checkAchievements')) {
        $achievements = checkAchievements($pdo, $userId);
    }
    if (function_exists('checkLeaderboardChanges') && !empty($preRanks)) {
        checkLeaderboardChanges($pdo, $preRanks);
    }
    if (function_exists('logLeaderboardSnapshot')) {
        logLeaderboardSnapshot($pdo);
    }

    return [
        'calories' => $calories,
        'achievements' => $achievements,
    ];
}

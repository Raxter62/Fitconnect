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

function fc_workout_date(string $date): string {
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $date, new DateTimeZone('Asia/Taipei'));
    if (!$parsed || $parsed->format('Y-m-d H:i:s') !== $date || $parsed > new DateTimeImmutable('+5 minutes')) {
        throw new InvalidArgumentException('請輸入有效的運動時間，且不可晚於目前時間。');
    }
    return $parsed->format(DateTimeInterface::ATOM);
}

class FcWorkoutConflict extends RuntimeException {}
class FcWorkoutNotFound extends RuntimeException {}

function fc_mutate_workout(PDO $pdo, int $userId, string $action, array $input): array {
    $preRanks = function_exists('getCurrentRanks') ? getCurrentRanks($pdo) : [];
    $pdo->beginTransaction();
    try {
        // Serialize writes for this user, including writes coming from LIFF.
        $userStmt = $pdo->prepare('SELECT weight, email_verified_at FROM users WHERE id = ? FOR UPDATE');
        $userStmt->execute([$userId]);
        $user = $userStmt->fetch();
        if (!$user || !$user['email_verified_at']) throw new InvalidArgumentException('請先在網站完成 Email 驗證。');
        $old = null;
        $requestKey = is_string($input['request_key'] ?? null) ? $input['request_key'] : null;
        if ($requestKey !== null && !preg_match('/^[a-zA-Z0-9-]{16,64}$/D', $requestKey)) {
            throw new InvalidArgumentException('請求識別碼無效，請重新整理頁面。');
        }
        if ($action === 'create' && $requestKey !== null) {
            $duplicate = $pdo->prepare('SELECT id, calories FROM workouts WHERE user_id = ? AND request_key = ?');
            $duplicate->execute([$userId, $requestKey]);
            if ($saved = $duplicate->fetch()) {
                $pdo->commit();
                return ['id' => (int)$saved['id'], 'calories' => (int)$saved['calories'], 'achievements' => []];
            }
        }
        if ($action !== 'create') {
            $stmt = $pdo->prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ? FOR UPDATE');
            $stmt->execute([(int)($input['id'] ?? 0), $userId]);
            $old = $stmt->fetch();
            if (!$old) throw new FcWorkoutNotFound('找不到這筆紀錄。');
            if ((int)($input['revision'] ?? 0) !== (int)$old['revision']) {
                throw new FcWorkoutConflict('紀錄已在其他頁面更新，請重新載入後再操作。');
            }
        }
        $calories = 0;
        if ($action === 'delete') {
            $pdo->prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?')->execute([$old['id'], $userId]);
        } else {
            $type = is_string($input['type'] ?? null) ? $input['type'] : '';
            $minutes = filter_var($input['minutes'] ?? null, FILTER_VALIDATE_INT);
            if (!array_key_exists($type, fc_met_values()) || $minutes === false || $minutes < 1 || $minutes > 1440) {
                throw new InvalidArgumentException('請選擇有效的運動種類，分鐘數須為 1 至 1440 的整數。');
            }
            $date = fc_workout_date(is_string($input['date'] ?? null) ? $input['date'] : '');
            $weight = (float)($old['weight_kg'] ?? $user['weight'] ?? 0);
            $sameActivity = $old && $old['type'] === $type && (int)$old['minutes'] === $minutes;
            if ($sameActivity) {
                $calories = (int)$old['calories'];
            } else {
                if ($weight <= 0) throw new InvalidArgumentException('請先設定有效的體重，再計算運動熱量。');
                $calories = fc_calculate_calories($type, $minutes, $weight);
            }
            if ($action === 'create') {
                $stmt = $pdo->prepare('INSERT INTO workouts (user_id, date, type, minutes, calories, weight_kg, request_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id');
                $stmt->execute([$userId, $date, $type, $minutes, $calories, $weight, $requestKey]);
                $id = (int)$stmt->fetchColumn();
            } else {
                $savedWeight = $sameActivity ? $old['weight_kg'] : $weight;
                $pdo->prepare('UPDATE workouts SET date = ?, type = ?, minutes = ?, calories = ?, weight_kg = ?, revision = revision + 1
                    WHERE id = ? AND user_id = ?')->execute([$date, $type, $minutes, $calories, $savedWeight, $old['id'], $userId]);
                $id = (int)$old['id'];
            }
        }
        $pdo->prepare('INSERT INTO user_totals (user_id, total_calories)
            SELECT ?, COALESCE(SUM(calories), 0)::BIGINT FROM workouts WHERE user_id = ?
            ON CONFLICT (user_id) DO UPDATE SET total_calories = EXCLUDED.total_calories')->execute([$userId, $userId]);
        $achievements = function_exists('checkAchievements') ? checkAchievements($pdo, $userId, false) : [];
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // Network failures must never roll back or disguise an already saved workout.
    try {
        if (function_exists('fc_notify_achievements')) fc_notify_achievements($pdo, $userId, $achievements);
        if ($preRanks && function_exists('checkLeaderboardChanges')) checkLeaderboardChanges($pdo, $preRanks);
        if (function_exists('logLeaderboardSnapshot')) logLeaderboardSnapshot($pdo);
    } catch (Throwable $e) {
        error_log('Post-workout notification failed: ' . get_class($e));
    }
    return ['id' => $id ?? (int)($old['id'] ?? 0), 'calories' => $calories, 'achievements' => $achievements];
}

function fc_record_workout(PDO $pdo, int $userId, string $date, string $type, int $minutes, ?float $weight = null, ?string $requestKey = null): array {
    return fc_mutate_workout($pdo, $userId, 'create', ['date' => $date, 'type' => $type, 'minutes' => $minutes, 'request_key' => $requestKey]);
}

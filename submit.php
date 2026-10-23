<?php
// submit.php - Main API endpoint with full error handling
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

function fc_api_is_dev(): bool {
    $env = strtolower((string)(getenv('APP_ENV') ?: ''));
    return in_array($env, ['dev', 'development', 'local'], true);
}

function fc_api_error_payload(string $message, Throwable $e): array {
    $payload = [
        'success' => false,
        'message' => $message,
    ];

    if (fc_api_is_dev()) {
        $payload['error'] = $e->getMessage();
        $payload['file'] = $e->getFile();
        $payload['line'] = $e->getLine();
        $payload['type'] = get_class($e);
    }

    return $payload;
}

ob_start();

try {
    $coachAvailable = false;

    // Check and load config.php
    if (!file_exists(__DIR__ . '/config.php')) {
        throw new Exception('config.php not found in ' . __DIR__);
    }
    require_once __DIR__ . '/config.php';
    
    // Check and load coach.php (optional)
    if (file_exists(__DIR__ . '/LLM/coach.php')) {
        require_once __DIR__ . '/LLM/coach.php';
        $coachAvailable = true;
    }
    
    // Check and load mail.php (renamed from gamification.php)
    if (file_exists(__DIR__ . '/mail.php')) {
        require_once __DIR__ . '/mail.php';
    }
    if (file_exists(__DIR__ . '/workout.php')) {
        require_once __DIR__ . '/workout.php';
    }
    
    require_once __DIR__ . '/auth.php';
    require_once __DIR__ . '/reports.php';
    fc_start_session();
    fc_check_session($pdo);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
    
    // Check database connection
    if (!isset($pdo) || !$pdo) {
        throw new Exception('Database connection failed - $pdo not available');
    }
    
    // Test database
    try {
        $pdo->query('SELECT 1');
        // Set Timezone for current session
        $pdo->exec("SET TIME ZONE 'Asia/Taipei'");
    } catch (PDOException $e) {
        throw new Exception('Database query test failed: ' . $e->getMessage());
    }
    
    // Helper functions
    function getJsonInput(): array {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') return [];
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
    
    function sendResponse(array $data): void {
        ob_end_clean();
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    function csrfToken(): string {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    function requirePost(string $action): void {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            sendResponse([
                'success' => false,
                'message' => "Action {$action} requires POST",
            ]);
        }
    }

    function requireCsrf(array $input): void {
        $submitted = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($input['csrf_token'] ?? '');
        $expected = csrfToken();

        if (!is_string($submitted) || !hash_equals($expected, $submitted)) {
            http_response_code(403);
            sendResponse([
                'success' => false,
                'message' => 'Invalid CSRF token',
            ]);
        }
    }
    
    $input = getJsonInput();
    $action = $input['action'] ?? ($_GET['action'] ?? '');

    $postActions = [
        'register',
        'login',
        'logout',
        'update_profile',
        'update_avatar',
        'add_workout',
        'update_workout',
        'delete_workout',
        'forgot_password',
        'resend_verification',
        'verify_email',
        'reset_password',
        'generate_bind_code',
        'line_unbind',
        'ai_coach',
        'clear_coach_history',
    ];
    $csrfExemptActions = ['register', 'login', 'forgot_password', 'resend_verification', 'verify_email', 'reset_password'];

    $privateActions = ['get_user_info', 'logout', 'update_profile', 'update_avatar', 'add_workout',
        'update_workout', 'delete_workout', 'list_workouts', 'get_stats', 'get_report',
        'generate_bind_code', 'line_unbind', 'ai_coach', 'clear_coach_history'];
    if (in_array($action, $privateActions, true) && !isset($_SESSION['user_id'])) {
        http_response_code(401);
        sendResponse(['success' => false, 'message' => '登入已失效，請重新登入。']);
    }

    if (in_array($action, $postActions, true)) {
        requirePost($action);
        if (!in_array($action, $csrfExemptActions, true)) {
            requireCsrf($input);
        }
    }
    
    fc_handle_account_action($pdo, (string)$action, $input);

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        sendResponse(['success' => true, 'message' => 'Logged out']);
    }
    
    if ($action === 'get_user_info') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $stmt = $pdo->prepare('SELECT id, email, display_name, height, weight, avatar_id, line_user_id FROM users WHERE id = :id');
        $stmt->execute([':id' => $_SESSION['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$user) {
            sendResponse(['success' => false, 'message' => 'User not found']);
        }
        
        sendResponse(['success' => true, 'data' => $user, 'csrf_token' => csrfToken()]);
    }
    
    // === Profile Actions ===
    if ($action === 'update_profile') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $name = trim($input['display_name'] ?? '');
        $height = round((float)($input['height'] ?? 0), 1);
        $weight = round((float)($input['weight'] ?? 0), 1);
        
        $stmt = $pdo->prepare(
            'UPDATE users SET display_name = :name, height = :height, weight = :weight WHERE id = :id'
        );
        $stmt->execute([
            ':name' => $name,
            ':height' => $height,
            ':weight' => $weight,
            ':id' => $_SESSION['user_id']
        ]);
        
        sendResponse(['success' => true, 'message' => 'Profile updated']);
    }
    
    if ($action === 'update_avatar') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $avatarId = intval($input['avatar_id'] ?? 1);
        
        $stmt = $pdo->prepare('UPDATE users SET avatar_id = :aid WHERE id = :id');
        $stmt->execute([':aid' => $avatarId, ':id' => $_SESSION['user_id']]);
        
        sendResponse(['success' => true, 'message' => 'Avatar updated']);
    }
    
    if (in_array($action, ['list_workouts', 'get_report', 'update_workout', 'delete_workout'], true)) {
        if (!isset($_SESSION['user_id'])) {
            http_response_code(401);
            sendResponse(['success' => false, 'message' => '登入已失效，請重新登入。']);
        }
        $userId = (int)$_SESSION['user_id'];
        if ($action === 'get_report') {
            $period = (string)($_GET['period'] ?? 'week');
            sendResponse(['success' => true, 'report' => fc_build_report($pdo, $userId, $period)]);
        }
        if ($action === 'list_workouts') {
            $page = max(1, (int)($_GET['page'] ?? 1));
            $pageSize = filter_var($_GET['per_page'] ?? 20, FILTER_VALIDATE_INT);
            if (!in_array($pageSize, [10, 20], true)) {
                http_response_code(400);
                sendResponse(['success' => false, 'message' => '不支援的每頁筆數。']);
            }
            $count = $pdo->prepare('SELECT COUNT(*) FROM workouts WHERE user_id = ?');
            $count->execute([$userId]);
            $total = (int)$count->fetchColumn();
            $page = min($page, max(1, (int)ceil($total / $pageSize)));
            $stmt = $pdo->prepare("SELECT id, to_char(date AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS date,
                type, minutes, calories, weight_kg, revision FROM workouts WHERE user_id = :uid
                ORDER BY date DESC, id DESC LIMIT :limit OFFSET :offset");
            $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
            $stmt->bindValue(':limit', $pageSize, PDO::PARAM_INT);
            $stmt->bindValue(':offset', ($page - 1) * $pageSize, PDO::PARAM_INT);
            $stmt->execute();
            sendResponse(['success' => true, 'data' => $stmt->fetchAll(), 'page' => $page,
                'total' => $total, 'per_page' => $pageSize, 'pages' => max(1, (int)ceil($total / $pageSize))]);
        }
        session_write_close();
        $result = fc_mutate_workout($pdo, $userId, $action === 'update_workout' ? 'update' : 'delete', $input);
        sendResponse(['success' => true] + $result);
    }

    // === Workout Actions ===
    if ($action === 'add_workout') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $date = $input['date'] ?? '';
        $type = $input['type'] ?? '';
        $minutes = intval($input['minutes'] ?? 0);
        
        if ($date === '' || $type === '' || $minutes <= 0) {
            sendResponse(['success' => false, 'message' => 'Invalid workout data']);
        }

        if (!function_exists('fc_record_workout')) {
            throw new Exception('Workout helper not available');
        }

        $userId = (int)$_SESSION['user_id'];
        session_write_close();
        $requestKey = is_string($input['request_key'] ?? null) ? $input['request_key'] : null;
        $result = fc_record_workout($pdo, $userId, $date, $type, $minutes, null, $requestKey);
        sendResponse([
            'success' => true,
            'message' => 'Workout added',
            'id' => $result['id'],
            'calories' => $result['calories'],
            'achievements' => $result['achievements'],
        ]);
    }
    
        if ($action === 'get_stats') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $range = $_GET['range'] ?? '1d';
        
        // --- 1. 定義時間範圍與分組邏輯 ---
        $startDate = '';
        $groupBy = '';
        $dateFormat = ''; // 用於 PHP 後處理或 SQL 顯示
        
        if ($range === '1d') {
            // 最近 1 天 (00:00 - 24:00)，每 3 小時一組
            // SQL: floor(extract(hour from date) / 3) * 3
            $startDate = date('Y-m-d 00:00:00'); // 今天 0點
            // Postgres logic for checking today
        } elseif ($range === '1wk') {
            // 最近 1 週 (MON-SUN) or 7 days
            // User said "Recent MON~SUN". Standard ISO week logic.
            // Let's use date_trunc('week', current_date)
        } elseif ($range === '1m') {
            // 最近 1 月 (01-30)，每 6 天一組
            // User said "Recent (current month) 01~30".
            // Let's use date_trunc('month', current_date)
        } elseif ($range === '3m') {
            // 最近 3 個月，每 1 個月一組
        }
        
        // Postgres Queries
        $timeData = [];
        $calData = [];
        $typeData = [];
        
        try {
            if ($range === '1d') {
                // 1天: 只要今天的資料，每3小時一格 (0, 3, 6, ..., 21)
                $stmt = $pdo->prepare(
                    "SELECT floor(extract(hour from date) / 3) * 3 as label_start, 
                            SUM(minutes) as total_min, 
                            SUM(calories) as total_cal
                     FROM workouts 
                     WHERE user_id = :uid AND date >= CURRENT_DATE 
                     GROUP BY 1 ORDER BY 1 ASC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                // 補齊 0-21 的空缺
                // 補齊 0-21 的空缺，產生 0:00~3:00, 3:00~6:00 等標籤
                for ($h = 0; $h < 24; $h += 3) {
                    $found = false;
                    $label = sprintf("%d:00~%d:00", $h, $h + 3);
                    
                    foreach ($raw as $r) {
                        if (intval($r['label_start']) === $h) {
                            $timeData[] = ['label' => $label, 'total' => $r['total_min']];
                            $calData[] = ['label' => $label, 'total' => $r['total_cal']];
                            $found = true;
                            break;
                        }
                    }
                    if (!$found) {
                        $timeData[] = ['label' => $label, 'total' => 0];
                        $calData[] = ['label' => $label, 'total' => 0];
                    }
                }
                
                // Type Chart (Today)
                $stmt = $pdo->prepare(
                    "SELECT type, SUM(minutes) as total FROM workouts 
                     WHERE user_id = :uid AND date >= CURRENT_DATE 
                     GROUP BY type ORDER BY total DESC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $typeData = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
            } elseif ($range === '1wk') {
                // 1週: 本週一開始
                $stmt = $pdo->prepare(
                    "SELECT to_char(date, 'Dy') as day_label, 
                            extract(isodow from date) as day_num,
                            SUM(minutes) as total_min, 
                            SUM(calories) as total_cal
                     FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('week', CURRENT_DATE)
                     GROUP BY 1, 2 ORDER BY 2 ASC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                // Map 1-7 to data, simple fill or just return raw if chart.js handles it. 
                // Let's standardise to Mon, Tue...
                $weekDays = [1=>'Mon', 2=>'Tue', 3=>'Wed', 4=>'Thu', 5=>'Fri', 6=>'Sat', 7=>'Sun'];
                foreach ($weekDays as $num => $txt) {
                    $found = null;
                    foreach ($raw as $r) {
                        if (intval($r['day_num']) === $num) $found = $r;
                    }
                    $timeData[] = ['label' => $txt, 'total' => $found ? $found['total_min'] : 0];
                    $calData[] = ['label' => $txt, 'total' => $found ? $found['total_cal'] : 0];
                }

                // Type Chart (This Week)
                $stmt = $pdo->prepare(
                    "SELECT type, SUM(minutes) as total FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('week', CURRENT_DATE)
                     GROUP BY type ORDER BY total DESC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $typeData = $stmt->fetchAll(PDO::FETCH_ASSOC);

            } elseif ($range === '1m') {
                // 1月: 本月1號開始，每6天一組 (1-6, 7-12...)
                // floor((day - 1) / 6)
                $stmt = $pdo->prepare(
                    "SELECT floor((extract(day from date) - 1) / 6) as block, 
                            SUM(minutes) as total_min, 
                            SUM(calories) as total_cal
                     FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('month', CURRENT_DATE)
                     GROUP BY 1 ORDER BY 1 ASC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                // Blocks 0 to 4 (0=1-6, 1=7-12, 2=13-18, 3=19-24, 4=25+)
                $labels = ['1-6', '7-12', '13-18', '19-24', '25+'];
                for ($i = 0; $i < 5; $i++) {
                    $found = null;
                    foreach ($raw as $r) {
                        if (intval($r['block']) === $i) $found = $r;
                    }
                    $timeData[] = ['label' => $labels[$i], 'total' => $found ? $found['total_min'] : 0];
                    $calData[] = ['label' => $labels[$i], 'total' => $found ? $found['total_cal'] : 0];
                }

                // Type Chart (This Month)
                $stmt = $pdo->prepare(
                    "SELECT type, SUM(minutes) as total FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('month', CURRENT_DATE)
                     GROUP BY type ORDER BY total DESC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $typeData = $stmt->fetchAll(PDO::FETCH_ASSOC);

            } elseif ($range === '3m') {
                // 3月: 最近3個月 (含本月)
                // date_trunc('month', date)
                $stmt = $pdo->prepare(
                    "SELECT to_char(date, 'YYYY-MM') as m_label, 
                            SUM(minutes) as total_min, 
                            SUM(calories) as total_cal
                     FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')
                     GROUP BY 1 ORDER BY 1 ASC"
                );
                // INTERVAL '2 months' gets us back to start of 2 months ago + current month = 3 months span roughly
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                // Fill logic is tricky without knowing exact months easily, sticking to what DB returns for now or simple loop.
                // Let's just return what DB has for 3m, or last 3 generated months.
                // Use DB results directly for simplicity as "Recent 1~3 months"
                foreach ($raw as $r) {
                    $timeData[] = ['label' => $r['m_label'], 'total' => $r['total_min']];
                    $calData[] = ['label' => $r['m_label'], 'total' => $r['total_cal']];
                }
                
                // Type Chart (3 Months)
                $stmt = $pdo->prepare(
                    "SELECT type, SUM(minutes) as total FROM workouts 
                     WHERE user_id = :uid AND date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')
                     GROUP BY type ORDER BY total DESC"
                );
                $stmt->execute([':uid' => $_SESSION['user_id']]);
                $typeData = $stmt->fetchAll(PDO::FETCH_ASSOC);
            }
            
        } catch (Exception $e) {
            error_log('get_stats failed: ' . $e->getMessage());
            http_response_code(500);
            sendResponse([
                'success' => false,
                'message' => 'Stats query failed',
            ]);
        }
        
        sendResponse([
            'success' => true, 
            'time_chart' => $timeData, 
            'type_chart' => $typeData, 
            'cal_chart' => $calData, 
            'range' => $range
        ]);
    }
    
    if ($action === 'get_leaderboard') {
        $range = $_GET['range'] ?? '1m';
        $allowedRanges = ['1d', '1wk', '1m', '3m', 'total'];
        if (!in_array($range, $allowedRanges, true)) {
            $range = '1m';
        }

        if ($range === 'total') {
            $stmt = $pdo->prepare(
                "SELECT u.id, u.display_name, COALESCE(t.total_calories, 0) as total, u.avatar_id
                 FROM users u
                 LEFT JOIN user_totals t ON u.id = t.user_id
                 WHERE COALESCE(t.total_calories, 0) > 0
                 ORDER BY total DESC, u.id ASC"
            );
            $stmt->execute();
        } else {
            $dateCondition = "w.date >= date_trunc('month', CURRENT_DATE)";
            if ($range === '1d') {
                $dateCondition = "w.date >= CURRENT_DATE";
            } elseif ($range === '1wk') {
                $dateCondition = "w.date >= date_trunc('week', CURRENT_DATE)";
            } elseif ($range === '3m') {
                $dateCondition = "w.date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')";
            }

            $stmt = $pdo->prepare(
                "SELECT u.id, u.display_name, COALESCE(SUM(w.calories), 0) as total, u.avatar_id
                 FROM users u
                 JOIN workouts w ON u.id = w.user_id
                 WHERE {$dateCondition}
                 GROUP BY u.id, u.display_name, u.avatar_id
                 HAVING COALESCE(SUM(w.calories), 0) > 0
                 ORDER BY total DESC, u.id ASC"
            );
            $stmt->execute();
        }

        $allRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Calculate Ranks
        $rankedData = [];
        $rank = 1;
        foreach ($allRows as $r) {
            $r['rank'] = $rank++;
            $rankedData[] = $r;
        }

        // Extract Top 10
        $top10 = array_slice($rankedData, 0, 10);

        // Find Current User Rank (if logged in)
        $userRankData = null;
        if (isset($_SESSION['user_id'])) {
            $uid = $_SESSION['user_id'];
            foreach ($rankedData as $r) {
                if ($r['id'] == $uid) {
                    $userRankData = $r;
                    break;
                }
            }
            // If user not in Top 10, verify we send it back
            // Actually, we always send it back if found, frontend decides if it needs to render a separate row
        } elseif (isset($_SESSION['demo_mode']) && $_SESSION['demo_mode']) {
             // Demo handling if needed, or frontend handles it
        }
        
        sendResponse(['success' => true, 'data' => $top10, 'user_rank' => $userRankData, 'range' => $range]);
    }
    
    // === LINE Bot Actions ===
    if ($action === 'generate_bind_code') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $code = strtoupper(bin2hex(random_bytes(3)));
        
        $stmt = $pdo->prepare(
            "UPDATE users SET line_bind_code = :code, line_bind_code_expires_at = NOW() + INTERVAL '10 minutes' WHERE id = :uid"
        );
        $stmt->execute([':uid' => $_SESSION['user_id'], ':code' => $code]);
        
        // We don't return exact expiry time to frontend to avoid confusion, or return a calculated one if needed.
        // Frontend doesn't essentially use it.
        sendResponse(['success' => true, 'code' => $code]);
    }
    
    if ($action === 'line_unbind') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $stmt = $pdo->prepare('UPDATE users SET line_user_id = NULL WHERE id = :id');
        $stmt->execute([':id' => $_SESSION['user_id']]);
        
        sendResponse(['success' => true, 'message' => 'LINE account unbound']);
    }
    
    // === AI Coach Action ===
    if ($action === 'clear_coach_history') {
        if (!isset($_SESSION['user_id'])) {
            http_response_code(401);
            sendResponse(['success' => false, 'message' => '請重新登入。']);
        }
        unset($_SESSION['coach_history']);
        $_SESSION['coach_epoch'] = (int)($_SESSION['coach_epoch'] ?? 0) + 1;
        sendResponse(['success' => true]);
    }
    if ($action === 'ai_coach') {
        if (!$coachAvailable) {
            http_response_code(503);
            sendResponse(['success' => false, 'message' => '這個問題我沒辦法回答喔']);
        }
        
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $message = trim($input['message'] ?? '');
        if ($message === '') {
            sendResponse(['success' => false, 'message' => 'Message cannot be empty']);
        }
        
        if (mb_strlen($message) > 1200) {
            sendResponse(['success' => false, 'message' => '每則訊息最多 1200 字。']);
        }
        $period = (string)($input['period'] ?? 'week');
        if (!in_array($period, ['day', 'week'], true)) {
            sendResponse(['success' => false, 'message' => '不支援的報告範圍。']);
        }
        $userId = (int)$_SESSION['user_id'];
        $authVersion = (int)$_SESSION['auth_version'];
        $history = $_SESSION['coach_history'] ?? [];
        $epoch = (int)($_SESSION['coach_epoch'] ?? 0);
        session_write_close();
        try {
            $result = askCoachFromDb($pdo, $userId, $message, $history, $period);
            fc_start_session();
            fc_check_session($pdo);
            if (($_SESSION['user_id'] ?? null) !== $userId || (int)($_SESSION['auth_version'] ?? 0) !== $authVersion) {
                http_response_code(401);
                sendResponse(['success' => false, 'message' => '登入已失效，請重新登入。']);
            }
            $history[] = ['role' => 'user', 'text' => $message];
            $history[] = ['role' => 'model', 'text' => $result['response']];
            if ((int)($_SESSION['coach_epoch'] ?? 0) === $epoch) $_SESSION['coach_history'] = array_slice($history, -6);
            sendResponse(['success' => true] + $result);
        } catch (Throwable $e) {
            error_log('AI coach request failed: ' . get_class($e));
            http_response_code($e instanceof PDOException ? 503 : 502);
            sendResponse(['success' => false, 'message' => FC_COACH_UNAVAILABLE]);
        }
    }
    
    // Unknown action
    sendResponse(['success' => false, 'message' => 'Unknown action: ' . $action]);
    
} catch (FcWorkoutConflict $e) {
    ob_end_clean();
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
} catch (FcWorkoutNotFound $e) {
    ob_end_clean();
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
} catch (InvalidArgumentException $e) {
    ob_end_clean();
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
} catch (PDOException $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode(fc_api_error_payload('Database error', $e), JSON_UNESCAPED_UNICODE);
    exit;
    
} catch (Exception $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode(fc_api_error_payload('Server error', $e), JSON_UNESCAPED_UNICODE);
    exit;
    
} catch (Throwable $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode(fc_api_error_payload('Fatal server error', $e), JSON_UNESCAPED_UNICODE);
    exit;
}

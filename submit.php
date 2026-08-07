<?php
// submit.php - Main API endpoint with full error handling
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

ob_start();

try {
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
    
    session_start();
    header('Content-Type: application/json; charset=utf-8');
    
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
    
    $input = getJsonInput();
    $action = $input['action'] ?? ($_GET['action'] ?? '');
    
    // === Authentication Actions ===
    if ($action === 'register') {
        $email = trim($input['email'] ?? '');
        $pass = $input['password'] ?? '';
        $name = trim($input['display_name'] ?? 'User');
        
        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        if ($stmt->fetch()) {
            sendResponse(['success' => false, 'message' => '這個email已註冊過了']);
        }
        
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare(
            'INSERT INTO users (email, password_hash, display_name) VALUES (:email, :hash, :name) RETURNING id'
        );
        
        if ($stmt->execute([':email' => $email, ':hash' => $hash, ':name' => $name])) {
            $newUser = $stmt->fetch(PDO::FETCH_ASSOC);
            $_SESSION['user_id'] = $newUser['id'];
            sendResponse(['success' => true, 'message' => 'Registration successful']);
        }
        
        sendResponse(['success' => false, 'message' => 'Registration failed']);
    }
    
    if ($action === 'login') {
        $email = trim($input['email'] ?? '');
        $pass = $input['password'] ?? '';
        
        if ($email === '' || $pass === '') {
            sendResponse(['success' => false, 'message' => 'Please enter email and password']);
        }
        
        $stmt = $pdo->prepare('SELECT id, password_hash, display_name FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$user || !password_verify($pass, $user['password_hash'])) {
            sendResponse(['success' => false, 'message' => 'Invalid email or password']);
        }
        
        $_SESSION['user_id'] = $user['id'];
        sendResponse(['success' => true, 'message' => 'Login successful']);
    }
    
    if ($action === 'logout') {
        session_destroy();
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
        
        sendResponse(['success' => true, 'data' => $user]);
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
    
    // === Workout Actions ===
    if ($action === 'add_workout') {
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $date = $input['date'] ?? '';
        $type = $input['type'] ?? '';
        $minutes = intval($input['minutes'] ?? 0);
        $calories = intval($input['calories'] ?? 0);
        
        if ($date === '' || $type === '' || $minutes <= 0) {
            sendResponse(['success' => false, 'message' => 'Invalid workout data']);
        }
        
        // Gamification: Get Pre-Update Ranks
        $preRanks = function_exists('getCurrentRanks') ? getCurrentRanks($pdo) : [];
        
        $stmt = $pdo->prepare(
            'INSERT INTO workouts (user_id, date, type, minutes, calories) VALUES (:uid, :date, :type, :min, :cal)'
        );
        $stmt->execute([
            ':uid' => $_SESSION['user_id'],
            ':date' => $date,
            ':type' => $type,
            ':min' => $minutes,
            ':cal' => $calories
        ]);
        
        // Update User Totals (Postgres UPSERT)
        $stmt = $pdo->prepare(
            'INSERT INTO user_totals (user_id, total_calories) VALUES (:uid, :cal) 
             ON CONFLICT (user_id) DO UPDATE SET total_calories = user_totals.total_calories + :cal'
        );
        $stmt->execute([':uid' => $_SESSION['user_id'], ':cal' => $calories]);
        
        // Gamification Hooks
        $achievements = [];
        if (function_exists('checkAchievements')) {
            $achievements = checkAchievements($pdo, $_SESSION['user_id']);
        }
        if (function_exists('checkLeaderboardChanges') && !empty($preRanks)) {
            checkLeaderboardChanges($pdo, $preRanks);
        }
        if (function_exists('logLeaderboardSnapshot')) {
            logLeaderboardSnapshot($pdo);
        }
        
        sendResponse(['success' => true, 'message' => 'Workout added', 'achievements' => $achievements]);
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
            // Log error
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
        
        $dateCondition = "DATE(w.date) >= CURRENT_DATE - INTERVAL '30 days'";
        if ($range === '1d') {
            $dateCondition = "DATE(w.date) >= CURRENT_DATE"; 
        } elseif ($range === '1wk') {
            $dateCondition = "DATE(w.date) >= date_trunc('week', CURRENT_DATE)";
        } elseif ($range === '1m') {
            $dateCondition = "DATE(w.date) >= date_trunc('month', CURRENT_DATE)";
        } elseif ($range === '3m') {
            $dateCondition = "DATE(w.date) >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')";
        }

        // Fetch ALL users rank based on user_totals (All Time Accumulation)
        // This solves the issue of Leaderboard resetting or dropping data when the date range (e.g. year) changes.
        // User explicitly requested "Total" to prevent data deletion perception.
        
        $limitCondition = ""; 
        // If we really want to support ranges for Leaderboard, we can keep the old logic for specific ranges,
        // but given the user report, "Total" seems to be what matters most.
        // Let's use user_totals for the main score.
        
        $stmt = $pdo->prepare(
            "SELECT u.id, u.display_name, t.total_calories as total, u.avatar_id
             FROM users u 
             JOIN user_totals t ON u.id = t.user_id 
             ORDER BY total DESC"
        );
        $stmt->execute();
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
    if ($action === 'ai_coach') {
        if (!$coachAvailable) {
            sendResponse(['success' => false, 'message' => 'AI Coach not available']);
        }
        
        if (!isset($_SESSION['user_id'])) {
            sendResponse(['success' => false, 'message' => 'Not logged in']);
        }
        
        $message = trim($input['message'] ?? '');
        if ($message === '') {
            sendResponse(['success' => false, 'message' => 'Message cannot be empty']);
        }
        
        try {
            // Fix: call existing function askCoachFromDb without $pdo
            $response = askCoachFromDb($_SESSION['user_id'], $message);
            sendResponse(['success' => true, 'response' => $response]);
        } catch (Exception $e) {
            sendResponse(['success' => false, 'message' => 'AI Coach error: ' . $e->getMessage()]);
        }
    }
    
    // Unknown action
    sendResponse(['success' => false, 'message' => 'Unknown action: ' . $action]);
    
} catch (PDOException $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database error: ' . $e->getMessage(), // Added message key
        'error' => 'Database error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'type' => 'PDOException'
    ], JSON_UNESCAPED_UNICODE);
    exit;
    
} catch (Exception $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage(), // Added message key
        'error' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'type' => 'Exception'
    ], JSON_UNESCAPED_UNICODE);
    exit;
    
} catch (Throwable $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Fatal error: ' . $e->getMessage(), // Added message key
        'error' => 'Fatal error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'type' => 'Throwable'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
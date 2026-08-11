<?php
// test_email.php
// 用於手動測試 Resend Email 發送功能

if (getenv('ALLOW_DEBUG_TOOLS') !== '1') {
    http_response_code(404);
    exit('Not found');
}

error_reporting(E_ALL);
ini_set('display_errors', '1');

echo "<h1>📧 Resend API 測試工具</h1>";

// 1. 載入設定檔與郵件函式庫
$configFile = __DIR__ . '/config.php';
$mailFile = __DIR__ . '/mail.php';

if (!file_exists($configFile)) {
    die("❌ 找不到 config.php");
}
require_once $configFile;

if (!file_exists($mailFile)) {
    die("❌ 找不到 mail.php");
}
require_once $mailFile;

// 2. 檢查 API Key
$apiKey = defined('RESEND_API_KEY') ? RESEND_API_KEY : getenv('RESEND_API_KEY');

if (!$apiKey) {
    echo "<div style='color: red; border: 1px solid red; padding: 10px;'>❌ 錯誤：找不到 RESEND_API_KEY 環境變數。請在 config.php 或 Railway 變數中設定。</div>";
    echo "<p>當前環境變數:</pre>";
    // print_r(getenv()); // 安全起見，不印出所有變數
    exit;
} else {
    // 遮蔽顯示 Key
    $maskedKey = substr($apiKey, 0, 4) . '...' . substr($apiKey, -4);
    echo "<div style='color: green; border: 1px solid green; padding: 10px; margin-bottom: 10px;'>✅ API Key 已偵測到: $maskedKey</div>";
    
    $fromEmail = defined('RESEND_FROM_EMAIL') ? RESEND_FROM_EMAIL : 'onboarding@resend.dev';
    echo "<div style='color: blue; border: 1px solid blue; padding: 10px;'>📧 寄件者: $fromEmail</div>";
}

// 3. 處理表單提交
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $to = $_POST['to'] ?? '';
    
    if (filter_var($to, FILTER_VALIDATE_EMAIL)) {
        echo "<hr><h3>🔄 正在發送到: $to ...</h3>";
        
        $subject = "【FitConnect】測試郵件 " . date('Y-m-d H:i:s');
        $html = "
            <h2>這是一封測試郵件</h2>
            <p>恭喜！您的 Resend API 設定運作正常。</p>
            <p>發送時間: " . date('Y-m-d H:i:s') . "</p>
            <hr>
            <p>FitConnect Team</p>
        ";
        
        // 呼叫 mail.php 中的 sendResendEmail
        // 假設 sendResendEmail ($to, $subject, $htmlBody, $pdo, $userId, $type)
        // 這裡測試不寫入 DB ($pdo, $userId 傳 null/0)
        
        $result = sendResendEmail($to, $subject, $html, null, 0, 'test');
        
        if ($result) {
            echo "<h2 style='color: green;'>🎉 發送成功！請檢查收件匣。</h2>";
        } else {
            echo "<h2 style='color: red;'>💥 發送失敗。請檢查 error log 或 API Key 權限。</h2>";
        }
    } else {
        echo "<h3 style='color: red;'>❌ 無效的 Email 格式</h3>";
    }
}
?>

<hr>
<form method="POST" style="background: #f9f9f9; padding: 20px; border-radius: 8px; max-width: 500px;">
    <label style="display: block; margin-bottom: 10px; font-weight: bold;">接收測試信的 Email:</label>
    <input type="email" name="to" required placeholder="yourname@example.com" style="width: 100%; padding: 10px; margin-bottom: 10px;">
    <button type="submit" style="background: #007bff; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 4px;">🚀 發送測試信</button>
</form>

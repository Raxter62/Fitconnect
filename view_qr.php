<?php
// view_qr.php - 重新導向至動態 QR API 或顯示特定圖片
// 為了演示簡單性，我們使用公開 API 來渲染綁定 URL 或 Line 加好友 URL 的 QR Code。

// 注意：在真實情境中，你可能透過 GET 參數傳遞 URL 或資料
$data = $_GET['data'] ?? 'https://line.me/R/ti/p/@yourid'; // 預設為 Line 加好友 URL

// 使用 qrserver.com API 產生 QR code 圖片
$qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" . urlencode($data);

// 直接導向圖片，讓這個 PHP 檔案行為像一張圖片
header("Location: $qrUrl");
exit;

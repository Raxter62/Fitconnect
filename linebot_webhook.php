<?php
// linebot_webhook.php
require_once 'config.php';

// MET values shared logic
const MET_VALUES = [
    '跑步' => 10,
    '重訓' => 4,
    '腳踏車' => 8,
    '游泳' => 6,
    '瑜珈' => 3,
    '其他' => 2
];

if (!$pdo) {
    error_log("linebot_webhook.php: DB connection failed");
    http_response_code(500);
    exit;
}

// 1. 取得原始輸入
$input = file_get_contents('php://input');
$events = json_decode($input, true);

if (!isset($events['events'])) {
    http_response_code(200);
    exit;
}

// 2. 遍歷事件
foreach ($events['events'] as $event) {
    $replyToken = $event['replyToken'];
    $lineUserId = $event['source']['userId'];
    $type = $event['type'];

    // Handle Postback (Button Clicks)
    if ($type == 'postback') {
        $data = $event['postback']['data'];
        
        if ($data === 'action=bind_menu') {
            replyLineMessage($replyToken, "請輸入「綁定 驗證碼」\n例如：綁定 123456");
        } elseif ($data === 'action=workout_menu') {
            replyLineMessage($replyToken, "請依照格式輸入運動紀錄：\n項目 分鐘數\n例如：跑步 30\n(支援項目：跑步, 重訓, 腳踏車, 游泳, 瑜珈, 其他)");
        } elseif ($data === 'action=profile_menu') {
            replyLineMessage($replyToken, "請依照格式輸入身高體重：\n身高 體重\n例如：175 65");
        }
        continue;
    }

    // Handle Message
    if ($type == 'message' && $event['message']['type'] == 'text') {
        $text = trim($event['message']['text']);

        // Show Menu (Triggered by '選單', 'Menu', 'menu', '表單')
        if ($text === '選單' || $text === 'Menu' || $text === 'menu' || $text === '表單') {
            replyMainMenu($replyToken);
            continue;
        }

        // Default Response for ANY other text
        replyLineMessage($replyToken, "請輸入「選單」呼叫互動式選單");
    }
}

http_response_code(200);

// Functions

function getLineAccessToken(): ?string {
    if (defined('LINE_CHANNEL_TOKEN') && LINE_CHANNEL_TOKEN) return LINE_CHANNEL_TOKEN;

    $t = getenv('LINE_CHANNEL_TOKEN');
    if ($t) return $t;

    // 有些人命名成 LINE_CHANNEL_ACCESS_TOKEN
    $t = getenv('LINE_CHANNEL_ACCESS_TOKEN');
    if ($t) return $t;

    // 你原本寫了 global $accessToken，就也吃它
    if (isset($GLOBALS['accessToken']) && $GLOBALS['accessToken']) return $GLOBALS['accessToken'];

    return null;
}


function replyLineMessage($replyToken, $text) {
    global $accessToken; 
    // Re-define token here or use constant
    $accessToken = getLineAccessToken();
    if (!$accessToken) {
        error_log("LINE token missing: set LINE_CHANNEL_TOKEN env or define LINE_CHANNEL_TOKEN");
        return;
    }

    $url = "https://api.line.me/v2/bot/message/reply";
    $data = [
        "replyToken" => $replyToken,
        "messages" => [
            ["type" => "text", "text" => $text]
        ]
    ];

    postLineApi($url, $data, $accessToken);
}

function replyMainMenu($replyToken) {
    if (!defined('LINE_CHANNEL_TOKEN')) return;
    $accessToken = LINE_CHANNEL_TOKEN;

    $url = "https://api.line.me/v2/bot/message/reply";
    $data = [
        "replyToken" => $replyToken,
        "messages" => [
            [
                "type" => "template",
                "altText" => "FitConnect 選單",
                "template" => [
                    "type" => "buttons",
                    "thumbnailImageUrl" => "https://fitconnect.up.railway.app/public/image/logo/logo.png",
                    "imageAspectRatio" => "rectangle",
                    "imageSize" => "cover",
                    "imageBackgroundColor" => "#FFFFFF",
                    "title" => "FitConnect 助手",
                    "text" => "請選擇功能",
                    "defaultAction" => [
                        "type" => "uri",
                        "label" => "View detail",
                        "uri" => "https://fitconnect.up.railway.app/"
                    ],
                    "actions" => [
                        [
                            "type" => "uri",
                            "label" => "🔗 帳號綁定",
                            "uri" => "https://liff.line.me/" . (defined('LIFF_ID') ? LIFF_ID : '') . "?path=bind"
                        ],
                        [
                            "type" => "uri",
                            "label" => "🏃 新增運動",
                            "uri" => "https://liff.line.me/" . (defined('LIFF_ID') ? LIFF_ID : '') . "?path=workout"
                        ],
                        [
                            "type" => "uri",
                            "label" => "📝 個人資料",
                            "uri" => "https://liff.line.me/" . (defined('LIFF_ID') ? LIFF_ID : '') . "?path=profile"
                        ],
                        [
                            "type" => "uri",
                            "label" => "🌐 開啟網頁",
                            "uri" => "https://fitconnect.up.railway.app/"
                        ]
                    ]
                ]
            ]
        ]
    ];

    postLineApi($url, $data, $accessToken);
}

function postLineApi($url, $data, $token) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json",
        "Authorization: Bearer " . $token
    ]);
    $result = curl_exec($ch);
    // error_log("LINE API Result: " . $result);
    curl_close($ch);
}

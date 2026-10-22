<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FitConnect 助手</title>
    <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
        .hidden { display: none !important; }
        .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 20px; }
        h2 { margin-top: 0; color: #FF6B35; font-size: 1.4rem; }
        label { display: block; margin: 10px 0 5px; color: #666; font-size: 0.9rem; }
        input, select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; box-sizing: border-box; margin-bottom: 10px; }
        button { width: 100%; padding: 14px; background: #FF6B35; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: bold; cursor: pointer; margin-top: 10px; }
        button:disabled { background: #ccc; }
        button.secondary { background: #eee; color: #666; }
        .success-msg { color: #28a745; margin-top: 10px; text-align: center; }
        .error-msg { color: #dc3545; margin-top: 10px; text-align: center; }
        #loading { text-align: center; margin-top: 50px; color: #888; }
    </style>
</head>
<body>

    <div id="loading">讀取中...</div>

    <!-- 1. 綁定頁面 -->
    <div id="view-bind" class="hidden">
        <div class="card">
            <h2>🔗 帳號綁定</h2>
            <p style="color:#666; font-size:0.9rem;">請輸入網頁版顯示的 6 位數綁定碼</p>
            <input type="text" id="bind-code" placeholder="請輸入綁定碼" maxlength="10">
            <button onclick="doBind()">開始綁定</button>
            <div id="bind-msg" class="error-msg"></div>
        </div>
    </div>

    <!-- 已綁定狀態 -->
    <div id="view-bound-status" class="hidden">
        <div class="card" style="text-align: center;">
            <div style="font-size: 3rem;">✅</div>
            <h2>已綁定成功</h2>
            <p id="user-info-display"></p>
            <button class="secondary" onclick="doUnbind()" style="font-size: 0.8rem; padding: 8px; margin-top: 20px;">取消綁定</button>
        </div>
    </div>

    <!-- 2. 運動紀錄 -->
    <div id="view-workout" class="hidden">
        <div class="card">
            <h2>🏃 新增運動紀錄</h2>
            
            <label>日期與時間</label>
            <div style="display: flex; gap: 10px;">
                <input type="date" id="work-date" style="flex: 2;">
                <input type="time" id="work-time" style="flex: 1;">
            </div>

            <label>運動項目</label>
            <select id="work-type">
                <option value="跑步">跑步</option>
                <option value="重訓">重訓</option>
                <option value="腳踏車">腳踏車</option>
                <option value="游泳">游泳</option>
                <option value="瑜珈">瑜珈</option>
                <option value="其他">其他</option>
            </select>
            
            <label>時間 (分鐘)</label>
            <input type="number" id="work-min" placeholder="30">
            
            <button onclick="submitWorkout()">送出紀錄</button>
        </div>
    </div>

    <!-- 3. 個人資料 -->
    <div id="view-profile" class="hidden">
        <div class="card">
            <h2>📝 編輯個人資料</h2>
            <label>暱稱</label>
            <input type="text" id="prof-name">
            
            <label>身高 (cm)</label>
            <input type="number" id="prof-height">
            
            <label>體重 (kg)</label>
            <input type="number" id="prof-weight">
            
            <button onclick="submitProfile()">儲存修改</button>
        </div>
    </div>

    <script>
        const API_URL = 'api.php';
        let lineUserId = '';
        let liffId = ''; 
        let workoutRequest = null;
        
        async function init() {
            try {
                //自動取得用戶line id
                await liff.init({ liffId: "<?php require_once '../config.php'; echo LIFF_ID; ?>" });
                
                if (!liff.isLoggedIn()) {
                    liff.login();
                    return;
                }

                if (!liff.getIDToken()) throw new Error('需要 LINE openid 權限，請聯絡管理員。');
                document.getElementById('loading').classList.add('hidden');

                // Routing
                const urlParams = new URLSearchParams(window.location.search);
                const path = urlParams.get('path'); // bind, workout, profile

                // Check binding status first
                const status = await apiPost('get_user_status', {});

                if (path === 'bind') {
                    if (status.bound) {
                        showBoundStatus(status.user);
                    } else {
                        document.getElementById('view-bind').classList.remove('hidden');
                    }
                } else if (path === 'workout') {
                    if (!status.bound) {
                        alert('請先進行帳號綁定');
                        window.location.href = '?path=bind';
                    } else {
                        document.getElementById('view-workout').classList.remove('hidden');
                        
                        // Set default date and time
                        const now = new Date();
                        
                        // YYYY-MM-DD
                        const yyyy = now.getFullYear();
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        const dd = String(now.getDate()).padStart(2, '0');
                        document.getElementById('work-date').value = `${yyyy}-${mm}-${dd}`;

                        // HH:MM
                        const hh = String(now.getHours()).padStart(2, '0');
                        const min = String(now.getMinutes()).padStart(2, '0');
                        document.getElementById('work-time').value = `${hh}:${min}`;
                    }
                } else if (path === 'profile') {
                    if (!status.bound) {
                        alert('請先進行帳號綁定');
                        window.location.href = '?path=bind';
                    } else {
                        document.getElementById('view-profile').classList.remove('hidden');
                        // Fill data
                        document.getElementById('prof-name').value = status.user.display_name;
                        document.getElementById('prof-height').value = status.user.height;
                        document.getElementById('prof-weight').value = status.user.weight;
                    }
                } else {
                    // Default to bind or welcome?
                    if (status.bound) {
                        alert('歡迎使用 FitConnect 助手！');
                        document.getElementById('view-workout').classList.remove('hidden');
                    } else {
                        document.getElementById('view-bind').classList.remove('hidden');
                    }
                }

            } catch (err) {
                document.getElementById('loading').textContent = '初始化失敗: ' + err.message;
            }
        }

        function showBoundStatus(user) {
            document.getElementById('view-bind').classList.add('hidden');
            document.getElementById('view-bound-status').classList.remove('hidden');
            document.getElementById('user-info-display').textContent = 
                `${user.display_name} (H:${user.height}cm, W:${user.weight}kg)`;
        }

        async function doBind() {
            const code = document.getElementById('bind-code').value;
            if (!code) return alert('請輸入綁定碼');
            
            const res = await apiPost('bind_user', { code });
            if (res.success) {
                alert('綁定成功');
                location.reload();
            } else {
                document.getElementById('bind-msg').textContent = res.message;
            }
        }

        async function doUnbind() {
            if (!confirm('確定要解除綁定嗎？')) return;
            const res = await apiPost('unbind_user', {});
            if (res.success) {
                alert('已解除綁定');
                location.reload();
            }
        }

        async function submitWorkout() {
            const datePart = document.getElementById('work-date').value;
            const timePart = document.getElementById('work-time').value;
            const type = document.getElementById('work-type').value;
            const minutes = document.getElementById('work-min').value;
            
            if (!datePart || !timePart) return alert('請完整填寫日期與時間');
            
            // Combine to YYYY-MM-DD HH:MM:00
            const fullDate = `${datePart} ${timePart}:00`;

            const payload = JSON.stringify([fullDate, type, minutes]);
            if (!workoutRequest || workoutRequest.payload !== payload) workoutRequest = { payload, key: crypto.randomUUID() };
            const res = await apiPost('add_workout', { date: fullDate, type, minutes, request_key: workoutRequest.key });
            if (res.success) {
                alert(`紀錄已儲存！消耗卡路里: ${res.calories}`);
                liff.closeWindow();
            } else {
                alert('錯誤: ' + res.message);
            }
        }

        async function submitProfile() {
            const data = {
                display_name: document.getElementById('prof-name').value,
                height: document.getElementById('prof-height').value,
                weight: document.getElementById('prof-weight').value
            };
            
            const res = await apiPost('update_profile', data);
            if (res.success) {
                alert('個人資料已更新');
                liff.closeWindow();
            } else {
                alert('錯誤: ' + res.message);
            }
        }

        async function apiPost(action, data) {
            data.action = action;
            data.idToken = liff.getIDToken();
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return await res.json();
        }

        init();
    </script>
</body>
</html>

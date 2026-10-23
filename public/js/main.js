// public/js/main.js - COMPLETE FIXED VERSION

const API_URL = 'submit.php';
let currentUser = null;
let isDemoMode = false;
let globalTimeRange = '1d';
let statsTimeRange = '1d';
let bindPollInterval = null;
let leaderboardPollInterval = null; // 排行榜即時更新 Timer
let deferredPrompt = null; // PWA Install Prompt
let csrfToken = '';
const leaderboardRanges = ['1d', '1wk', '1m', '3m', 'total'];
let leaderboardLoadSeq = 0;
let statsLoadSeq = 0;
let leaderboardAnimationTimer = null;

// === PWA Install Logic ===
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    console.log('📲 PWA 可安裝事件觸發');

    // Update UI notify the user they can install the PWA
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
        installBtn.style.display = 'block';
    }
});

window.addEventListener('appinstalled', () => {
    console.log('✅ PWA 已安裝');
    deferredPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'none';
});

async function triggerInstall() {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA 安裝選擇結果: ${outcome}`);

    // We've used the prompt, and can't use it again, throw it away
    deferredPrompt = null;

    // Hide button immediately after click (optional, depending on UX preference)
    // const installBtn = document.getElementById('pwa-install-btn');
    // if (installBtn) installBtn.style.display = 'none';
}

const SPORT_ICONS = {
    '跑步': '🏃', '重訓': '🏋️', '腳踏車': '🚴',
    '游泳': '🏊', '瑜珈': '🧘', '其他': '🤸'
};

// === 確保 DOM 完全載入後才執行 ===
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM 已經載入完成
    initApp();
}

// ✅ Service Worker register
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
            .then((reg) => {
                console.log('SW registered!', reg);
                reg.update().catch(err => console.log('SW update unavailable:', err));

                // （可選）如果有新版在 waiting，請它立刻接管
                if (reg.waiting) {
                    reg.waiting.postMessage('SKIP_WAITING');
                }

                // （可選）監聽更新：一旦有新 SW 安裝好，就請它 skipWaiting
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            newWorker.postMessage('SKIP_WAITING');
                        }
                    });
                });
            })
            .catch((err) => console.log('SW failed!', err));
    });
}

function initApp() {
    console.log('✅ FitConnect 初始化開始...');

    // 延遲執行確保所有元素都已渲染
    setTimeout(() => {
        console.log('🔧 開始設置應用程式...');

        showLogin(); // Force login screen by default
        setupForms();
        generateAvatarGrid();
        setupCoachInteraction();
        setupDateTimeDefaults();
        setupMobileNav();
        fcSetupFeatures();

        console.log('✅ 應用程式設置完成');
    }, 200);
}

function setupDateTimeDefaults() {
    // 移除預設時間設定，保持輸入框空白
}

function authJsonHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return headers;
}

// === Auth ===
function showLogin() {
    const authView = document.getElementById('auth-view');
    const dashboardView = document.getElementById('dashboard-view');
    const coachContainer = document.getElementById('ai-coach-container');

    if (authView) authView.classList.remove('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    if (coachContainer) coachContainer.classList.add('hidden');

    // 清空登入表單
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        const emailInput = loginForm.querySelector('input[name="email"]');
        const passwordInput = loginForm.querySelector('input[name="password"]');
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
    }

    // 清空註冊表單
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        const nameInput = registerForm.querySelector('input[name="display_name"]');
        const emailInput = registerForm.querySelector('input[name="email"]');
        const passwordInput = registerForm.querySelector('input[name="password"]');
        if (nameInput) nameInput.value = '';
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
    }

    // 切換回登入 tab
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');

    if (loginForm && registerForm) {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    }

    // 設定按鈕樣式：登入按鈕為橘色
    if (loginTab) {
        loginTab.classList.add('active');
        loginTab.style.backgroundColor = '#FF6B35';
        loginTab.style.color = 'white';
    }
    if (registerTab) {
        registerTab.classList.remove('active');
        registerTab.style.backgroundColor = 'transparent';
        registerTab.style.color = '#666';
    }

    console.log('✅ 已清空表單欄位');
}

function showDashboard() {
    const authView = document.getElementById('auth-view');
    const dashboardView = document.getElementById('dashboard-view');
    const coachContainer = document.getElementById('ai-coach-container');

    if (authView) authView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.remove('hidden');
    if (coachContainer) coachContainer.classList.remove('hidden');

    const displayNameEl = document.getElementById('user-display-name');
    if (displayNameEl) {
        displayNameEl.textContent = currentUser.display_name;
    }

    updateProfileUI();

    // 載入用戶頭像
    currentAvatarIndex = currentUser.avatar_id || 1;
    const avatarImg = document.getElementById('current-avatar');
    if (avatarImg) {
        avatarImg.src = `public/image/${currentAvatarIndex}.png`;
    }

    setGlobalRange('1d');
    fcShowDashboardPage();

    // Start Auto Refresh (Profile, Stats, Leaderboard)
    startAutoRefresh();

    // Reset and Update LINE Binding UI
    const notBoundEl = document.getElementById('not-bound');
    const alreadyBoundEl = document.getElementById('already-bound');
    const bindCodeDisplay = document.getElementById('bind-code-display');
    const qrDiv = document.getElementById('qrcode');
    const codeText = document.getElementById('bind-code-text');

    if (currentUser.line_user_id) {
        if (notBoundEl) notBoundEl.style.display = 'none';
        if (bindCodeDisplay) bindCodeDisplay.style.display = 'none'; // Ensure this is hidden too
        if (alreadyBoundEl) alreadyBoundEl.style.display = 'block';
    } else {
        if (notBoundEl) notBoundEl.style.display = 'block';
        if (alreadyBoundEl) alreadyBoundEl.style.display = 'none';

        // Key Fix: Reset the Code Display area so it doesn't persist from previous user
        if (bindCodeDisplay) bindCodeDisplay.style.display = 'none';
        if (qrDiv) qrDiv.innerHTML = '';
        if (codeText) codeText.textContent = '------';
    }
}

function demoLogin() {
    console.log('🎭 進入 Demo 模式');
    isDemoMode = true;
    currentUser = { id: 999, display_name: 'Demo Hero', email: 'demo@fit.com' };
    showDashboard();
}

let logoutPending = false;

async function logout() {
    if (logoutPending) return;
    logoutPending = true;
    const button = document.getElementById('nav-logout');
    button?.setAttribute('aria-busy', 'true');
    console.log('👋 登出中...');
    try {
        if (!isDemoMode) {
            const result = await fetchPost('logout', {});
            if (!result.success && currentUser) throw new Error('Logout was not confirmed');
        }
        fcExpireSession('');
    } catch (error) {
        console.error('Logout failed:', error);
        alert('暫時無法登出，請稍後再試。');
    } finally {
        logoutPending = false;
        button?.removeAttribute('aria-busy');
    }
}

// === 表單設置（加強版）===
function setupForms() {
    console.log('🔧 設置表單事件...');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const workoutForm = document.getElementById('add-workout-form');

    if (loginForm) {
        // 移除舊的事件監聽器（如果有）
        loginForm.onsubmit = null;

        loginForm.addEventListener('submit', handleLogin);
        console.log('✅ 登入表單已綁定');
    } else {
        console.error('❌ 找不到 login-form 元素');
    }

    if (registerForm) {
        registerForm.onsubmit = null;
        registerForm.addEventListener('submit', handleRegister);
        console.log('✅ 註冊表單已綁定');
    } else {
        console.error('❌ 找不到 register-form 元素');
    }

    if (workoutForm) {
        workoutForm.onsubmit = handleAddWorkout;
        console.log('✅ 運動記錄表單已綁定');
    } else {
        console.log('ℹ️ add-workout-form 不存在（在儀表板頁面才有）');
    }
}

function switchTab(tab) {
    fcAccountView(tab);
    const loginFn = document.getElementById('login-form');
    const regFn = document.getElementById('register-form');
    const loginBtn = document.getElementById('tab-login');
    const registerBtn = document.getElementById('tab-register');

    if (!loginFn || !regFn) return;

    if (tab === 'login') {
        // 顯示登入表單
        loginFn.classList.remove('hidden');
        regFn.classList.add('hidden');

        // 切換按鈕樣式
        if (loginBtn) {
            loginBtn.classList.add('active');
            loginBtn.style.backgroundColor = '#FF6B35';
            loginBtn.style.color = 'white';
        }
        if (registerBtn) {
            registerBtn.classList.remove('active');
            registerBtn.style.backgroundColor = 'transparent';
            registerBtn.style.color = '#666';
        }
    } else {
        // 顯示註冊表單
        loginFn.classList.add('hidden');
        regFn.classList.remove('hidden');

        // 切換按鈕樣式
        if (loginBtn) {
            loginBtn.classList.remove('active');
            loginBtn.style.backgroundColor = 'transparent';
            loginBtn.style.color = '#666';
        }
        if (registerBtn) {
            registerBtn.classList.add('active');
            registerBtn.style.backgroundColor = '#FF6B35';
            registerBtn.style.color = 'white';
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    console.log('🔐 處理登入請求...');

    const form = e.target;
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');

    if (!emailInput || !passwordInput) {
        console.error('❌ 找不到 email 或 password 欄位');
        alert('表單錯誤，請重新整理頁面');
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        alert('請輸入 Email 與密碼');
        return;
    }

    console.log('📤 發送登入請求:', email);

    try {
        const json = await fetchPost('login', { email, password });
        console.log('📥 登入回應:', json);

        if (json.success) {
            if (json.csrf_token) csrfToken = json.csrf_token;
            console.log('✅ 登入成功，載入使用者資訊...');

            // 取得使用者資訊
            const userRes = await fetch(`${API_URL}?action=get_user_info`, {
                credentials: 'same-origin'
            });
            const userData = await userRes.json();
            if (userData.csrf_token) csrfToken = userData.csrf_token;

            if (userData.success && userData.data) {
                console.log('✅ 使用者資訊:', userData.data);
                currentUser = userData.data;
                showDashboard();
            } else {
                alert('無法取得使用者資訊');
            }
        } else {
            console.error('❌ 登入失敗:', json.message);
            if (json.verification_required) fcAccountView('resend', email);
            fcAuthMessage(json.message || '帳號或密碼錯誤');
        }
    } catch (err) {
        console.error('❌ 登入錯誤:', err);
        alert('連線錯誤: ' + err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    console.log('📝 處理註冊請求...');

    const form = e.target;
    const nameInput = form.querySelector('input[name="display_name"]');
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');

    if (!nameInput || !emailInput || !passwordInput) {
        console.error('❌ 找不到必要欄位');
        alert('表單錯誤，請重新整理頁面');
        return;
    }

    const display_name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!display_name || !email || !password) {
        alert('請輸入暱稱、Email 與密碼');
        return;
    }

    console.log('📤 發送註冊請求:', email);

    try {
        const json = await fetchPost('register', { display_name, email, password });
        console.log('📥 註冊回應:', json);

        if (json.verification_required) {
            fcAccountView('resend', email);
            fcAuthMessage(json.message, !!json.email_sent);
            form.reset();
            return;
        }

        if (json.success) {
            if (json.csrf_token) csrfToken = json.csrf_token;
            console.log('✅ 註冊成功，載入使用者資訊...');

            // 取得使用者資訊
            const userRes = await fetch(`${API_URL}?action=get_user_info`, {
                credentials: 'same-origin'
            });
            const userData = await userRes.json();
            if (userData.csrf_token) csrfToken = userData.csrf_token;

            if (userData.success && userData.data) {
                console.log('✅ 使用者資訊:', userData.data);
                currentUser = userData.data;
                showDashboard();
            } else {
                alert('無法取得使用者資訊');
            }
        } else {
            console.error('❌ 註冊失敗:', json.message);
            alert('註冊失敗: ' + (json.message || '未知錯誤'));
        }
    } catch (err) {
        console.error('❌ 註冊錯誤:', err);
        alert('連線錯誤: ' + err.message);
    }
}

async function handleAddWorkout(e) {
    e.preventDefault();
    if (isDemoMode) {
        alert('Demo 模式無法新增運動記錄');
        return;
    }

    const form = e.target;
    const datePart = form.querySelector('#input-date-part').value;
    const timePart = form.querySelector('#input-time-part').value;
    const type = form.querySelector('#input-sport').value;
    const minutes = parseInt(form.querySelector('#input-minutes').value) || 0;

    // 嚴格檢查身高體重 (轉為浮點數判斷是否大於 0)
    const userHeight = parseFloat(currentUser?.height || 0);
    const userWeight = parseFloat(currentUser?.weight || 0);

    if (!currentUser || userHeight <= 0 || userWeight <= 0) {
        alert('請先完善個人資料，點擊名字旁的鉛筆即可編輯');
        showEditProfileModal();
        return;
    }

    if (!datePart || !timePart || !type || minutes <= 0) {
        alert('請輸入完整資料');
        return;
    }

    const datetime = `${datePart} ${timePart}:00`;
    const payloadKey = JSON.stringify([datetime, type, minutes]);
    if (form.dataset.pendingPayload !== payloadKey) {
        form.dataset.pendingPayload = payloadKey;
        form.dataset.requestKey = crypto.randomUUID();
    }
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;

    try {
        const json = await fetchPost('add_workout', {
            date: datetime,
            type,
            minutes,
            request_key: form.dataset.requestKey
        });

        if (json.success) {
            alert('運動記錄已新增');

            // Check for new achievements
            if (json.achievements && json.achievements.length > 0) {
                json.achievements.forEach(ach => {
                    showAchievementNotification(ach.title, ach.img);
                });
            }

            form.reset();
            delete form.dataset.pendingPayload;
            delete form.dataset.requestKey;
            // Fix: Explicitly reset the calculated value display to 0
            const calcVal = document.getElementById('calc-val');
            if (calcVal) calcVal.textContent = '0';

            document.getElementById('calorie-display-area').classList.add('hidden');
            setupDateTimeDefaults();
            setGlobalRange(globalTimeRange);
            if (globalTimeRange === 'total') fetchStats(statsTimeRange);
            fcWorkoutsChanged();
            fcInvalidateReport();
        } else {
            alert('新增失敗: ' + (json.message || ''));
        }
    } catch (err) {
        console.error('新增運動錯誤:', err);
        alert('連線錯誤: ' + err.message);
    } finally {
        submitButton.disabled = false;
    }
}

function setGlobalRange(range) {
    const previousRange = globalTimeRange;
    const shouldAnimateLeaderboard = previousRange !== range;
    globalTimeRange = range;

    // Update active button state
    document.querySelectorAll('.g-time-btn').forEach(btn => {
        const activeRange = btn.closest('.leaderboard-time-switch') ? range : (range === 'total' ? statsTimeRange : range);
        btn.classList.toggle('active', btn.dataset.range === activeRange);
    });

    if (range !== 'total') {
        statsTimeRange = range;
        fetchStats(range);
    }
    loadLeaderboard({
        animate: shouldAnimateLeaderboard,
        direction: getLeaderboardDirection(previousRange, range)
    });
}
window.setGlobalRange = setGlobalRange;

function getLeaderboardDirection(previousRange, nextRange) {
    const previousIndex = leaderboardRanges.indexOf(previousRange);
    const nextIndex = leaderboardRanges.indexOf(nextRange);
    if (previousIndex === -1 || nextIndex === -1) return 'forward';
    return nextIndex >= previousIndex ? 'forward' : 'back';
}

async function fetchStats(range) {
    const loadSeq = ++statsLoadSeq;
    const owner = currentUser?.id;
    const charts = document.querySelectorAll('.chart-box canvas');
    charts.forEach(c => {
        c.style.transition = 'opacity 0.3s';
        c.style.opacity = '0.5';
    });

    try {
        const json = isDemoMode
            ? getDemoStats(range)
            : await fcGet('get_stats', { range });

        if (loadSeq !== statsLoadSeq || owner !== currentUser?.id) return;

        if (!json.success) {
            console.error('Stats failed:', json.message);
            return;
        }

        // json.time_chart, json.type_chart, json.cal_chart
        renderChart(json.time_chart || [], range);
        renderTypeChart(json.type_chart || []);
        renderCalorieChart(json.cal_chart || [], range);

    } catch (e) {
        console.error('Stats error:', e);
    } finally {
        if (loadSeq === statsLoadSeq) {
            charts.forEach(c => c.style.opacity = '1');
            updateChartDateLabel(range);
        }
    }
}

function updateChartDateLabel(range) {
    const titleEls = document.querySelectorAll('.chart-box .chart-title');
    const label = getDateRangeString(range);

    titleEls.forEach(titleEl => {
        // Reset base title
        if (!titleEl.dataset.baseTitle) {
            // Check if there is already a date-label inside, if so, ignore it for baseTitle
            const existingSpan = titleEl.querySelector('.date-label');
            const clone = titleEl.cloneNode(true);
            if (existingSpan) {
                const cloneSpan = clone.querySelector('.date-label');
                if (cloneSpan) cloneSpan.remove();
            }
            titleEl.dataset.baseTitle = clone.textContent.trim();
        }

        // Create or update span
        let dateSpan = titleEl.querySelector('.date-label');
        if (!dateSpan) {
            dateSpan = document.createElement('span');
            dateSpan.className = 'date-label';
            dateSpan.style.cssText = "font-size: 0.9rem; color: #666; margin-left: 10px; font-weight: normal;";
            titleEl.appendChild(dateSpan);
        }
        dateSpan.textContent = label;
    });
}

function getDateRangeString(range) {
    const now = new Date();
    const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

    if (range === '1d') {
        return formatDate(now);
    } else if (range === '1wk') {
        // Current week (Monday to Sunday) logic matching backend "1wk"
        // Backend uses date_trunc('week', CURRENT_DATE). 
        // JS: getDay(): 0=Sun, 1=Mon.
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        const monday = new Date(now.setDate(diff));
        const sunday = new Date(now.setDate(diff + 6));
        return `${formatDate(monday)}~${formatDate(sunday)}`;
    } else if (range === '1m') {
        // Current month 1st to End
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return `${formatDate(firstDay)}~${formatDate(lastDay)}`;
    } else if (range === '3m') {
        // Recent 3 months (Current month and previous 2)
        const firstDay = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return `${formatDate(firstDay)}~${formatDate(lastDay)}`;
    }
    return '';
}

// 顯示成就通知
function showAchievementNotification(title, imgName) {
    const notifyBox = document.createElement('div');
    notifyBox.className = 'achievement-notification';

    const safeImgName = /^[a-zA-Z0-9._-]+$/.test(String(imgName)) ? imgName : 'first.png';
    const content = document.createElement('div');
    Object.assign(content.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
    });

    const medalImg = document.createElement('img');
    medalImg.src = `public/image/Achievement/${safeImgName}`;
    medalImg.alt = 'Medal';
    Object.assign(medalImg.style, {
        width: '50px',
        height: '50px',
        objectFit: 'contain'
    });

    const textWrap = document.createElement('div');
    const heading = document.createElement('h4');
    heading.textContent = '🏆 成就解鎖！';
    Object.assign(heading.style, {
        margin: '0',
        color: '#ff9800',
        fontSize: '1.1rem'
    });

    const titleText = document.createElement('p');
    titleText.textContent = String(title || '');
    Object.assign(titleText.style, {
        margin: '5px 0 0 0',
        color: '#333',
        fontWeight: 'bold'
    });

    textWrap.appendChild(heading);
    textWrap.appendChild(titleText);
    content.appendChild(medalImg);
    content.appendChild(textWrap);
    notifyBox.appendChild(content);

    // Style (Inline for simplicity or add to CSS)
    Object.assign(notifyBox.style, {
        position: 'fixed',
        bottom: '20px',
        left: '-320px', // Start off-screen
        width: '300px',
        background: 'white',
        boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
        borderRadius: '12px',
        padding: '1.5rem',
        zIndex: '10000',
        transition: 'left 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)' // Spring effect
    });

    document.body.appendChild(notifyBox);

    // Slide In
    setTimeout(() => {
        notifyBox.style.left = '20px';
    }, 100);

    // Slide Out after 10 seconds
    setTimeout(() => {
        notifyBox.style.left = '-320px';
        setTimeout(() => {
            notifyBox.remove();
        }, 600); // Wait for transition
    }, 10000);
}

function getDemoStats(range) {
    // Mock demo data matching new logic structure if needed, or leave simple for now
    return {
        success: true,
        time_chart: [{ label: '09:00', total: 30 }],
        type_chart: [{ type: 'Running', total: 30 }],
        cal_chart: [{ label: '09:00', total: 150 }],
        range
    };
}

let dailyChart, typeChart, calChart;

function renderChart(data, range) {
    const ctx = document.getElementById('chart-bar-time');
    if (!ctx) return;

    const labels = data.map(d => d.label);
    const values = data.map(d => d.total);

    if (dailyChart) {
        dailyChart.data.labels = labels;
        dailyChart.data.datasets[0].data = values;
        dailyChart.update();
    } else {
        dailyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '運動時間 (min)',
                    data: values,
                    backgroundColor: 'rgba(255,71,87,0.6)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true }
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                }
            }
        });
    }
}

function renderTypeChart(data) {
    const ctx = document.getElementById('chart-pie-types');
    if (!ctx) return;

    const labels = data.map(d => d.type);
    const values = data.map(d => d.total);

    if (typeChart) {
        typeChart.data.labels = labels;
        typeChart.data.datasets[0].data = values;
        typeChart.update();
    } else {
        typeChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: ['#FF4757', '#5352ED', '#F79F1F', '#00D2D3', '#EE5A6F', '#2ED573']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    animateScale: true,
                    animateRotate: true,
                    duration: 1000
                }
            }
        });
    }
}

function renderCalorieChart(data, range) {
    const ctx = document.getElementById('chart-line-calories');
    if (!ctx) return;

    const labels = data.map(d => d.label);
    const values = data.map(d => d.total);

    if (calChart) {
        calChart.data.labels = labels;
        calChart.data.datasets[0].data = values;
        calChart.update();
    } else {
        calChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: '熱量消耗 (kcal)',
                    data: values,
                    borderColor: '#F79F1F',
                    backgroundColor: 'rgba(247, 159, 31, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true }
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                }
            }
        });
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setLeaderboardTransitionState(state, direction = 'forward') {
    clearTimeout(leaderboardAnimationTimer);
    const card = document.querySelector('.leaderboard-card');
    const table = document.getElementById('leaderboard-table');
    if (!card || !table) return;

    card.classList.toggle('leaderboard-is-switching', state === 'out');
    table.classList.remove(
        'leaderboard-slide-forward',
        'leaderboard-slide-back',
        'leaderboard-table-out',
        'leaderboard-table-in'
    );

    if (state === 'out') {
        table.classList.add(
            direction === 'back' ? 'leaderboard-slide-back' : 'leaderboard-slide-forward',
            'leaderboard-table-out'
        );
    } else if (state === 'in') {
        table.classList.add(
            direction === 'back' ? 'leaderboard-slide-back' : 'leaderboard-slide-forward',
            'leaderboard-table-in'
        );
        leaderboardAnimationTimer = window.setTimeout(() => table.classList.remove('leaderboard-table-in'), 600);
    }
}

async function loadLeaderboard(options = {}) {
    const tbody = document.querySelector('#leaderboard-table tbody');
    if (!tbody) return;

    const loadSeq = ++leaderboardLoadSeq;
    const shouldAnimate = options.animate === true && !prefersReducedMotion();
    const direction = options.direction || 'forward';

    if (shouldAnimate) {
        setLeaderboardTransitionState('out', direction);
        await delay(140);
        if (loadSeq !== leaderboardLoadSeq) return;
    } else {
        setLeaderboardTransitionState('idle');
    }

    try {
        const range = globalTimeRange || '1m';
        const json = isDemoMode
            ? { success: true, range, data: [{ rank: 1, display_name: 'Demo Hero', total: range === 'total' ? 1800 : 180 }] }
            : await fcGet('get_leaderboard', { range });

        if (loadSeq !== leaderboardLoadSeq) return;

        if (!json.success || !json.data || !json.data.length) {
            setLeaderboardMessage(tbody, '暫無資料');
            if (shouldAnimate) setLeaderboardTransitionState('in', direction);
            return;
        }

        const users = json.data;
        tbody.innerHTML = '';

        users.forEach((u, i) => {
            renderRow(tbody, u, i + 1);
        });

        // 檢查是否需要顯示當前使用者（只有當使用者不在前 10 名時）
        if (json.user_rank && json.user_rank.rank > 10) {
            // 分隔線
            const sep = document.createElement('tr');
            const sepCell = document.createElement('td');
            sepCell.colSpan = 3;
            sepCell.textContent = '...';
            Object.assign(sepCell.style, {
                textAlign: 'center',
                color: '#999',
                letterSpacing: '5px',
                background: 'rgba(0,0,0,0.02)'
            });
            sep.appendChild(sepCell);
            tbody.appendChild(sep);

            // 使用者行
            renderRow(tbody, json.user_rank, json.user_rank.rank, true);
        }

        if (shouldAnimate) setLeaderboardTransitionState('in', direction);

    } catch (e) {
        if (loadSeq !== leaderboardLoadSeq) return;
        console.error('Leaderboard error:', e);
        setLeaderboardMessage(tbody, '載入失敗');
        if (shouldAnimate) setLeaderboardTransitionState('in', direction);
    }
}

function setLeaderboardMessage(tbody, message) {
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
}

function renderRow(tbody, u, rankVal, isSticky = false) {
    const tr = document.createElement('tr');

    // Rank Display (1, 2, 3 uses medals, others number)
    // Note: rankVal comes from backend or index + 1
    // Ideally backend should provide rank, but for top 10 simple index works.
    // For sticky row, we MUST use the rank from object.

    let displayRank = rankVal;
    if (u.rank) displayRank = u.rank; // Use reliable backend rank if available

    let rankLabel = displayRank;
    if (displayRank === 1) rankLabel = '🥇';
    else if (displayRank === 2) rankLabel = '🥈';
    else if (displayRank === 3) rankLabel = '🥉';

    const name = u.display_name || 'User';

    const rankCell = document.createElement('td');
    const rankSpan = document.createElement('span');
    rankSpan.style.fontSize = '1.2rem';
    rankSpan.textContent = String(rankLabel);
    rankCell.appendChild(rankSpan);

    const nameCell = document.createElement('td');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = name;
    nameCell.appendChild(nameStrong);

    const totalCell = document.createElement('td');
    totalCell.textContent = String(u.total ?? 0);

    tr.appendChild(rankCell);
    tr.appendChild(nameCell);
    tr.appendChild(totalCell);

    // Highlight if current user
    if ((currentUser && name === currentUser.display_name) || isSticky) {
        tr.style.background = 'rgba(255, 71, 87, 0.15)'; // Slightly stronger highlight for sticky
        tr.style.border = '2px solid rgba(255, 71, 87, 0.3)';
    }

    tbody.appendChild(tr);
}

// === Leaderboard Polling ===
function startLeaderboardPolling() {
    stopLeaderboardPolling(); // Stop existing if any
    console.log('⏳ 啟動排行榜自動更新 (每 30 秒)...');

    // Initial load is already called in showDashboard -> setGlobalRange -> fetchStats -> loadLeaderboard ?? 
    // Wait, setGlobalRange calls loadLeaderboard. So we just set interval.

    leaderboardPollInterval = setInterval(() => {
        // Only load if dashboard is visible to save resources (simple check)
        const dashboardView = document.getElementById('dashboard-view');
        if (dashboardView && !dashboardView.classList.contains('hidden')) {
            console.log('🔄 自動更新排行榜...');
            loadLeaderboard();
        }
    }, 30000); // 30 seconds
}

function stopLeaderboardPolling() {
    if (leaderboardPollInterval) {
        clearInterval(leaderboardPollInterval);
        leaderboardPollInterval = null;
        console.log('🛑 停止排行榜自動更新');
    }
}

async function fetchPost(action, data = {}) {
    if (isDemoMode && action !== 'get_user_info') {
        return { success: true, demo: true };
    }

    console.log(`📤 API 請求: ${action}`);
    const json = await postJson(action, data);

    if (
        json &&
        json.success === false &&
        json.message === 'Invalid CSRF token' &&
        !['login', 'register'].includes(action)
    ) {
        const refreshed = await refreshCsrfToken();
        if (refreshed) {
            return postJson(action, data);
        }
    }

    return json;
}

async function postJson(action, data = {}) {
    const res = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: authJsonHeaders(),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(action === 'ai_coach' ? 45000 : 30000),
        body: JSON.stringify(data)
    });

    const text = await res.text();

    if (res.status === 401 && currentUser) {
        fcExpireSession();
        return { success: false, message: '登入已失效，請重新登入。' };
    }

    try {
        const json = JSON.parse(text);
        return json;
    } catch (e) {
        console.error('❌ API 回應不是 JSON:', text);
        throw new Error('API 回傳不是 JSON（請檢查 submit.php 是否有錯誤）');
    }
}

async function refreshCsrfToken() {
    try {
        const res = await fetch(`${API_URL}?action=get_user_info&t=${Date.now()}`, {
            credentials: 'same-origin'
        });
        const json = await res.json();
        if (json.success && json.csrf_token) {
            csrfToken = json.csrf_token;
            return true;
        }
    } catch (e) {
        console.error('❌ CSRF token 更新失敗:', e);
    }
    return false;
}

function updateProfileUI() {
    // 更新身高體重與名字顯示
    if (!currentUser) return;

    // 1. Update Name
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) {
        nameEl.textContent = currentUser.display_name;
    }

    // 2. Update Height/Weight (Raw value from DB, 1 decimal)
    const heightEl = document.getElementById('user-height');
    const weightEl = document.getElementById('user-weight');

    if (heightEl) {
        heightEl.textContent = (currentUser.height && currentUser.height > 0) ? currentUser.height + ' cm' : '未設定';
    }

    if (weightEl) {
        weightEl.textContent = (currentUser.weight && currentUser.weight > 0) ? currentUser.weight + ' kg' : '未設定';
    }
}

async function setupCoachInteraction() {
    // 確保 AI 教練視窗隱藏
    const chatWindow = document.getElementById('chat-window');
    const coachContainer = document.getElementById('ai-coach-container');

    if (chatWindow) chatWindow.style.display = 'none';
    if (coachContainer) coachContainer.classList.add('hidden');
}

function setupMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');

    if (toggle && links) {
        // Toggle Menu
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            links.classList.toggle('active');

            // Animate Hamburger (Optional: simple transform)
            const spans = toggle.querySelectorAll('span');
            if (links.classList.contains('active')) {
                spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
                spans[1].style.opacity = '0';
                spans[2].style.transform = 'rotate(-45deg) translate(7px, -6px)';
            } else {
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (links.classList.contains('active') && !links.contains(e.target) && !toggle.contains(e.target)) {
                links.classList.remove('active');
                // Reset hamburger
                const spans = toggle.querySelectorAll('span');
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });

        // Close when clicking a link
        links.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                links.classList.remove('active');
                // Reset hamburger
                const spans = toggle.querySelectorAll('span');
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            });
        });
    }
}


// 卡路里計算
window.calculateCalories = function () {
    const typeSelect = document.getElementById('input-sport');
    const minutesInput = document.getElementById('input-minutes');
    const caloriesInput = document.getElementById('input-calories');
    const calcValDisplay = document.getElementById('calc-val');
    const displayArea = document.getElementById('calorie-display-area');

    if (!typeSelect || !minutesInput || !caloriesInput) return;

    const type = typeSelect.value;
    const minutes = parseInt(minutesInput.value) || 0;

    // MET values
    const MET_VALUES = {
        '跑步': 10,
        '重訓': 4,
        '腳踏車': 8,
        '游泳': 6,
        '瑜珈': 3,
        '其他': 2
    };

    if (!currentUser || !currentUser.weight) {
        // 如果沒有體重，隱藏顯示區並不計算
        displayArea.classList.add('hidden');
        caloriesInput.value = 0;
        return;
    }

    if (!type || minutes <= 0) {
        displayArea.classList.add('hidden');
        caloriesInput.value = 0;
        return;
    }

    const met = MET_VALUES[type] || 2;
    const weight = parseFloat(currentUser.weight);
    const kcal = Math.round(((met * 3.5 * weight) / 200) * minutes);

    calcValDisplay.textContent = kcal;
    caloriesInput.value = kcal;
    displayArea.classList.remove('hidden');
};

// 顯示編輯個人資料彈窗 (名字、身高、體重)
function showEditProfileModal() {
    console.log('📝 開啟編輯個人資料彈窗');

    const modal = document.createElement('div');
    modal.id = 'edit-profile-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5); display: flex;
        justify-content: center; align-items: center; z-index: 9999;
        animation: fadeIn 0.3s ease;
    `;

    const currentName = currentUser.display_name || '';
    const currentHeight = currentUser.height || '';
    const currentWeight = currentUser.weight || '';

    modal.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-width: 400px; width: 90%; animation: slideUp 0.3s ease;">
            <h2 style="margin: 0 0 1.5rem 0; color: #333; font-size: 1.5rem;">✏️ 編輯個人資料</h2>
            
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; color: #666; font-weight: 600;">暱稱</label>
                <input type="text" id="modal-name" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>

            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; color: #666; font-weight: 600;">身高 (cm)</label>
                <input type="number" id="modal-height" placeholder="例如：170" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; color: #666; font-weight: 600;">體重 (kg)</label>
                <input type="number" id="modal-weight" placeholder="例如：65" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <button onclick="closeEditProfileModal()" style="flex: 1; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; background: white; color: #666; font-weight: 600; cursor: pointer;">取消</button>
                <button onclick="saveProfile()" style="flex: 1; padding: 0.75rem; border: none; border-radius: 8px; background: #FF6B35; color: white; font-weight: 600; cursor: pointer;">儲存</button>
            </div>
        </div>
    `;

    // 加入 CSS 動畫
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(modal);
    document.getElementById('modal-name').value = currentName;
    document.getElementById('modal-height').value = currentHeight;
    document.getElementById('modal-weight').value = currentWeight;

    // 點擊背景關閉
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            closeEditProfileModal();
        }
    });
}

// 關閉彈窗
function closeEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => modal.remove(), 300);
    }
}

// 儲存個人資料
async function saveProfile() {
    const nameInput = document.getElementById('modal-name');
    const heightInput = document.getElementById('modal-height');
    const weightInput = document.getElementById('modal-weight');

    const display_name = nameInput.value.trim();
    const height = parseFloat(heightInput.value);
    const weight = parseFloat(weightInput.value);

    if (!display_name) {
        alert('請輸入暱稱');
        return;
    }

    // 驗證
    if (!height || height <= 0 || height > 300) {
        alert('請輸入有效的身高');
        return;
    }

    if (!weight || weight <= 0 || weight > 500) {
        alert('請輸入有效的體重');
        return;
    }

    console.log('💾 儲存資料:', display_name, height, weight);

    try {
        const res = await fetch(`${API_URL}?action=update_profile`, {
            method: 'POST',
            headers: authJsonHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({ display_name, height, weight })
        });

        const json = await res.json();

        if (json.success) {
            currentUser.display_name = display_name;
            currentUser.height = height;
            currentUser.weight = weight;

            // 更新 UI
            const nameEl = document.getElementById('user-display-name');
            if (nameEl) nameEl.textContent = display_name;
            updateProfileUI();

            closeEditProfileModal();

            // Reset Workout Inputs
            const inputSport = document.getElementById('input-sport');
            const inputMin = document.getElementById('input-minutes');
            const inputCal = document.getElementById('input-calories');
            const displayArea = document.getElementById('calorie-display-area');

            if (inputSport) inputSport.value = '';
            if (inputMin) inputMin.value = '';
            if (inputCal) inputCal.value = '';
            if (displayArea) displayArea.classList.add('hidden');
            setupDateTimeDefaults(); // Reset date/time if needed

            alert('✅ 個人資料已更新！');
        } else {
            alert('儲存失敗: ' + (json.message || '未知錯誤'));
        }
    } catch (err) {
        console.error('❌ 儲存錯誤:', err);
    }
}


function generateAvatarGrid() {
    // 頭像選擇
}

// ========== 頭像功能 ==========

// 全域變數
let currentAvatarIndex = 1;  // 預設頭像編號
const TOTAL_AVATARS = 11;    // 總共有 11 個頭像

window.changeAvatar = function (direction) {
    console.log('切換頭像:', direction);

    const avatarImg = document.getElementById('current-avatar');
    if (!avatarImg) {
        console.error('找不到頭像元素');
        return;
    }

    // 添加淡出動畫
    avatarImg.style.opacity = '0';
    avatarImg.style.transform = 'scale(0.8)';

    setTimeout(() => {
        // 更新頭像索引
        currentAvatarIndex += direction;

        // 循環處理
        if (currentAvatarIndex > TOTAL_AVATARS) {
            currentAvatarIndex = 1;
        } else if (currentAvatarIndex < 1) {
            currentAvatarIndex = TOTAL_AVATARS;
        }

        // 更新圖片
        avatarImg.src = `public/image/${currentAvatarIndex}.png`;

        // 添加淡入動畫
        setTimeout(() => {
            avatarImg.style.opacity = '1';
            avatarImg.style.transform = 'scale(1)';
        }, 50);

        // 如果已登入，更新到伺服器
        if (currentUser && !isDemoMode) {
            updateAvatarOnServer(currentAvatarIndex);
        }
    }, 200);
};

async function updateAvatarOnServer(avatarId) {
    try {
        const res = await fetch(`${API_URL}?action=update_avatar`, {
            method: 'POST',
            headers: authJsonHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({ avatar_id: avatarId })
        });

        const json = await res.json();

        if (json.success) {
            console.log('✅ 頭像已更新');
            if (currentUser) {
                currentUser.avatar_id = avatarId;
            }
        } else {
            console.error('❌ 頭像更新失敗:', json.message);
        }
    } catch (err) {
        console.error('❌ 頭像更新錯誤:', err);
    }
}


// === LINE Binding Functions ===
window.generateBindCode = async function () {
    console.log('📱 產生 LINE 綁定碼...');
    try {
        const res = await fetch(`${API_URL}?action=generate_bind_code`, {
            method: 'POST',
            headers: authJsonHeaders(),
            credentials: 'same-origin'
        });
        const json = await res.json();

        if (json.success) {
            // 顯示綁定碼區域
            document.getElementById('bind-code-display').style.display = 'block';
            document.getElementById('bind-code-text').textContent = json.code;

            // 清除舊的 QR Code
            const qrContainer = document.getElementById('qrcode');
            qrContainer.innerHTML = '';

            // 產生新的 QR Code (指向加好友連結)
            const lineBotUrl = 'https://line.me/R/ti/p/@836bkjte';//line id
            new QRCode(qrContainer, {
                text: lineBotUrl,
                width: 128,
                height: 128
            });

            alert('綁定碼已產生！請掃描 QR Code 加好友並輸入綁定碼。');

            // === 啟動輪詢檢查綁定狀態 ===
            if (bindPollInterval) clearInterval(bindPollInterval);
            console.log('⏳ 開始輪詢綁定狀態...');
            bindPollInterval = setInterval(checkBindStatus, 3000); // 每 3 秒檢查一次

            // 10分鐘後停止輪詢 (配合後端過期時間)
            setTimeout(() => {
                if (bindPollInterval) {
                    clearInterval(bindPollInterval);
                    bindPollInterval = null;
                    console.log('⌛ 輪詢超時，停止檢查');
                }
            }, 600000);

        } else {
            alert('產生失敗: ' + (json.message || '未知錯誤'));
        }
    } catch (err) {
        console.error('❌ 產生綁定碼錯誤:', err);
        alert('連線錯誤');
    }
};

async function checkBindStatus() {
    try {
        const res = await fetch(`${API_URL}?action=get_user_info`, { credentials: 'same-origin' });
        const json = await res.json();

        if (json.success && json.data && json.data.line_user_id) {
            console.log('✅ 偵測到 LINE 綁定成功！');

            // 停止輪詢
            clearInterval(bindPollInterval);
            bindPollInterval = null;

            // 更新使用者資訊
            currentUser = json.data;

            // 更新 UI (隱藏綁定碼，顯示已綁定)
            showDashboard();

            // 顯示成功訊息
            alert('🎉 LINE 綁定成功！');
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

window.unbindLine = async function () {
    if (!confirm('確定要解除 LINE 綁定嗎？')) return;

    // 清除任何正在進行的輪詢
    if (bindPollInterval) {
        clearInterval(bindPollInterval);
        bindPollInterval = null;
    }

    console.log('🔗 解除 LINE 綁定...');
    try {
        const res = await fetch(`${API_URL}?action=line_unbind`, {
            method: 'POST',
            headers: authJsonHeaders(),
            credentials: 'same-origin'
        });
        const json = await res.json();

        if (json.success) {
            alert('✅ 已解除綁定');
            // 更新 UI (隱藏已綁定區塊，顯示未綁定區塊)
            const notBoundDiv = document.getElementById('not-bound');
            const boundDiv = document.getElementById('already-bound');
            const bindCodeDisplay = document.getElementById('bind-code-display');

            if (notBoundDiv) notBoundDiv.style.display = 'block';
            if (boundDiv) boundDiv.style.display = 'none';
            if (bindCodeDisplay) bindCodeDisplay.style.display = 'none';

            // 同步更新 currentUser 狀態 (如果需要)
            if (currentUser) currentUser.line_user_id = null;
        } else {
            alert('解除失敗: ' + (json.message || '未知錯誤'));
        }
    } catch (err) {
        console.error('❌ 解除綁定錯誤:', err);
        alert('連線錯誤');
    }
};

console.log('✅ main.js 載入完成');
// --- AI Coach Toggle Logic ---
function toggleAICoach(e) {
    if (e) e.preventDefault();

    coachEnabled = !coachEnabled;
    fcUpdateCoachVisibility();

    // Auto-close menu on mobile (matches other links)
    const navLinks = document.querySelector('.nav-links');
    const navToggle = document.querySelector('.nav-toggle');
    if (navLinks && navLinks.classList.contains('active')) {
        navLinks.classList.remove('active');
        navToggle.classList.remove('active');
    }
}
// --- Auto Refresh Logic ---
let autoRefreshInterval = null;

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    console.log('🔄 啟動自動更新 (每 30 秒)...');

    autoRefreshInterval = setInterval(async () => {
        // Only refresh if user is logged in (currentUser exists)
        if (!currentUser) return;

        // 1. Refresh User Info (Profile weights/height changes)
        // We use a separate silent fetch to avoid alerts
        try {
            const res = await fetch(`${API_URL}?action=get_user_info&t=${Date.now()}`, { credentials: 'same-origin' });
            const json = await res.json();
            if (json.success && json.data) {
                // Always update currentUser and UI to ensure sync
                currentUser = json.data;
                console.log('🔄 同步個人資料', currentUser);
                updateProfileUI();
            } else if (res.status === 401) {
                fcExpireSession();
                return;
            }
        } catch (e) { console.error('Auto-refresh User Error', e); }

        if (fcHistoryVisible()) return;

        // 2. Refresh Stats (Charts)
        // Use globalTimeRange
        try {
            fetchStats(statsTimeRange);
        } catch (e) { console.error('Auto-refresh Stats Error', e); }

        // 3. Refresh Leaderboard
        try {
            loadLeaderboard();
        } catch (e) { console.error('Auto-refresh Leaderboard Error', e); }

    }, 30000); // 30 seconds
}


let accountLinkToken = '';
let workoutPage = 1;
let workoutPages = 1;
let workoutRows = [];
let historyRequest = 0;
let editingWorkout = null;
let workoutSaving = false;
let activeDashboardPage = 'home';
let coachEnabled = true;
const workoutMobile = matchMedia('(max-width: 768px)');
let workoutPageSize = workoutMobile.matches ? 10 : 20;

function fcHistoryVisible() {
    return !!currentUser && activeDashboardPage === 'history';
}

function fcUpdateCoachVisibility() {
    const visible = !!currentUser && activeDashboardPage === 'home' && coachEnabled;
    document.getElementById('ai-coach-container').classList.toggle('hidden', !visible);
    document.getElementById('nav-coach-toggle').textContent = `AI教練: ${coachEnabled ? 'ON' : 'OFF'}`;
    document.getElementById('nav-coach-toggle').classList.toggle('hidden', activeDashboardPage !== 'home');
    if (!visible) document.getElementById('chat-window').style.display = 'none';
    if (window.fcChatViewport) fcChatViewport();
}

function fcShowDashboardPage(scroll = true) {
    if (!currentUser) return;
    const hash = location.hash;
    const previousPage = activeDashboardPage;
    activeDashboardPage = ['#workouts', '#section-history'].includes(hash) ? 'history' : 'home';
    const historyVisible = activeDashboardPage === 'history';
    document.getElementById('home-view').classList.toggle('hidden', historyVisible);
    document.getElementById('history-view').classList.toggle('hidden', !historyVisible);
    document.title = historyVisible ? '運動紀錄 | FitConnect' : 'FitConnect 運動平台';
    document.querySelectorAll('.nav-links [data-dashboard-link]').forEach(link => {
        const selected = historyVisible ? link.hash === '#workouts' : link.hash === (hash || '#section-hero');
        link.classList.toggle('active', selected);
        if (selected) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    fcUpdateCoachVisibility();
    if (historyVisible) {
        fcLoadWorkouts(workoutPage);
    } else if (previousPage !== activeDashboardPage) {
        historyRequest++;
        setGlobalRange(globalTimeRange);
        if (globalTimeRange === 'total') fetchStats(statsTimeRange);
    }
    if (scroll) requestAnimationFrame(() => {
        if (historyVisible) window.scrollTo({ top: 0, behavior: 'instant' });
        else {
            const section = document.getElementById(hash.slice(1));
            const target = section && document.getElementById('home-view').contains(section) ? section : document.getElementById('section-hero');
            target.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
        window.dispatchEvent(new Event('resize'));
    });
}

function fcWorkoutsChanged() {
    workoutPage = 1;
    if (fcHistoryVisible()) fcLoadWorkouts(1);
}

function fcIcons(root = document) {
    if (window.lucide) window.lucide.createIcons({ root });
}

function fcAuthMessage(message, success = false) {
    const el = document.getElementById('auth-msg');
    el.textContent = message;
    el.classList.toggle('is-success', success);
}

function fcAccountView(view, email = '') {
    ['login', 'register', 'forgot', 'resend', 'verify', 'reset'].forEach(name => {
        document.getElementById(`${name}-form`).classList.toggle('hidden', name !== view);
    });
    document.querySelector('.tab-buttons').classList.toggle('hidden', !['login', 'register'].includes(view));
    ['login', 'register'].forEach(name => {
        const button = document.getElementById(`tab-${name}`);
        button.classList.toggle('active', name === view);
        button.style.backgroundColor = name === view ? '#FF6B35' : 'transparent';
        button.style.color = name === view ? 'white' : '#666';
    });
    if (email && ['forgot', 'resend'].includes(view)) document.getElementById(`${view}-email`).value = email;
    fcAuthMessage('');
}

function fcReadAccountLink() {
    const link = new URLSearchParams(location.hash.slice(1));
    const view = link.get('auth');
    if (!['verify', 'reset'].includes(view)) return false;
    const token = link.get('token') || '';
    if (currentUser) fcExpireSession();
    else showLogin();
    accountLinkToken = token;
    history.replaceState(null, '', location.pathname + location.search);
    fcAccountView(view);
    if (!/^[a-f0-9]{64}$/.test(token)) fcAuthMessage('連結不完整，請重新申請。');
    return true;
}

function fcSetupFeatures() {
    fcIcons();
    const coach = document.querySelector('.coach-img-wrapper');
    coach.tabIndex = 0;
    coach.setAttribute('role', 'button');
    coach.setAttribute('aria-label', '開啟AI教練聊天室');
    coach.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleChat();
        }
    });
    document.getElementById('open-forgot').addEventListener('click', () => fcAccountView('forgot', document.getElementById('login-email').value));
    document.getElementById('open-resend').addEventListener('click', () => fcAccountView('resend', document.getElementById('login-email').value));
    document.querySelectorAll('.account-back').forEach(button => button.addEventListener('click', () => {
        accountLinkToken = '';
        fcAccountView('login');
    }));
    ['forgot', 'resend', 'verify', 'reset'].forEach(view => {
        document.getElementById(`${view}-form`).addEventListener('submit', async event => {
            event.preventDefault();
            const button = event.currentTarget.querySelector('[type="submit"]');
            if (button.disabled) return;
            const actions = { forgot: 'forgot_password', resend: 'resend_verification', verify: 'verify_email', reset: 'reset_password' };
            const data = {};
            if (['forgot', 'resend'].includes(view)) data.email = document.getElementById(`${view}-email`).value.trim();
            else data.token = accountLinkToken;
            if (view === 'reset') {
                data.password = document.getElementById('reset-password').value;
                if (data.password !== document.getElementById('reset-confirm').value) {
                    fcAuthMessage('兩次輸入的密碼不一致。');
                    return;
                }
            }
            button.disabled = true;
            try {
                const json = await fetchPost(actions[view], data);
                if (json.success && ['verify', 'reset'].includes(view)) {
                    accountLinkToken = '';
                    event.target.reset();
                    fcAccountView('login');
                }
                fcAuthMessage(json.message || '請稍後再試。', !!json.success);
            } catch (error) {
                fcAuthMessage(error.message);
            } finally {
                button.disabled = false;
            }
        });
    });
    fcReadAccountLink();
    document.getElementById('history-prev').addEventListener('click', () => fcLoadWorkouts(workoutPage - 1));
    document.getElementById('history-next').addEventListener('click', () => fcLoadWorkouts(workoutPage + 1));
    document.getElementById('history-refresh').addEventListener('click', () => fcLoadWorkouts(workoutPage));
    window.addEventListener('hashchange', () => {
        if (!fcReadAccountLink()) fcShowDashboardPage();
    });
    document.querySelectorAll('[data-dashboard-link]').forEach(link => link.addEventListener('click', () => {
        if (location.hash === link.hash) fcShowDashboardPage();
    }));
    workoutMobile.addEventListener('change', () => {
        const firstRecord = (workoutPage - 1) * workoutPageSize;
        workoutPageSize = workoutMobile.matches ? 10 : 20;
        workoutPage = Math.floor(firstRecord / workoutPageSize) + 1;
        if (fcHistoryVisible()) fcLoadWorkouts(workoutPage);
    });
    document.getElementById('edit-close').addEventListener('click', () => {
        if (!workoutSaving) document.getElementById('workout-dialog').close();
    });
    document.getElementById('workout-dialog').addEventListener('cancel', event => {
        if (workoutSaving) event.preventDefault();
    });
    document.getElementById('edit-workout-form').addEventListener('submit', fcSaveWorkout);
}

async function fcGet(action, params = {}) {
    const query = new URLSearchParams({ action, ...params });
    const response = await fetch(`${API_URL}?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000)
    });
    const json = await response.json();
    if (response.status === 401 && currentUser) fcExpireSession();
    if (!json.success) throw new Error(json.message || '暫時無法取得資料。');
    return json;
}

async function fcLoadWorkouts(page = 1) {
    if (!fcHistoryVisible()) return;
    const request = ++historyRequest;
    const owner = currentUser?.id;
    const status = document.getElementById('history-status');
    const body = document.getElementById('workout-history-body');
    const empty = document.getElementById('history-empty');
    const table = document.querySelector('.history-table-wrap');
    const prev = document.getElementById('history-prev');
    const next = document.getElementById('history-next');
    if (!owner || isDemoMode) {
        body.replaceChildren();
        status.textContent = '目前沒有可顯示的運動紀錄。';
        empty.classList.remove('hidden');
        table.classList.add('hidden');
        prev.disabled = next.disabled = true;
        return;
    }
    status.textContent = '正在載入紀錄…';
    empty.classList.add('hidden');
    prev.disabled = next.disabled = true;
    document.getElementById('history-refresh').disabled = true;
    table.setAttribute('aria-busy', 'true');
    try {
        const json = await fcGet('list_workouts', { page: Math.max(1, page), per_page: workoutPageSize });
        if (request !== historyRequest || owner !== currentUser?.id) return;
        workoutPage = json.page;
        workoutPages = json.pages;
        workoutRows = json.data;
        table.classList.toggle('hidden', !json.total);
        empty.classList.toggle('hidden', !!json.total);
        body.replaceChildren();
        for (const row of workoutRows) {
            const tr = document.createElement('tr');
            const values = [row.date.slice(0, 16), row.type, `${row.minutes} 分鐘`, `${row.calories} kcal`];
            values.forEach((value, index) => {
                const td = document.createElement('td');
                td.textContent = value;
                td.dataset.label = ['日期與時間', '運動', '分鐘', '估計熱量'][index];
                tr.appendChild(td);
            });
            const actions = document.createElement('td');
            actions.className = 'history-row-actions';
            for (const [icon, label, handler] of [
                ['pencil', '修改紀錄', () => fcEditWorkout(row)],
                ['trash-2', '刪除紀錄', button => fcDeleteWorkout(row, button)]
            ]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'icon-button';
                button.title = label;
                button.setAttribute('aria-label', `${label}：${row.date} ${row.type}`);
                const symbol = document.createElement('i');
                symbol.dataset.lucide = icon;
                button.appendChild(symbol);
                button.addEventListener('click', () => handler(button));
                actions.appendChild(button);
            }
            tr.appendChild(actions);
            body.appendChild(tr);
        }
        fcIcons();
        status.textContent = json.total ? `共 ${json.total} 筆紀錄` : '共 0 筆紀錄';
        document.getElementById('history-page').textContent = `${workoutPage} / ${workoutPages}`;
        document.getElementById('history-prev').disabled = workoutPage <= 1;
        document.getElementById('history-next').disabled = workoutPage >= workoutPages;
    } catch (error) {
        if (request === historyRequest && owner === currentUser?.id) status.textContent = `載入失敗：${error.message}`;
    } finally {
        if (request === historyRequest && owner === currentUser?.id) {
            table.setAttribute('aria-busy', 'false');
            document.getElementById('history-refresh').disabled = false;
            prev.disabled = workoutPage <= 1;
            next.disabled = workoutPage >= workoutPages;
        }
    }
}

function fcResetFeatures() {
    historyRequest++;
    workoutRows = [];
    workoutPage = workoutPages = 1;
    activeDashboardPage = 'home';
    coachEnabled = true;
    if (['#workouts', '#section-history'].includes(location.hash)) history.replaceState(null, '', '#section-hero');
    document.title = 'FitConnect 運動平台';
    document.getElementById('workout-history-body').replaceChildren();
    document.getElementById('workout-dialog').close();
    document.getElementById('coach-privacy-dialog').close();
    if (window.fcResetChat) window.fcResetChat();
}

function fcExpireSession() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    currentUser = null;
    csrfToken = '';
    fcResetFeatures();
    document.getElementById('chat-window').style.display = 'none';
    showLogin();
    fcAccountView('login');
    fcAuthMessage('登入已失效，請重新登入。');
}

function fcEditWorkout(row) {
    editingWorkout = row;
    document.getElementById('edit-date').value = row.date.slice(0, 10);
    document.getElementById('edit-time').value = row.date.slice(11, 19);
    document.getElementById('edit-type').value = row.type;
    document.getElementById('edit-minutes').value = row.minutes;
    document.getElementById('edit-error').textContent = '';
    document.getElementById('edit-weight-note').textContent = row.weight_kg
        ? `變更運動或分鐘數時，熱量依紀錄時體重 ${row.weight_kg} kg 重算。`
        : '此為舊紀錄；變更運動或分鐘數時，熱量依目前體重重算。';
    document.getElementById('workout-dialog').showModal();
}

async function fcAfterWorkoutChange(achievements = []) {
    achievements.forEach(achievement => showAchievementNotification(achievement.title, achievement.img));
    if (fcHistoryVisible()) await fcLoadWorkouts(workoutPage);
    else {
        setGlobalRange(globalTimeRange);
        if (globalTimeRange === 'total') fetchStats(statsTimeRange);
    }
    if (window.fcInvalidateReport) window.fcInvalidateReport();
}

async function fcSaveWorkout(event) {
    event.preventDefault();
    if (workoutSaving || !editingWorkout) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    const owner = currentUser?.id;
    const row = editingWorkout;
    const time = document.getElementById('edit-time').value;
    workoutSaving = true;
    button.disabled = true;
    try {
        const json = await fetchPost('update_workout', {
            id: row.id, revision: row.revision,
            date: `${document.getElementById('edit-date').value} ${time.length === 5 ? time + ':00' : time}`,
            type: document.getElementById('edit-type').value,
            minutes: Number(document.getElementById('edit-minutes').value)
        });
        if (owner !== currentUser?.id) return;
        if (!json.success) throw new Error(json.message);
        document.getElementById('workout-dialog').close();
        await fcAfterWorkoutChange(json.achievements);
    } catch (error) {
        if (owner === currentUser?.id) document.getElementById('edit-error').textContent = error.message;
    } finally {
        workoutSaving = false;
        button.disabled = false;
    }
}

async function fcDeleteWorkout(row, button) {
    if (button.disabled || !confirm(`刪除 ${row.date.slice(0, 16)} 的${row.type} ${row.minutes} 分鐘？統計、排行榜與成就資格將重新計算。`)) return;
    const owner = currentUser?.id;
    button.disabled = true;
    try {
        const json = await fetchPost('delete_workout', { id: row.id, revision: row.revision });
        if (owner !== currentUser?.id) return;
        if (!json.success) throw new Error(json.message);
        await fcAfterWorkoutChange(json.achievements);
    } catch (error) {
        if (owner === currentUser?.id) document.getElementById('history-status').textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

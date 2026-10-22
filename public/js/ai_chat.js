let coachBusy = false;
let coachRequest = 0;
let coachPeriod = 'week';

function fcChatBusy(busy) {
    coachBusy = busy;
    document.querySelectorAll('#chat-send, #chat-clear, .chat-shortcuts button, .report-interpret').forEach(button => button.disabled = busy);
    document.getElementById('chat-messages').setAttribute('aria-busy', String(busy));
}

function appendMsg(text, type, id = null) {
    const container = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.className = `chat-msg ${type}`;
    bubble.textContent = text;
    if (id) bubble.id = id;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

function fcAppendReport(report, interpretation = true) {
    const bubble = appendMsg(report.text, 'ai report-facts');
    bubble.dataset.period = report.period;
    if (interpretation) {
        const note = document.createElement('p');
        note.className = 'report-sharing-note';
        note.textContent = 'AI 解讀會將報告摘要與最近對話傳送至 Google。';
        const button = document.createElement('button');
        button.className = 'report-interpret';
        button.type = 'button';
        button.textContent = '請 AI 解讀';
        button.addEventListener('click', () => sendChatMessage('請解讀這份最新報告，提供安全且具體的運動建議。', report.period));
        bubble.append(note, button);
    }
    return bubble;
}

async function fcShowReport(period) {
    if (coachBusy) return;
    const owner = currentUser?.id;
    const request = ++coachRequest;
    coachPeriod = period;
    appendMsg(period === 'week' ? '個人週報' : '當日運動分析', 'user');
    const loader = appendMsg('正在讀取運動紀錄…', 'ai');
    fcChatBusy(true);
    try {
        if (isDemoMode) throw new Error('請登入正式帳號，以查看真實運動紀錄。');
        const json = await fcGet('get_report', { period });
        if (request === coachRequest && owner === currentUser?.id) fcAppendReport(json.report);
    } catch (error) {
        if (request === coachRequest && owner === currentUser?.id) appendMsg(error.message, 'ai');
    } finally {
        loader.remove();
        if (request === coachRequest) fcChatBusy(false);
    }
}

async function sendChatMessage(quickMessage = '', period = coachPeriod) {
    if (coachBusy) return;
    const input = document.getElementById('chat-input');
    const message = (typeof quickMessage === 'string' && quickMessage ? quickMessage : input.value).trim();
    if (!message) return;
    if (message === '個人週報' || message === '當日運動分析') {
        input.value = '';
        return fcShowReport(message === '個人週報' ? 'week' : 'day');
    }
    if ([...message].length > 1200) return;
    const owner = currentUser?.id;
    const request = ++coachRequest;
    appendMsg(message, 'user');
    input.value = '';
    const loader = appendMsg('正在查看紀錄並思考…', 'ai');
    fcChatBusy(true);
    try {
        if (isDemoMode) throw new Error('請登入正式帳號，以取得根據紀錄的建議。');
        const json = await fetchPost('ai_coach', { message, period });
        if (request !== coachRequest || owner !== currentUser?.id) return;
        if (!json.success) throw new Error(json.message || 'AI 暫時無法回應。');
        fcAppendReport(json.report, false);
        appendMsg('AI 建議（僅供參考）\n' + json.response, 'ai');
    } catch (error) {
        if (request === coachRequest && owner === currentUser?.id) appendMsg(error.message, 'ai');
    } finally {
        loader.remove();
        if (request === coachRequest) fcChatBusy(false);
    }
}

function fcResetChat() {
    coachRequest++;
    coachPeriod = 'week';
    document.getElementById('chat-messages').replaceChildren();
    document.getElementById('chat-input').value = '';
    appendMsg('嗨！可以先查看個人週報或當日運動分析。AI 建議僅供參考；提問會將運動摘要與最近對話傳送至 Google。', 'ai');
    fcChatBusy(false);
}

function fcInvalidateReport() {
    document.querySelectorAll('.report-interpret').forEach(button => {
        button.textContent = '依最新紀錄解讀';
    });
}

window.toggleChat = function () {
    const chat = document.getElementById('chat-window');
    const visible = getComputedStyle(chat).display !== 'none';
    chat.style.display = visible ? 'none' : 'flex';
    if (!visible) {
        chat.style.animation = 'fadeInUp 0.25s ease';
        if (innerWidth > 768) document.getElementById('chat-input').focus({ preventScroll: true });
    }
};

document.getElementById('chat-close').addEventListener('click', () => document.getElementById('chat-window').style.display = 'none');
document.getElementById('chat-clear').addEventListener('click', async () => {
    if (coachBusy) return;
    fcChatBusy(true);
    try {
        const json = await fetchPost('clear_coach_history');
        if (!json.success) throw new Error(json.message);
        fcResetChat();
    } catch (error) {
        appendMsg(error.message, 'ai');
    } finally {
        fcChatBusy(false);
    }
});
document.querySelectorAll('.chat-shortcuts button').forEach(button => button.addEventListener('click', () => fcShowReport(button.dataset.report)));
document.getElementById('chat-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        sendChatMessage();
    }
});

function fcChatViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    document.documentElement.style.setProperty('--chat-viewport-height', `${viewport.height}px`);
    document.documentElement.style.setProperty('--chat-keyboard-offset', `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`);
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fcChatViewport);
    window.visualViewport.addEventListener('scroll', fcChatViewport);
    fcChatViewport();
}

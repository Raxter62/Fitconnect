let coachBusy = false;
let coachRequest = 0;
let coachPeriod = 'week';
const coachUnavailable = '這個問題我沒辦法回答喔';
const coachGreeting = '嗨，我是你的AI教練！今天想聊聊運動，還是看看最近的紀錄？';

function fcChatBusy(busy) {
    coachBusy = busy;
    document.querySelectorAll('#chat-send, #chat-clear, .chat-shortcuts button, .report-interpret').forEach(button => button.disabled = busy);
    document.getElementById('chat-messages').setAttribute('aria-busy', String(busy));
}

function appendMsg(text, type, id = null) {
    const container = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.className = `chat-msg ${type}`;
    if (type.split(' ').includes('ai')) bubble.dataset.speaker = 'AI教練';
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
        const button = document.createElement('button');
        button.className = 'report-interpret';
        button.type = 'button';
        button.textContent = '請AI教練解讀';
        button.addEventListener('click', () => sendChatMessage('請解讀這份最新報告，提供安全且具體的運動建議。', report.period));
        bubble.appendChild(button);
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
        if (request === coachRequest && owner === currentUser?.id) appendMsg(coachUnavailable, 'ai');
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
    const loader = appendMsg('讓我想想…', 'ai');
    fcChatBusy(true);
    try {
        if (isDemoMode) throw new Error('請登入正式帳號，以取得根據紀錄的建議。');
        const json = await fetchPost('ai_coach', { message, period });
        if (request !== coachRequest || owner !== currentUser?.id) return;
        if (!json.success || typeof json.response !== 'string' || !json.response.trim()) throw new Error(coachUnavailable);
        appendMsg(json.response, 'ai');
    } catch (error) {
        if (request === coachRequest && owner === currentUser?.id) appendMsg(coachUnavailable, 'ai');
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
    appendMsg(coachGreeting, 'ai');
    fcChatBusy(false);
}

function fcInvalidateReport() {
    document.querySelectorAll('.report-interpret').forEach(button => {
        button.textContent = '依最新紀錄解讀';
    });
}

window.toggleChat = function () {
    if (!currentUser || activeDashboardPage !== 'home' || !coachEnabled) return;
    const chat = document.getElementById('chat-window');
    const visible = getComputedStyle(chat).display !== 'none';
    chat.style.display = visible ? 'none' : 'flex';
    fcChatViewport();
    if (!visible) {
        chat.style.animation = 'fadeInUp 0.25s ease';
        if (innerWidth > 768) document.getElementById('chat-input').focus({ preventScroll: true });
    }
};

document.getElementById('chat-close').addEventListener('click', () => {
    document.getElementById('chat-window').style.display = 'none';
    document.body.classList.remove('coach-chat-compact');
});
document.getElementById('chat-privacy').addEventListener('click', () => document.getElementById('coach-privacy-dialog').showModal());
document.getElementById('coach-privacy-close').addEventListener('click', () => document.getElementById('coach-privacy-dialog').close());
document.getElementById('chat-clear').addEventListener('click', async () => {
    if (coachBusy) return;
    fcChatBusy(true);
    try {
        const json = await fetchPost('clear_coach_history');
        if (!json.success) throw new Error(json.message);
        fcResetChat();
    } catch (error) {
        if (currentUser) appendMsg(coachUnavailable, 'ai');
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
    const top = viewport?.offsetTop || 0;
    const viewportHeight = viewport?.height || innerHeight;
    const bottom = Math.min(innerHeight, top + viewportHeight);
    const coach = document.getElementById('ai-coach-container').getBoundingClientRect();
    const gap = 12;
    const keyboard = innerHeight - bottom > 120;
    let lowerEdge = Math.min(coach.height ? coach.top : bottom, bottom) - gap;
    let right = innerWidth <= 768 ? 12 : 20;
    let compact = false;
    // Short landscape windows can place the conversation beside the full portrait.
    if (keyboard) lowerEdge = bottom - gap;
    else if (lowerEdge - top - gap < 260) {
        if (coach.left - gap * 2 >= 320) {
            right = innerWidth - coach.left + gap;
            lowerEdge = bottom - gap;
        } else {
            compact = getComputedStyle(document.getElementById('chat-window')).display !== 'none';
            lowerEdge = bottom - gap;
        }
    }
    document.body.classList.toggle('coach-chat-compact', compact);
    document.documentElement.style.setProperty('--chat-bottom', `${Math.max(gap, innerHeight - lowerEdge)}px`);
    document.documentElement.style.setProperty('--chat-right', `${right}px`);
    document.documentElement.style.setProperty('--chat-max-height', `${Math.max(120, lowerEdge - top - gap)}px`);
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fcChatViewport);
    window.visualViewport.addEventListener('scroll', fcChatViewport);
}
window.addEventListener('resize', fcChatViewport);
document.querySelector('.coach-full-img').addEventListener('load', fcChatViewport);
fcChatViewport();

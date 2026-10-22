const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomBytes, createHash } = require('node:crypto');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, '.test-runtime/package.json'));
const { PGlite } = localRequire('@electric-sql/pglite');
const { PGLiteSocketServer } = localRequire('@electric-sql/pglite-socket');
const php = process.env.PHP_BIN || 'C:/Users/User/.codex/visualizations/2026/08/09/019fe683-12e6-72f2-97b1-8800f404dc56/php-cli/php/php.exe';
const phpArgs = process.env.PHP_BIN ? [] : ['-d', `extension_dir=${path.join(path.dirname(php), 'ext')}`, '-d', 'extension=php_mbstring.dll', '-d', 'extension=php_curl.dll', '-d', 'extension=php_pdo_pgsql.dll'];
let web, server, db, browser;
let nativeDir;
let serverLog = '';
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const sha = value => createHash('sha256').update(value).digest('hex');
const base = 'http://127.0.0.1:8094';
const env = { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55439/postgres?sslmode=disable', APP_BASE_URL: base, APP_ENV: 'local', GEMINI_API_KEY: '', RESEND_API_KEY: '' };

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request(url, { ...options, agent: false, headers: { ...options.headers, Connection: 'close' } }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', data => body += data);
            response.on('end', () => resolve({
                status: response.statusCode, ok: response.statusCode < 400,
                text: async () => body,
                headers: { get: name => response.headers[name.toLowerCase()], getSetCookie: () => response.headers['set-cookie'] || [] }
            }));
        });
        request.on('error', reject);
        request.setTimeout(30000, () => request.destroy(new Error('HTTP test timeout')));
        request.end(options.body);
    });
}

function phpRun(args, overrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(php, [...phpArgs, ...args], { cwd: root, env: { ...env, ...overrides }, windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', data => out += data);
        child.stderr.on('data', data => err += data);
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(out) : reject(new Error(out + err)));
    });
}

function client() {
    return { cookie: '', csrf: '', async request(action, data, method = 'POST', csrf = true) {
        const query = new URLSearchParams({ action, ...(method === 'GET' ? data : {}) });
        const headers = { Cookie: this.cookie };
        if (method === 'POST') headers['Content-Type'] = 'application/json';
        if (csrf && this.csrf) headers['X-CSRF-Token'] = this.csrf;
        const response = await httpRequest(`${base}/submit.php?${query}`, { method, headers, body: method === 'POST' ? JSON.stringify(data || {}) : undefined });
        for (const cookie of response.headers.getSetCookie()) {
            if (cookie.startsWith('PHPSESSID=')) this.cookie = cookie.split(';')[0];
        }
        const text = await response.text();
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text}`); }
        if (json.csrf_token) this.csrf = json.csrf_token;
        return { status: response.status, json, headers: response.headers };
    }};
}

async function seed(email, verified = true) {
    const hash = await phpRun(['-r', "echo password_hash('FitconnectTest123!', PASSWORD_DEFAULT);"]);
    const result = await db.query('INSERT INTO users (email, password_hash, display_name, weight, height, email_verified_at) VALUES ($1,$2,$3,60,170,$4) RETURNING id',
        [email, hash, '測試運動員', verified ? new Date().toISOString() : null]);
    return result.rows[0].id;
}

async function token(userId, purpose, expired = false) {
    const raw = randomBytes(32).toString('hex');
    await db.query("INSERT INTO account_tokens (token_hash,user_id,purpose,expires_at) VALUES ($1,$2,$3,NOW() + $4::interval)", [sha(raw), userId, purpose, expired ? '-1 minute' : '1 hour']);
    return raw;
}

async function run() {
    if (process.argv.includes('--native')) {
        const binaries = process.env.PG_BIN || path.join(root, '.test-runtime/node_modules/@embedded-postgres/windows-x64/native/bin');
        nativeDir = path.join(root, '.test-runtime', 'pg-test-' + randomBytes(5).toString('hex'));
        const command = (name, args) => new Promise((resolve, reject) => {
            const child = spawn(path.join(binaries, name + (process.platform === 'win32' ? '.exe' : '')), args, { windowsHide: true });
            let output = '';
            child.stdout.on('data', data => output += data);
            child.stderr.on('data', data => output += data);
            child.on('error', reject);
            child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(output)));
        });
        await command('initdb', ['-D', nativeDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
        await command('pg_ctl', ['-D', nativeDir, '-l', nativeDir + '/server.log', '-o', '-h 127.0.0.1 -p 55439', '-w', 'start']);
        server = { stop: () => command('pg_ctl', ['-D', nativeDir, '-m', 'fast', '-w', 'stop']) };
        const { Client } = localRequire('pg');
        const pg = new Client({ connectionString: env.DATABASE_URL });
        await pg.connect();
        db = { query: (...args) => pg.query(...args), exec: query => pg.query(query), close: () => pg.end() };
        console.log('Using native PostgreSQL.');
    } else {
        db = await PGlite.create();
        server = new PGLiteSocketServer({ db, port: 55439, host: '127.0.0.1', maxConnections: 8 });
        await server.start();
    }
    const migration = await phpRun(['db/migrate.php']);
    check('fresh migration', () => assert.match(migration, /Applied/));
    check('migration is idempotent', () => {});
    assert.doesNotMatch(await phpRun(['db/migrate.php']), /Applied/);
    const aId = await seed('athlete-a@example.test');
    await seed('athlete-b@example.test');
    const pendingId = await seed('pending@example.test', false);
    web = spawn(php, [...phpArgs, '-S', '127.0.0.1:8094', '-t', root], { cwd: root, env, windowsHide: true });
    web.stderr.on('data', data => serverLog = (serverLog + data).slice(-12000));
    web.on('error', error => serverLog += error.message);
    let ready = false;
    for (let i = 0; i < 40; i++) {
        try { if ((await httpRequest(base + '/index.html')).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'PHP server did not start');
    if (process.argv.includes('--preview')) {
        const preview = client();
        await preview.request('login', { email: 'athlete-a@example.test', password: 'FitconnectTest123!' });
        for (const [days, type, minutes] of [[0, '跑步', 20], [1, '瑜珈', 30], [2, '腳踏車', 25]]) {
            const date = new Date(Date.now() - days * 86400000 - 120000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
            await preview.request('add_workout', { date, type, minutes });
        }
        console.log(`Preview ready: ${base} (isolated sample data only)`);
        const stopFile = path.join(root, '.test-runtime', 'stop-preview');
        await fs.rm(stopFile, { force: true });
        let stopping = false;
        process.once('SIGINT', () => stopping = true);
        process.once('SIGTERM', () => stopping = true);
        while (!stopping) {
            stopping = await fs.stat(stopFile).then(() => true).catch(() => false);
            if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return;
    }
    const a = client(), b = client(), guest = client();
    let result = await a.request('login', { email: 'athlete-a@example.test', password: 'FitconnectTest123!' });
    check('verified login creates CSRF session', () => assert.ok(result.json.success && a.csrf));
    await b.request('login', { email: 'athlete-b@example.test', password: 'FitconnectTest123!' });
    result = await guest.request('login', { email: 'pending@example.test', password: 'FitconnectTest123!' });
    check('unverified account cannot log in', () => assert.equal(result.json.verification_required, true));
    const verifyToken = await token(pendingId, 'verify');
    result = await guest.request('verify_email', { token: verifyToken });
    check('email verification consumes hashed token', () => assert.equal(result.json.success, true));
    result = await guest.request('verify_email', { token: verifyToken });
    check('verification token cannot be replayed', () => assert.equal(result.json.success, false));
    result = await guest.request('verify_email', { token: await token(pendingId, 'verify', true) });
    check('expired verification token is rejected', () => assert.equal(result.json.success, false));
    result = await a.request('list_workouts', {}, 'GET');
    check('private API is not cacheable', () => assert.match(result.headers.get('cache-control'), /no-store/));
    const date = new Date(Date.now() - 120000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
    const workout = { date, type: '跑步', minutes: 100 };
    result = await a.request('add_workout', workout, 'POST', false);
    check('workout write requires CSRF', () => assert.equal(result.status, 403));
    result = await a.request('add_workout', workout);
    check('add workout unlocks real achievements', () => assert.equal(result.json.achievements.length, 2));
    let rows = (await a.request('list_workouts', {}, 'GET')).json.data;
    const row = rows[0];
    check('history returns computed calories and revision', () => { assert.equal(Number(row.calories), 1050); assert.equal(Number(row.revision), 1); });
    result = await b.request('update_workout', { ...workout, id: row.id, revision: 1, minutes: 30 });
    check('another user cannot edit a workout', () => assert.equal(result.status, 404));
    result = await b.request('delete_workout', { id: row.id, revision: 1 });
    check('another user cannot delete a workout', () => assert.equal(result.status, 404));
    result = await a.request('update_workout', { ...workout, id: row.id, revision: 1, minutes: 30 });
    check('edit recalculates calories', () => assert.equal(result.json.calories, 315));
    check('edit revokes ineligible achievements', () => {});
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM achievements WHERE user_id=$1', [aId])).rows[0].count), 0);
    result = await a.request('update_workout', { ...workout, id: row.id, revision: 1, minutes: 50 });
    check('stale edit cannot overwrite newer version', () => assert.equal(result.status, 409));
    result = await a.request('get_report', { period: 'day' }, 'GET');
    check('daily report uses actual workout facts', () => { assert.equal(result.json.report.totals.minutes, 30); assert.equal(result.json.report.totals.calories, 315); });
    result = await a.request('get_report', { period: 'week' }, 'GET');
    check('weekly report is scoped to current user', () => assert.equal(result.json.report.totals.sessions, 1));
    result = await b.request('get_report', { period: 'week' }, 'GET');
    check('other user report is empty', () => assert.equal(result.json.report.totals.sessions, 0));
    result = await a.request('get_stats', { range: '1d' }, 'GET');
    check('statistics work after editing', () => assert.equal(result.json.success, true));
    result = await a.request('get_leaderboard', { range: 'total' }, 'GET');
    check('leaderboard reflects edited total', () => assert.equal(Number(result.json.data[0].total), 315));
    result = await a.request('delete_workout', { id: row.id, revision: 2 });
    check('delete succeeds with current revision', () => assert.equal(result.json.success, true, JSON.stringify(result.json)));
    assert.equal(Number((await db.query('SELECT total_calories FROM user_totals WHERE user_id=$1', [aId])).rows[0].total_calories), 0);
    result = await a.request('get_leaderboard', { range: 'total' }, 'GET');
    check('deleted workout is removed from leaderboard', () => assert.equal(result.json.data.length, 0));
    const streakRows = [];
    for (const days of [3, 2, 1]) {
        const date = new Date(Date.now() - days * 86400000 - 120000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
        const added = await a.request('add_workout', { date, type: '跑步', minutes: 1 });
        assert.equal(added.json.success, true);
        streakRows.push({ id: added.json.id, date, revision: 1 });
    }
    let streak = await db.query("SELECT COUNT(*) FROM achievements WHERE user_id=$1 AND type='streak_3'", [aId]);
    check('consecutive dates unlock streak achievement', () => assert.equal(Number(streak.rows[0].count), 1));
    await a.request('update_workout', { ...streakRows[1], date: streakRows[0].date, type: '跑步', minutes: 1 });
    streakRows[1].revision++;
    streak = await db.query("SELECT COUNT(*) FROM achievements WHERE user_id=$1 AND type='streak_3'", [aId]);
    check('moving a date revokes broken streak achievement', () => assert.equal(Number(streak.rows[0].count), 0));
    for (const row of streakRows) assert.equal((await a.request('delete_workout', row)).json.success, true);
    result = await a.request('ai_coach', { message: '運動建議' });
    check('missing Gemini key gives safe error', () => { assert.equal(result.json.success, false); assert.doesNotMatch(result.json.message, /SQL|stack|api\.openai/); });
    result = await guest.request('register', { email: 'new@example.test', password: 'FitconnectTest123!', display_name: '新用戶' });
    check('registration awaits verification and reports mail failure', () => { assert.equal(result.json.verification_required, true); assert.equal(result.json.email_sent, false); });
    const known = await guest.request('forgot_password', { email: 'athlete-a@example.test' });
    const unknown = await guest.request('forgot_password', { email: 'absent@example.test' });
    check('password recovery does not reveal registered emails', () => assert.equal(known.json.message, unknown.json.message));
    const resetToken = await token(aId, 'reset');
    result = await guest.request('reset_password', { token: resetToken, password: 'NewFitconnect123!' });
    check('reset password consumes token', () => assert.equal(result.json.success, true));
    result = await a.request('get_user_info', {}, 'GET');
    check('password reset invalidates previous sessions', () => assert.equal(result.json.success, false));
    result = await guest.request('reset_password', { token: resetToken, password: 'AnotherPassword123!' });
    check('reset token cannot be replayed', () => assert.equal(result.json.success, false));
    result = await a.request('login', { email: 'athlete-a@example.test', password: 'NewFitconnect123!' });
    check('new password can log in', () => assert.equal(result.json.success, true));
    for (let i = 0; i < 6; i++) result = await guest.request('resend_verification', { email: 'limit@example.test' });
    check('verification mail is rate limited', () => assert.equal(result.status, 429));
    const spoof = await httpRequest(base + '/LIFF/api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_user_status', lineUserId: 'spoofed' }) });
    check('LIFF rejects a bare spoofed user ID', () => assert.equal(spoof.status, 401));
    check('coach/date contract tests', () => {});
    console.log(await phpRun(['tests/contracts.php']));
    console.log(await phpRun(['-d', 'disable_functions=curl_setopt,curl_setopt_array,curl_exec,curl_getinfo', 'tests/provider-contracts.php'], { GEMINI_API_KEY: 'test-gemini-key', RESEND_API_KEY: 'test-mail-key' }));
    check('provider contracts use no external requests', () => {});
    if (process.argv.includes('--ui')) await uiTests();
    await db.exec("CREATE FUNCTION test_fail_total() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER test_fail_total BEFORE INSERT OR UPDATE ON user_totals FOR EACH ROW EXECUTE FUNCTION test_fail_total();");
    result = await a.request('add_workout', { ...workout, minutes: 10 });
    check('failed totals update fails entire write', () => assert.equal(result.status, 500));
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM workouts WHERE user_id=$1', [aId])).rows[0].count), 0);
    if (process.argv.includes('--native')) {
        await db.exec('DROP TRIGGER test_fail_total ON user_totals; DROP FUNCTION test_fail_total();');
        result = await a.request('add_workout', { ...workout, minutes: 10, request_key: 'post-failure-test-key' });
        check('database remains usable after rollback', () => assert.equal(result.json.success, true));
        await a.request('add_workout', { ...workout, minutes: 10, request_key: 'post-failure-test-key' });
        check('retry does not create duplicate workout', () => {});
        assert.equal(Number((await db.query('SELECT COUNT(*) FROM workouts WHERE user_id=$1', [aId])).rows[0].count), 1);
    }
    console.log(`Completed ${passed} integration checks.`);
}

async function uiTests() {
    const playwrightPath = process.env.PLAYWRIGHT_PATH || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
    const { chromium } = require(playwrightPath);
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    const fixtureHash = await phpRun(['-r', "echo password_hash('PreviewFit123!', PASSWORD_DEFAULT);"]);
    await db.query('UPDATE users SET password_hash=$1 WHERE email=$2', [fixtureHash, 'athlete-b@example.test']);
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-mobile', 320, 640]]) {
        const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base, { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(root, `test-results/${name}-login.png`) });
        await page.click('#open-forgot');
        await page.screenshot({ path: path.join(root, `test-results/${name}-forgot.png`) });
        await page.click('#forgot-form .account-back');
        await page.fill('#login-email', 'athlete-b@example.test');
        await page.fill('#login-password', 'PreviewFit123!');
        await page.click('#login-form [type=submit]');
        await page.waitForSelector('#dashboard-view:not(.hidden)');
        await page.waitForTimeout(500);
        await page.evaluate(() => { currentUser.weight = 60; currentUser.height = 170; });
        const session = await context.cookies();
        const api = client(); api.cookie = session.map(c => `${c.name}=${c.value}`).join('; ');
        api.csrf = (await api.request('get_user_info', {}, 'GET')).json.csrf_token;
        const date = new Date(Date.now() - 120000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
        await api.request('add_workout', { date, type: '瑜珈', minutes: 30 });
        await page.evaluate(() => document.getElementById('section-history').scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.screenshot({ path: path.join(root, `test-results/${name}-before-history.png`) });
        await page.click('#history-refresh');
        await page.waitForSelector('#workout-history-body tr');
        await page.waitForFunction(() => document.getElementById('history-status').textContent.startsWith('共 '));
        await page.locator('#section-history').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(root, `test-results/${name}-history.png`) });
        await page.evaluate(() => setGlobalRange('total'));
        await page.locator('#workout-history-body .icon-button').first().click();
        const dialog = await page.locator('#workout-dialog').boundingBox();
        check(`${name} editor stays inside viewport`, () => assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= width + 1 && dialog.y + dialog.height <= height + 1));
        await page.screenshot({ path: path.join(root, `test-results/${name}-edit.png`) });
        await page.fill('#edit-minutes', '35');
        const statsRefreshed = page.waitForResponse(response => response.url().includes('action=get_stats') && response.status() === 200);
        await page.click('#edit-workout-form [type=submit]');
        const updatedStats = await (await statsRefreshed).json();
        await page.waitForFunction(() => !document.getElementById('workout-dialog').open && document.getElementById('history-status').textContent.startsWith('共 '));
        check(`${name} saved edit refreshes charts in total ranking mode`, () => assert.equal(updatedStats.success, true));
        await page.evaluate(() => toggleChat());
        await page.click('.chat-shortcuts [data-report=week]');
        await page.waitForSelector('.report-interpret');
        await page.screenshot({ path: path.join(root, `test-results/${name}-chat.png`) });
        const geometry = await page.evaluate(() => {
            const chat = document.getElementById('chat-window').getBoundingClientRect();
            return { scroll: document.documentElement.scrollWidth, width: innerWidth, chat: { x: chat.x, y: chat.y, right: chat.right, bottom: chat.bottom }, height: innerHeight };
        });
        check(`${name} has no horizontal overflow`, () => assert.ok(geometry.scroll <= geometry.width + 1));
        check(`${name} chat stays inside viewport`, () => assert.ok(geometry.chat.x >= 0 && geometry.chat.y >= 0 && geometry.chat.right <= geometry.width + 1 && geometry.chat.bottom <= geometry.height + 1));
        check(`${name} has no JavaScript errors`, () => assert.deepEqual(errors, []));
        const cachedApis = await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            const urls = [];
            for (const key of await caches.keys()) {
                for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
            }
            return urls.filter(url => /submit\.php|LIFF\/api\.php/.test(url));
        });
        check(`${name} never caches private APIs`, () => assert.deepEqual(cachedApis, []));
        await context.setOffline(true);
        const offlineApi = await page.evaluate(() => fetch('submit.php?action=get_report&period=week').then(() => true).catch(() => false));
        check(`${name} offline API cannot return stale private data`, () => assert.equal(offlineApi, false));
        await context.setOffline(false);
        await page.click('#chat-close');
        await page.evaluate(() => document.getElementById('section-history').scrollIntoView({ block: 'start', behavior: 'instant' }));
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#workout-history-body [title="刪除紀錄"]').first().click();
        await page.waitForFunction(() => document.getElementById('history-status').textContent.startsWith('還沒有'));
        const remainingRows = await page.locator('#workout-history-body tr').count();
        check(`${name} deletion updates history`, () => assert.equal(remainingRows, 0));
        await context.close();
    }
}

run().catch(error => { console.error(error); console.error(serverLog); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    if (web) { web.kill(); await new Promise(resolve => web.once('close', resolve)); }
    if (db) await db.close();
    if (server) await server.stop();
    if (nativeDir) {
        const allowed = path.resolve(root, '.test-runtime') + path.sep;
        assert.ok(path.resolve(nativeDir).startsWith(allowed));
        await fs.rm(nativeDir, { recursive: true, force: true });
    }
});

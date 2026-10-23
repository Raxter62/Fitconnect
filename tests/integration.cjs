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
const php = process.env.PHP_BIN || 'php';
const phpArgs = [];
let web, server, db, browser;
let nativeDir;
let serverLog = '';
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const sha = value => createHash('sha256').update(value).digest('hex');
const httpPort = Number(process.env.FC_TEST_HTTP_PORT || 8094);
const pgPort = Number(process.env.FC_TEST_PG_PORT || 55439);
assert.ok([httpPort, pgPort].every(port => Number.isInteger(port) && port > 0 && port < 65536));
const base = `http://127.0.0.1:${httpPort}`;
const env = { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`, APP_BASE_URL: base, APP_ENV: 'local', GEMINI_API_KEY: '', RESEND_API_KEY: '' };

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
        try {
            await command('pg_ctl', ['-D', nativeDir, '-l', nativeDir + '/server.log', '-o', `-h 127.0.0.1 -p ${pgPort}`, '-w', 'start']);
        } catch (error) {
            const log = await fs.readFile(nativeDir + '/server.log', 'utf8').catch(() => 'No PostgreSQL log available.');
            throw new Error(error.message + '\n' + log);
        }
        server = { stop: () => command('pg_ctl', ['-D', nativeDir, '-m', 'fast', '-w', 'stop']) };
        const { Client } = localRequire('pg');
        const pg = new Client({ connectionString: env.DATABASE_URL });
        await pg.connect();
        db = { query: (...args) => pg.query(...args), exec: query => pg.query(query), close: () => pg.end() };
        console.log('Using native PostgreSQL.');
    } else {
        db = await PGlite.create();
        server = new PGLiteSocketServer({ db, port: pgPort, host: '127.0.0.1', maxConnections: 8 });
        await server.start();
    }
    const schema = await fs.readFile(path.join(root, 'db/schema.sql'), 'utf8');
    await db.exec('CREATE SCHEMA fresh_install; SET search_path TO fresh_install;');
    await db.exec(schema);
    const baseline = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='fresh_install' AND table_name='workouts'");
    check('standalone schema includes new workout columns', () => assert.ok(['revision', 'request_key', 'weight_kg'].every(name => baseline.rows.some(row => row.column_name === name))));
    check('standalone schema includes request deduplication index', () => {});
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM pg_indexes WHERE schemaname='fresh_install' AND indexname='idx_workouts_request_key'")).rows[0].count), 1);
    await db.exec(`SET search_path TO public;
        CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
            display_name TEXT, avatar_id INTEGER NOT NULL DEFAULT 1, line_user_id TEXT UNIQUE,
            line_bind_code VARCHAR(10), line_bind_code_expires_at TIMESTAMPTZ, height NUMERIC(5,1), weight NUMERIC(5,1), created_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE workouts (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TIMESTAMPTZ NOT NULL, type TEXT NOT NULL, minutes INTEGER NOT NULL, calories INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
        INSERT INTO users (email,password_hash) VALUES ('legacy@example.test','fixture');
        INSERT INTO workouts (user_id,date,type,minutes,calories) SELECT id,NOW(),'跑步',10,100 FROM users;`);
    const migration = await phpRun(['db/migrate.php']);
    check('fresh migration', () => assert.match(migration, /Applied/));
    check('migration is idempotent', () => {});
    assert.doesNotMatch(await phpRun(['db/migrate.php']), /Applied/);
    const legacy = await db.query("SELECT t.total_calories FROM user_totals t JOIN users u ON u.id=t.user_id WHERE u.email='legacy@example.test'");
    check('legacy upgrade preserves workouts and backfills totals', () => assert.equal(Number(legacy.rows[0].total_calories), 100));
    await db.exec("DELETE FROM users WHERE email='legacy@example.test';");
    const aId = await seed('athlete-a@example.test');
    await seed('athlete-b@example.test');
    const pendingId = await seed('pending@example.test', false);
    web = spawn(php, [...phpArgs, '-S', `127.0.0.1:${httpPort}`, '-t', root], { cwd: root, env, windowsHide: true });
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
    check('missing Gemini key gives only the public fallback', () => { assert.equal(result.status, 502); assert.equal(result.json.message, '這個問題我沒辦法回答喔'); });
    const paginationId = await seed('pagination@example.test');
    await db.query("INSERT INTO workouts(user_id,date,type,minutes,calories) SELECT $1,NOW() - n * INTERVAL '1 minute','瑜珈',5,16 FROM generate_series(1,25) n", [paginationId]);
    const pagination = client();
    await pagination.request('login', { email: 'pagination@example.test', password: 'FitconnectTest123!' });
    let paged = (await pagination.request('list_workouts', {}, 'GET')).json;
    check('desktop pagination uses 20 rows', () => { assert.equal(paged.data.length, 20); assert.equal(paged.pages, 2); });
    paged = (await pagination.request('list_workouts', { per_page: 10, page: 3 }, 'GET')).json;
    check('mobile pagination uses 10 rows and a correct last page', () => { assert.equal(paged.data.length, 5); assert.equal(paged.pages, 3); assert.equal(paged.page, 3); });
    result = await pagination.request('list_workouts', { per_page: 500 }, 'GET');
    check('pagination rejects an unbounded page size', () => assert.equal(result.status, 400));
    result = await pagination.request('get_report', { period: 'day' }, 'GET');
    check('report omits repeated metadata but keeps estimated calories', () => { assert.doesNotMatch(result.json.report.text, /台北時間|資料來源/); assert.match(result.json.report.text, /估計消耗/); });
    await db.query('DELETE FROM users WHERE id=$1', [paginationId]);
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
    await releaseTests();
    if (process.argv.includes('--ui')) {
        await uiTests();
        await upgradeUiTests();
    }
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
    const uiUserId = (await db.query("SELECT id FROM users WHERE email='athlete-b@example.test'")).rows[0].id;
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-mobile', 320, 640]]) {
        const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        const historyRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (request.url().includes('action=list_workouts')) historyRequests.push(request.url()); });
        await page.goto(base, { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        const release = await page.locator('meta[name="fitconnect-version"]').getAttribute('content');
        check(`${name} footer and assets share the same release`, () => {});
        assert.equal(await page.locator('#app-version').innerText(), 'v' + release);
        const assetVersions = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
            .map(element => new URL(element.src || element.href)).filter(url => url.origin === location.origin).map(url => url.searchParams.get('v')));
        assert.ok(assetVersions.length >= 6 && assetVersions.every(version => version === release));
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
        check(`${name} home has no history section or history request`, () => assert.equal(historyRequests.length, 0));
        assert.equal(await page.locator('#section-history').isVisible(), false);
        for (const repeat of [false, true]) {
            await page.evaluate(() => {
                window.scrollTo({ top: 0, behavior: 'instant' });
                window.__navScrollSamples = [];
                window.__navLastScroll = performance.now();
                window.__navScrollListener = () => {
                    window.__navScrollSamples.push(scrollY);
                    window.__navLastScroll = performance.now();
                };
                window.addEventListener('scroll', window.__navScrollListener);
            });
            if (width <= 768) await page.click('.nav-toggle');
            await page.click('.nav-links [href="#section-charts"]');
            await page.waitForFunction(() => window.__navScrollSamples.length > 1 && performance.now() - window.__navLastScroll > 150);
            const navigation = await page.evaluate(() => {
                window.removeEventListener('scroll', window.__navScrollListener);
                return { samples: window.__navScrollSamples, end: scrollY, hash: location.hash };
            });
            check(`${name} ${repeat ? 'same-section' : 'section'} navigation scrolls gradually`, () => {
                assert.equal(navigation.hash, '#section-charts');
                assert.ok(navigation.end > 100);
                assert.ok(navigation.samples.some(y => y > 5 && y < navigation.end - 5));
            });
        }
        if (width > 768) await page.emulateMedia({ reducedMotion: 'reduce' });
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('.nav-links [href="#section-hero"]');
        await page.waitForFunction(() => scrollY < 2);
        if (width > 768) {
            check('reduced-motion navigation returns without animation', () => {});
            await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        const session = await context.cookies();
        const api = client(); api.cookie = session.map(c => `${c.name}=${c.value}`).join('; ');
        api.csrf = (await api.request('get_user_info', {}, 'GET')).json.csrf_token;
        await db.query("INSERT INTO workouts(user_id,date,type,minutes,calories,weight_kg) SELECT $1,NOW() - (n+2) * INTERVAL '1 minute','其他',5,16,60 FROM generate_series(1,22) n", [uiUserId]);
        const date = new Date(Date.now() - 120000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
        await api.request('add_workout', { date, type: '瑜珈', minutes: 30 });
        await page.screenshot({ path: path.join(root, `test-results/${name}-home.png`) });
        await page.evaluate(() => setGlobalRange('total'));
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('.nav-links [href="#workouts"]');
        await page.waitForSelector('#workout-history-body tr');
        await page.waitForFunction(() => document.getElementById('history-status').textContent.startsWith('共 '));
        check(`${name} history is a separate page with responsive pagination`, () => {});
        assert.equal(await page.locator('#home-view').isVisible(), false);
        assert.equal(await page.locator('#section-leaderboard').isVisible(), false);
        assert.equal(await page.locator('#ai-coach-container').isVisible(), false);
        assert.equal(await page.locator('#workout-history-body tr').count(), width <= 768 ? 10 : 20);
        const titleBounds = await page.locator('#history-title').boundingBox();
        check(`${name} history title is centered`, () => assert.ok(Math.abs(titleBounds.x + titleBounds.width / 2 - width / 2) < 2));
        const waveMoving = await page.locator('#history-wave').evaluate(el => el.closest('svg').querySelector('use').getAnimations().length > 0);
        check(`${name} history retains animated waves`, () => assert.ok(waveMoving));
        await page.waitForFunction(() => innerWidth > 768 || document.querySelector('.nav-links').getBoundingClientRect().left >= innerWidth - 1);
        await page.screenshot({ path: path.join(root, `test-results/${name}-history.png`) });
        if (width > 768) {
            await page.click('#history-next');
            await page.waitForFunction(() => document.getElementById('history-page').textContent === '2 / 2' && !document.getElementById('history-refresh').disabled);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForFunction(() => document.getElementById('history-page').textContent === '3 / 3' && !document.getElementById('history-refresh').disabled);
            check('resize preserves first record and switches to 10-row pagination', () => {});
            assert.equal(await page.locator('#workout-history-body tr').count(), 3);
            await page.setViewportSize({ width, height });
            await page.waitForFunction(() => document.getElementById('history-page').textContent === '2 / 2' && !document.getElementById('history-refresh').disabled);
            await page.click('#history-prev');
            await page.waitForFunction(() => document.getElementById('history-page').textContent === '1 / 2' && !document.getElementById('history-refresh').disabled);
        }
        await page.locator('#workout-history-body .icon-button').first().click();
        const dialog = await page.locator('#workout-dialog').boundingBox();
        check(`${name} editor stays inside viewport`, () => assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= width + 1 && dialog.y + dialog.height <= height + 1));
        await page.screenshot({ path: path.join(root, `test-results/${name}-edit.png`) });
        await page.fill('#edit-minutes', '35');
        await page.click('#edit-workout-form [type=submit]');
        await page.waitForFunction(() => !document.getElementById('workout-dialog').open && document.getElementById('history-status').textContent.startsWith('共 '));
        const statsRefreshed = page.waitForResponse(response => response.url().includes('action=get_stats') && response.status() === 200);
        await page.click('#history-view [aria-label="返回首頁"]');
        const updatedStats = await (await statsRefreshed).json();
        check(`${name} returning home refreshes charts in total ranking mode`, () => assert.equal(updatedStats.success, true));
        await page.goBack();
        await page.waitForSelector('#history-view:not(.hidden)');
        await page.goForward();
        await page.waitForSelector('#home-view:not(.hidden)');
        check(`${name} browser back and forward switch pages`, () => {});
        const portrait = await page.locator('.coach-full-img').boundingBox();
        check(`${name} full portrait is visible, not a round thumbnail`, () => assert.ok(portrait.width >= 180 && portrait.y >= 0 && portrait.y + portrait.height <= height + 1));
        if (width <= 768) {
            const alignment = await page.locator('.coach-full-img').evaluate(image => {
                const bounds = image.getBoundingClientRect();
                const frame = image.closest('.coach-img-wrapper').getBoundingClientRect();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let right = 0;
                for (let y = 0; y < canvas.height; y++) {
                    for (let x = 0; x < canvas.width; x++) {
                        if (data[(y * canvas.width + x) * 4 + 3] > 16) right = Math.max(right, x);
                    }
                }
                return { edge: bounds.left + (right + 1) * bounds.width / canvas.width, right: frame.right, bottom: frame.bottom, width: innerWidth, height: innerHeight };
            });
            check(`${name} visible coach artwork aligns with the lower-right edge`, () => {
                assert.ok(Math.abs(alignment.edge - alignment.right) < 1);
                assert.ok(Math.abs(alignment.right - alignment.width) < 1);
                assert.ok(Math.abs(alignment.bottom - alignment.height) < 1);
            });
        }
        await page.locator('.coach-img-wrapper').click();
        await page.click('.chat-shortcuts [data-report=week]');
        await page.waitForSelector('.report-interpret');
        const facts = await page.locator('.report-facts').innerText();
        check(`${name} reports omit internal notices and timezone labels`, () => assert.doesNotMatch(facts, /資料來源|台北時間|Google/));
        await page.fill('#chat-input', '今天適合做些什麼運動？');
        await page.click('#chat-send');
        await page.waitForFunction(() => !coachBusy);
        check(`${name} real missing-key error has only the generic refusal`, () => {});
        assert.equal(await page.locator('.chat-msg.ai').last().innerText(), '這個問題我沒辦法回答喔');
        let failReply = false;
        await page.route('**/submit.php?action=ai_coach', route => route.fulfill({
            status: failReply ? 429 : 200, contentType: 'application/json',
            body: JSON.stringify(failReply ? { success: false, message: 'Gemini quota API key data check DO_NOT_SHOW' } : {
                success: true, response: '看得出你正在努力養成習慣，今天可以依身體感受放慢一點，讓運動舒服地持續下去。',
                report: { text: '個人週報 SHOULD_NOT_REPEAT', period: 'week' }
            })
        }));
        await page.click('.report-interpret');
        await page.waitForFunction(() => !coachBusy);
        check(`${name} conversation stays warm without inserting another report`, () => {});
        assert.equal(await page.locator('.report-facts').count(), 1);
        assert.match(await page.locator('.chat-msg.ai').last().innerText(), /舒服地持續/);
        assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /SHOULD_NOT_REPEAT|AI 建議/);
        assert.equal(await page.locator('.chat-msg.ai:not([data-speaker="AI教練"])').count(), 0);
        failReply = true;
        await page.fill('#chat-input', '還有其他建議嗎？');
        await page.click('#chat-send');
        await page.waitForFunction(() => !coachBusy);
        assert.equal(await page.locator('.chat-msg.ai').last().innerText(), '這個問題我沒辦法回答喔');
        check(`${name} UI never shows provider diagnostics`, () => {});
        assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /Gemini|quota|DO_NOT_SHOW/);
        await page.screenshot({ path: path.join(root, `test-results/${name}-chat.png`) });
        const geometry = await page.evaluate(() => {
            const chat = document.getElementById('chat-window').getBoundingClientRect();
            const portrait = document.querySelector('.coach-full-img').getBoundingClientRect();
            return { scroll: document.documentElement.scrollWidth, width: innerWidth, chat: { x: chat.x, y: chat.y, right: chat.right, bottom: chat.bottom }, portrait: { x: portrait.x, y: portrait.y, right: portrait.right, bottom: portrait.bottom }, height: innerHeight };
        });
        check(`${name} has no horizontal overflow`, () => assert.ok(geometry.scroll <= geometry.width + 1));
        check(`${name} chat stays inside viewport`, () => assert.ok(geometry.chat.x >= 0 && geometry.chat.y >= 0 && geometry.chat.right <= geometry.width + 1 && geometry.chat.bottom <= geometry.height + 1));
        check(`${name} chat does not cover the portrait`, () => assert.ok(geometry.chat.bottom <= geometry.portrait.y || geometry.chat.right <= geometry.portrait.x));
        if (await page.locator('#chat-privacy').count()) {
            await page.click('#chat-privacy');
            await page.waitForSelector('#coach-privacy-dialog[open]');
            await page.click('#coach-privacy-close');
        }
        if (width > 768) {
            await page.setViewportSize({ width, height: 500 });
            await page.waitForTimeout(100);
            const beside = await page.evaluate(() => ({ chat: document.getElementById('chat-window').getBoundingClientRect().right, portrait: document.querySelector('.coach-full-img').getBoundingClientRect().left }));
            check('short desktop places chat beside the portrait', () => assert.ok(beside.chat <= beside.portrait));
            await page.screenshot({ path: path.join(root, 'test-results/desktop-short-chat.png') });
            await page.setViewportSize({ width, height });
        }
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
        await page.evaluate(() => toggleAICoach());
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('.nav-links [href="#workouts"]');
        await page.waitForFunction(() => !document.getElementById('history-refresh').disabled);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        await page.fill('#login-email', 'athlete-b@example.test');
        await page.fill('#login-password', 'PreviewFit123!');
        await page.click('#login-form [type=submit]');
        await page.waitForSelector('#history-view:not(.hidden)');
        await page.waitForFunction(() => !document.getElementById('history-refresh').disabled);
        check(`${name} history deep link survives refresh and login`, () => {});
        while (await page.locator('#history-next').isEnabled()) {
            await page.click('#history-next');
            await page.waitForFunction(() => !document.getElementById('history-refresh').disabled);
        }
        const lastPage = await page.locator('#history-page').innerText();
        for (let i = 0; i < 3; i++) {
            page.once('dialog', dialog => dialog.accept());
            const deleted = page.waitForResponse(response => response.url().includes('action=delete_workout'));
            await page.locator('#workout-history-body [title="刪除紀錄"]').first().click();
            await deleted;
            await page.waitForFunction(total => document.getElementById('history-status').textContent === `共 ${total} 筆紀錄` && !document.getElementById('history-refresh').disabled, 22 - i);
        }
        const afterPage = await page.locator('#history-page').innerText();
        check(`${name} deleting the last page retreats to a valid page`, () => assert.notEqual(afterPage, lastPage));
        await db.query('DELETE FROM workouts WHERE user_id=$1', [uiUserId]);
        await db.query('UPDATE user_totals SET total_calories=0 WHERE user_id=$1', [uiUserId]);
        await page.click('#history-refresh');
        await page.waitForSelector('#history-empty:not(.hidden)');
        const remainingRows = await page.locator('#workout-history-body tr').count();
        check(`${name} empty history has no stale rows`, () => assert.equal(remainingRows, 0));
        if (width <= 768) {
            await page.click('#history-view [aria-label="返回首頁"]');
            await page.click('.nav-toggle');
            await page.screenshot({ path: path.join(root, `test-results/${name}-menu.png`) });
            await page.click('#nav-coach-toggle');
            if (width <= 768) await page.click('.nav-toggle');
            await page.click('.nav-links [href="#workouts"]');
            await page.click('#history-view [aria-label="返回首頁"]');
            check(`${name} navigation retains the coach visibility preference`, () => {});
            assert.equal(await page.locator('#ai-coach-container').isVisible(), false);
        }
        await page.route('**/submit.php?action=logout', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) }));
        let logoutMessage = '';
        page.once('dialog', async dialog => { logoutMessage = dialog.message(); await dialog.dismiss(); });
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('#nav-logout');
        await page.waitForFunction(() => !logoutPending);
        check(`${name} failed logout preserves the active session`, () => {});
        assert.equal(logoutMessage, '暫時無法登出，請稍後再試。');
        assert.equal(await page.locator('#dashboard-view').isVisible(), true);
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('.nav-links [href="#section-charts"]');
        await page.waitForFunction(() => location.hash === '#section-charts' && scrollY > 100);
        check(`${name} navigation still works after failed logout`, () => {});
        await page.unroute('**/submit.php?action=logout');
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('#nav-logout');
        await page.waitForSelector('#auth-view:not(.hidden)');
        check(`${name} logout returns to login and revokes the server session`, () => {});
        assert.equal((await api.request('get_user_info', {}, 'GET')).status, 401);
        assert.equal(await page.locator('#chat-window').isVisible(), false);
        await page.fill('#login-email', 'athlete-b@example.test');
        await page.fill('#login-password', 'PreviewFit123!');
        await page.click('#login-form [type=submit]');
        await page.waitForSelector('#dashboard-view:not(.hidden)');
        if (width <= 768) await page.click('.nav-toggle');
        await page.click('.nav-links [href="#workouts"]');
        await page.waitForSelector('#history-view:not(.hidden)');
        check(`${name} logging in again restores navigation`, () => {});
        await page.locator('#app-version').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const readableVersion = await page.locator('#app-version').evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        });
        check(`${name} small footer version is readable at the page bottom`, () => assert.equal(readableVersion, true));
        await page.screenshot({ path: path.join(root, `test-results/${name}-version.png`) });
        await page.goto(base + '/#auth=verify&token=' + 'a'.repeat(64), { waitUntil: 'networkidle' });
        await page.waitForSelector('#verify-form:not(.hidden)');
        check(`${name} workout routing does not break email token links`, () => assert.equal(new URL(page.url()).hash, ''));
        check(`${name} all navigation completes without JavaScript errors`, () => assert.deepEqual(errors, []));
        await context.close();
    }
}

async function releaseTests() {
    const fixture = path.join(root, '.test-runtime', 'release-test-' + randomBytes(5).toString('hex'));
    try {
        for (const file of ['index.html', 'service-worker.js', 'manifest.json', 'Dockerfile', '.htaccess', 'release.json', 'tools/stamp-release.php', 'public/js/main.js']) {
            await fs.mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
            await fs.copyFile(path.join(root, file), path.join(fixture, file));
        }
        const script = path.join(fixture, 'tools/stamp-release.php');
        const first = (await phpRun([script])).trim();
        const second = (await phpRun([script])).trim();
        check('release stamp is stable when rebuilding identical content', () => assert.equal(first, second));
        const html = await fs.readFile(path.join(fixture, 'index.html'), 'utf8');
        const worker = await fs.readFile(path.join(fixture, 'service-worker.js'), 'utf8');
        check('release build stamps the footer, metadata, asset URLs and service worker together', () => {
            assert.match(first, /^2026\.10\.23\.3-[a-f0-9]{12}$/);
            assert.ok(html.includes(`content="${first}"`) && html.includes(`>v${first}</small>`));
            assert.ok(html.includes(`style.css?v=${first}`) && html.includes(`ai_chat.js?v=${first}`));
            assert.ok(worker.includes(`APP_VERSION = '${first}'`));
        });
        await fs.appendFile(path.join(fixture, 'public/js/main.js'), '\n// Changed test release\n');
        const changed = (await phpRun([script])).trim();
        check('changing application content automatically changes the next build version', () => assert.notEqual(changed, first));
    } finally {
        assert.ok(path.resolve(fixture).startsWith(path.resolve(root, '.test-runtime') + path.sep));
        await fs.rm(fixture, { recursive: true, force: true });
    }
}

async function upgradeUiTests() {
    const legacyAssets = [];
    for (const file of ['public/js/ai_chat.js', 'public/js/features.js', 'public/css/style.css']) {
        let body = await fs.readFile(path.join(root, file), 'utf8');
        if (file.endsWith('ai_chat.js')) body = body.replaceAll('?.addEventListener', '.addEventListener');
        if (file.endsWith('features.js')) body = body.replace("getElementById('coach-privacy-dialog')?.close()", "getElementById('coach-privacy-dialog').close()").replace("'instant' : 'smooth'", "'instant' : 'instant'");
        if (file.endsWith('.css')) body += '\n#ai-coach-container { right: 18px !important; bottom: 20px !important; }';
        legacyAssets.push([file, body, file.endsWith('.css') ? 'text/css' : 'application/javascript']);
    }
    const legacyWorker = `
        self.addEventListener('install', event => event.waitUntil((async () => {
            const cache = await caches.open('fitconnect-legacy-fixture');
            for (const [path, body, type] of ${JSON.stringify(legacyAssets)}) {
                await cache.put(new URL(path, self.location.href), new Response(body, { headers: { 'Content-Type': type } }));
            }
            await self.skipWaiting();
        })()));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
            const request = event.request;
            if (request.method !== 'GET' || !new URL(request.url).pathname.includes('/public/')) return;
            event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
        });`;
    let upgraded = false;
    const proxy = http.createServer((request, response) => {
        if (request.url === '/service-worker.js' && !upgraded) {
            response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
            response.end(legacyWorker);
        } else if (request.url === '/?legacy-bootstrap=1') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end('<!DOCTYPE html><script>navigator.serviceWorker.register("/service-worker.js")</script>');
        } else {
            const upstream = http.request(base + request.url, { method: request.method, headers: { ...request.headers, Connection: 'close' } }, result => {
                response.writeHead(result.statusCode, { ...result.headers, Connection: 'close' });
                result.pipe(response);
            });
            upstream.on('error', () => { response.writeHead(502); response.end(); });
            request.pipe(upstream);
        }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const upgradeBase = `http://127.0.0.1:${proxy.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(upgradeBase + '/?legacy-bootstrap=1');
        await page.waitForFunction(() => navigator.serviceWorker.controller);
        const oldCache = await page.evaluate(async () => (await (await caches.open('fitconnect-legacy-fixture')).keys()).length);
        check('upgrade fixture has a controlling old worker and stale unversioned assets', () => assert.equal(oldCache, 3));
        await page.goto(upgradeBase, { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        await page.fill('#login-email', 'athlete-a@example.test');
        await page.fill('#login-password', 'NewFitconnect123!');
        await page.click('#login-form [type=submit]');
        await page.waitForSelector('#dashboard-view:not(.hidden)');
        await page.locator('.coach-img-wrapper').click();
        await page.click('.chat-shortcuts [data-report=week]');
        await page.waitForSelector('.report-interpret');
        await page.click('.chat-shortcuts [data-report=day]');
        await page.waitForFunction(() => document.querySelectorAll('.report-facts').length === 2 && !coachBusy);
        check('old-cache upgrade keeps both chat report shortcuts working', () => {});
        await page.fill('#chat-input', '今天適合散步嗎？');
        await page.click('#chat-send');
        await page.waitForFunction(() => !coachBusy);
        assert.equal(await page.locator('.chat-msg.ai').last().innerText(), '這個問題我沒辦法回答喔');
        check('old-cache upgrade can send chat messages', () => {});
        await page.click('#chat-close');
        await page.evaluate(() => {
            window.__upgradeScrolls = [];
            window.__upgradeScroll = () => window.__upgradeScrolls.push(scrollY);
            window.addEventListener('scroll', window.__upgradeScroll);
        });
        await page.click('.nav-toggle');
        await page.click('.nav-links [href="#section-charts"]');
        await page.waitForTimeout(1200);
        const motion = await page.evaluate(() => {
            window.removeEventListener('scroll', window.__upgradeScroll);
            return { end: scrollY, samples: window.__upgradeScrolls };
        });
        check('old-cache upgrade restores actual smooth navigation', () => assert.ok(motion.samples.some(y => y > 5 && y < motion.end - 5)));
        const edge = await page.locator('#ai-coach-container').evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
        });
        check('old-cache upgrade uses the new mobile coach position', () => assert.ok(Math.abs(edge.right - edge.width) < 1 && Math.abs(edge.bottom - edge.height) < 1));
        await page.click('.nav-toggle');
        await page.click('#nav-logout');
        await page.waitForSelector('#auth-view:not(.hidden)');
        check('old-cache upgrade logs out without leaving a dead dashboard', () => {});
        upgraded = true;
        await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
        await page.waitForFunction(async () => (await caches.keys()).some(key => key.startsWith('fitconnect-v12-')) && !(await caches.keys()).includes('fitconnect-legacy-fixture'));
        await page.waitForFunction(() => new Promise(resolve => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 500);
            channel.port1.onmessage = event => {
                clearTimeout(timer);
                channel.port1.close();
                resolve(event.data.version === document.querySelector('meta[name="fitconnect-version"]').content);
            };
            navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        }));
        check('new worker activates after precaching and removes the old cache', () => {});
        await page.evaluate(async () => {
            const key = (await caches.keys()).find(name => name.startsWith('fitconnect-v12-'));
            const cache = await caches.open(key);
            const version = document.querySelector('meta[name="fitconnect-version"]').content;
            await cache.put(`public/js/ai_chat.js?v=${version}`, new Response('throw new Error("STALE_VERSIONED_SCRIPT")', { headers: { 'Content-Type': 'application/javascript' } }));
            await cache.put(`public/css/style.css?v=${version}`, new Response('#app-version { display: none }', { headers: { 'Content-Type': 'text/css' } }));
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        check('online reload replaces stale versioned CSS and JavaScript before execution', () => {});
        assert.equal(await page.locator('#app-version').isVisible(), true);
        assert.deepEqual(errors, []);
        await page.locator('#app-version').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(root, 'test-results/mobile-upgraded-version.png') });
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(350);
        check('current release remains available offline without loading another release', () => {});
        assert.equal(await page.locator('#app-version').innerText(), 'v2026.10.23.3');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
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

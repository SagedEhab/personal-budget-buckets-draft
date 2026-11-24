// Controlled security tests against our own application (local gateway, real HTTP).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startGateway, client, recorder, short, today, root } = require('./helpers');

const rec = recorder('security');
let gw;
let api;
const s = {};

test.before(async () => {
  gw = await startGateway('security');
  api = client(gw.base);
  const a = await api.post('/api/auth/register', { name: 'Alice', email: 'alice@example.com', password: 'AlicePass2026' });
  const b = await api.post('/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'BobPass20266' });
  s.alice = a.body.token; s.bob = b.body.token;
  const bucket = await api.post('/api/buckets', { name: 'Alice Food', monthlyLimit: 900 }, { token: s.alice });
  s.aliceBucket = bucket.body.id;
  const txn = await api.post('/api/transactions', { type: 'expense', amount: 120, date: today(), bucketId: s.aliceBucket, paymentMethod: 'card', note: '<img src=x onerror=alert(1)>' }, { token: s.alice });
  s.aliceTxn = txn.body.transaction.id;
  const rep = await api.post('/api/insights/reports', { type: 'transactions', from: `${today().slice(0, 7)}-01`, to: today() }, { token: s.alice });
  s.aliceReport = rep.body.id;
});
test.after(() => gw.server.close());

test('ST-01 unauthenticated access is rejected on every service', async () => {
  const r = await Promise.all(['/api/buckets', '/api/transactions', '/api/insights/dashboard', '/api/auth/me'].map((p) => api.get(p)));
  const actual = r.map(short).join(', ');
  const pass = r.every((x) => x.status === 401);
  rec.add('ST-01', 'Authentication', 'GET buckets, transactions, dashboard, me with no token', '401 ×4', actual, pass);
  assert.ok(pass, actual);
});

test('ST-02 tampered / forged / malformed tokens', async () => {
  const [h, p, sig] = s.alice.split('.');
  const flipped = `${h}.${p}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url')}.${sig}`;
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
  const r = await Promise.all([flipped, forged, none, 'garbage'].map((t) => api.get('/api/auth/users', { token: t })));
  const actual = r.map(short).join(', ');
  const pass = r.every((x) => x.status === 401);
  rec.add('ST-02', 'Authentication', 'Admin route with: changed signature, role changed to admin, alg none, garbage', '401 ×4', actual, pass);
  assert.ok(pass, actual);
});

test('ST-03 expired token', async () => {
  const { jwt, ISSUER, AUDIENCE } = require(path.join(root, 'services/auth-service/node_modules/pb-common'));
  const old = jwt.sign({ sub: 'x', role: 'user' }, process.env.JWT_SECRET, { expiresInSec: -60, issuer: ISSUER, audience: AUDIENCE });
  const r = await api.get('/api/buckets', { token: old });
  const pass = r.status === 401 && /expired/i.test(r.body.error.message);
  rec.add('ST-03', 'Authentication', 'Correctly signed token that expired 60 s ago', '401 "Session expired"', `${short(r)} "${r.body.error.message}"`, pass);
  assert.ok(pass);
});

test('ST-04 unauthorized role (user → admin endpoints)', async () => {
  const r = await Promise.all([
    api.get('/api/auth/users', { token: s.bob }),
    api.post('/api/buckets/templates', { name: 'Hack', suggestedLimit: 1 }, { token: s.bob }),
    api.get('/api/insights/admin/overview', { token: s.bob }),
    api.get('/api/transactions/admin/stats', { token: s.bob })
  ]);
  const actual = r.map(short).join(', ');
  const pass = r.every((x) => x.status === 403);
  rec.add('ST-04', 'Authorization', 'Normal user calls users list, create template, admin overview, transaction stats', '403 ×4', actual, pass);
  assert.ok(pass, actual);
});

test('ST-05 ownership: Bob cannot read, change or delete Alice\'s bucket', async () => {
  const r = await Promise.all([
    api.get(`/api/buckets/${s.aliceBucket}`, { token: s.bob }),
    api.patch(`/api/buckets/${s.aliceBucket}`, { monthlyLimit: 1 }, { token: s.bob }),
    api.del(`/api/buckets/${s.aliceBucket}`, { token: s.bob })
  ]);
  const still = await api.get(`/api/buckets/${s.aliceBucket}`, { token: s.alice });
  const actual = `${r.map(short).join(', ')}; Alice's limit still ${still.body.monthlyLimit}`;
  const pass = r.every((x) => x.status === 404) && still.body.monthlyLimit === 900;
  rec.add('ST-05', 'Ownership (IDOR)', 'Bob uses Alice\'s bucket id with GET, PATCH, DELETE', '404 ×3, Alice\'s bucket unchanged', actual, pass);
  assert.ok(pass, actual);
});

test('ST-06 ownership: transactions and reports', async () => {
  const r = await Promise.all([
    api.get(`/api/transactions/${s.aliceTxn}`, { token: s.bob }),
    api.del(`/api/transactions/${s.aliceTxn}`, { token: s.bob }),
    api.get(`/api/insights/reports/${s.aliceReport}/download`, { token: s.bob })
  ]);
  const actual = r.map(short).join(', ');
  const pass = r.every((x) => x.status === 404);
  rec.add('ST-06', 'Ownership (IDOR)', 'Bob reads/deletes Alice\'s transaction, downloads Alice\'s report', '404 ×3', actual, pass);
  assert.ok(pass, actual);
});

test('ST-07 cross-service ownership: expense into another user\'s bucket', async () => {
  const r = await api.post('/api/transactions', { type: 'expense', amount: 10, date: today(), bucketId: s.aliceBucket, paymentMethod: 'cash' }, { token: s.bob });
  const pass = r.status === 400 && /not refer to one of your buckets/.test(r.body.error.message);
  rec.add('ST-07', 'Ownership (cross-service)', 'Bob logs an expense with Alice\'s bucketId', '400 "not one of your buckets"', `${short(r)} "${r.body.error.message}"`, pass);
  assert.ok(pass);
});

test('ST-08 invalid input rejected safely', async () => {
  const cases = [
    api.post('/api/transactions', { type: 'expense', amount: -50, date: today(), bucketId: s.aliceBucket, paymentMethod: 'card' }, { token: s.alice }),
    api.post('/api/transactions', { type: 'expense', amount: 50, date: '2026-02-30', bucketId: s.aliceBucket, paymentMethod: 'card' }, { token: s.alice }),
    api.post('/api/transactions', { type: 'expense', amount: 'abc', date: today(), bucketId: s.aliceBucket, paymentMethod: 'card' }, { token: s.alice }),
    api.post('/api/buckets', { name: 'x'.repeat(41), monthlyLimit: 10 }, { token: s.alice }),
    api.post('/api/transactions', { type: 'expense', amount: 5, date: today(), bucketId: "' OR 1=1 --", paymentMethod: 'card' }, { token: s.alice }),
    api.call('POST', '/api/buckets', { token: s.alice, headers: { 'content-type': 'application/json' }, raw: '{"name": "broken' })
  ];
  const r = await Promise.all(cases);
  const actual = r.map((x) => `${x.status} ${x.body.error.message}`).join(' | ');
  const pass = r.every((x) => x.status === 400);
  rec.add('ST-08', 'Input validation', 'amount -50; date 2026-02-30; amount "abc"; 41-char name; injection-style bucketId; broken JSON', '400 ×6 with a clear message', actual, pass);
  assert.ok(pass, actual);
});

test('ST-09 mass assignment: cannot register as admin', async () => {
  const r = await api.post('/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'EvePass20266', role: 'admin' });
  const pass = r.status === 400;
  rec.add('ST-09', 'Authorization', 'Register with extra field "role":"admin"', '400 "role is not an allowed field"', `${short(r)} "${r.body.error.message}"`, pass);
  assert.ok(pass);
});

test('ST-10 brute force: lockout after 5 failures, no account enumeration', async () => {
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push((await api.post('/api/auth/login', { email: 'bob@example.com', password: `wrong-${i}-pass` })).status);
  const right = await api.post('/api/auth/login', { email: 'bob@example.com', password: 'BobPass20266' });
  const unknown = await api.post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever123' });
  const wrong = await api.post('/api/auth/login', { email: 'alice@example.com', password: 'whatever123' });
  const same = unknown.body.error.message === wrong.body.error.message;
  const actual = `${codes.join(',')}; correct password while locked ${short(right)}; unknown e-mail and wrong password give the same message: ${same}`;
  const pass = codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429 && right.status === 429 && same;
  rec.add('ST-10', 'Authentication', '6 wrong passwords for Bob, then the right one; compare unknown-email vs wrong-password errors', '401 ×5, 429, 429; same message', actual, pass);
  assert.ok(pass, actual);
});

test('ST-11 oversized body and wrong content type', async () => {
  const big = await api.post('/api/buckets', { name: 'Big', monthlyLimit: 1, pad: 'x'.repeat(50000) }, { token: s.alice });
  const text = await api.call('POST', '/api/buckets', { token: s.alice, headers: { 'content-type': 'text/plain' }, raw: 'name=Food' });
  const actual = `${short(big)}; ${short(text)}`;
  const pass = big.status === 413 && text.status === 415;
  rec.add('ST-11', 'Input validation', '50 KB JSON body; text/plain body', '413; 415', actual, pass);
  assert.ok(pass, actual);
});

test('ST-12 security headers and CORS allow-list', async () => {
  const ok = await api.get('/api/auth/health', { headers: { origin: 'http://localhost:8080' } });
  const evil = await api.get('/api/auth/health', { headers: { origin: 'https://evil.example' } });
  const h = ok.headers;
  const actual = `nosniff=${h.get('x-content-type-options')}, frame=${h.get('x-frame-options')}, x-powered-by=${h.get('x-powered-by')}; ACAO for allowed origin=${h.get('access-control-allow-origin')}, for evil origin=${evil.headers.get('access-control-allow-origin')}`;
  const pass = h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && !h.get('x-powered-by')
    && h.get('access-control-allow-origin') === 'http://localhost:8080' && !evil.headers.get('access-control-allow-origin');
  rec.add('ST-12', 'Secure configuration', 'Response headers; CORS from allowed vs unknown origin', 'nosniff, DENY, no x-powered-by; CORS only for localhost:8080', actual, pass);
  assert.ok(pass, actual);
});

test('ST-13 stored XSS / CSV injection payloads stay inert data', async () => {
  const t = await api.get(`/api/transactions/${s.aliceTxn}`, { token: s.alice });
  await api.post('/api/transactions', { type: 'expense', amount: 1, date: today(), bucketId: s.aliceBucket, paymentMethod: 'cash', note: '=HYPERLINK("http://evil","click")' }, { token: s.alice });
  const rep = await api.post('/api/insights/reports', { type: 'transactions', from: `${today().slice(0, 7)}-01`, to: today() }, { token: s.alice });
  const dl = await api.get(`/api/insights/reports/${rep.body.id}/download`, { token: s.alice });
  const csvSafe = dl.body.content.includes('"\'=HYPERLINK') && !/,=HYPERLINK/.test(dl.body.content);
  const usesInnerHtml = fs.readdirSync(path.join(root, 'frontend/js')).some((f) => /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/.test(fs.readFileSync(path.join(root, 'frontend/js', f), 'utf8')));
  const actual = `note stored as text "${t.body.note}"; CSV cell escaped=${csvSafe}; frontend uses innerHTML=${usesInnerHtml}`;
  const pass = t.body.note === '<img src=x onerror=alert(1)>' && csvSafe && !usesInnerHtml;
  rec.add('ST-13', 'Application', 'XSS payload in a note; =HYPERLINK formula in a note exported to CSV; frontend code review', 'stored as plain text; CSV cell prefixed with \'; no innerHTML in frontend', actual, pass);
  assert.ok(pass, actual);
});

test('ST-14 secret exposure review (code, config, logs)', async () => {
  const skip = new Set(['node_modules', 'evidence', 'out', '.git']);
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (skip.has(name)) continue;
      if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
    }
  })(root);
  const patterns = [/AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/, /JWT_SECRET\s*[=:]\s*['"][^'"]{8,}['"]/, /aws_secret_access_key\s*[=:\s]\s*[A-Za-z0-9/+]{40}/i];
  const hits = files.filter((f) => !f.endsWith('.test.js') && patterns.some((re) => re.test(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(root, f));
  const envFiles = files.filter((f) => path.basename(f) === '.env').map((f) => path.relative(root, f));
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const logs = ['security', 'integration'].map((n) => path.join(root, 'evidence', `${n}.log.jsonl`)).filter(fs.existsSync)
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const logLeak = /AlicePass2026|BobPass20266|Bearer eyJ|"password":"[^[]/.test(logs);
  const actual = `${files.length} files scanned; secret patterns found in: ${hits.length ? hits.join(', ') : 'none'}; .env files: ${envFiles.length ? envFiles.join(', ') : 'none'}; .gitignore has .env=${/^\.env$/m.test(ignore)}; passwords/tokens in logs=${logLeak}`;
  const pass = hits.length === 0 && envFiles.length === 0 && /^\.env$/m.test(ignore) && !logLeak;
  rec.add('ST-14', 'Secrets', 'Scan source/config for keys, DB URLs, JWT secrets; .env ignored; grep logs for passwords and tokens', 'nothing found', actual, pass);
  assert.ok(pass, actual);
});

test('ST-15 disabled account: still-valid token is blocked; role comes from the users table', async () => {
  // Phase 1 proposal, threat 6: "disabled accounts blocked with a valid token", "role re-checked in the database".
  await gw.apps.auth.locals.createUser({ name: 'Admin', email: 'admin15@example.com', password: 'AdminPass2026', role: 'admin' });
  const admin = (await api.post('/api/auth/login', { email: 'admin15@example.com', password: 'AdminPass2026' })).body.token;
  const carol = await api.post('/api/auth/register', { name: 'Carol', email: 'carol@example.com', password: 'CarolPass2026' });
  const token = carol.body.token;
  const before = await api.get('/api/buckets', { token });
  process.env.ACCOUNT_CHECK_CACHE_MS = '200'; // shorten the 60 s cache so the test does not wait a minute
  await api.patch(`/api/auth/users/${carol.body.user.id}/status`, { status: 'disabled' }, { token: admin });
  const meNow = await api.get('/api/auth/me', { token }); // Auth reads its table: blocked at once
  await new Promise((r) => setTimeout(r, 300));
  const after = await Promise.all(['/api/buckets', '/api/transactions', '/api/insights/dashboard'].map((p) => api.get(p, { token })));
  await api.patch(`/api/auth/users/${carol.body.user.id}/status`, { status: 'active' }, { token: admin });
  await new Promise((r) => setTimeout(r, 300));
  const again = await api.get('/api/buckets', { token });
  delete process.env.ACCOUNT_CHECK_CACHE_MS;
  const actual = `before ${short(before)}; after disable: auth/me ${short(meNow)}, ${after.map(short).join(', ')}; after re-enable ${short(again)}`;
  const pass = before.status === 200 && meNow.status === 403 && after.every((r) => r.status === 403) && again.status === 200;
  rec.add('ST-15', 'Authentication', 'Carol\'s token stays valid, admin disables her account, then re-enables it', '200; 403 on every service (Auth at once, others within the account-check cache, 60 s on Floci); 200 again', actual, pass);
  assert.ok(pass, actual);
});

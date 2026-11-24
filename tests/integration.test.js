// Integrated tests: end-to-end workflows across Auth, Buckets, Transactions and Insights,
// over real HTTP through the local gateway (in-memory DynamoDB stand-in, live external FX API).
const test = require('node:test');
const assert = require('node:assert');
const { startGateway, client, recorder, short, today, month } = require('./helpers');

const rec = recorder('integration');
let gw;
let api;
const s = {}; // shared state between steps

test.before(async () => {
  gw = await startGateway('integration');
  api = client(gw.base);
});
test.after(() => gw.server.close());

test('IT-01 register, login, empty dashboard; duplicate e-mail', async () => {
  const reg = await api.post('/api/auth/register', { name: 'Mona Test', email: 'mona@example.com', password: 'BudgetPass2026' });
  const login = await api.post('/api/auth/login', { email: 'mona@example.com', password: 'BudgetPass2026' });
  s.token = login.body.token;
  const dash = await api.get('/api/insights/dashboard', { token: s.token });
  const dup = await api.post('/api/auth/register', { name: 'Mona Again', email: 'MONA@example.com', password: 'BudgetPass2026' });
  const actual = `${reg.status}, ${login.status}, dashboard ${dash.status} expense=${dash.body.expense}, duplicate ${short(dup)}`;
  const pass = reg.status === 201 && login.status === 200 && dash.status === 200 && dash.body.expense === 0 && dup.status === 409;
  rec.add('IT-01', 'Auth + Insights', 'Register, log in, open empty dashboard; register same e-mail again', '201, 200, dashboard 200 expense=0, duplicate 409 EMAIL_TAKEN', actual, pass);
  assert.ok(pass, actual);
});

test('IT-02 create buckets; duplicate name; invalid limit', async () => {
  const food = await api.post('/api/buckets', { name: 'Food', monthlyLimit: 1000, alertThreshold: 80 }, { token: s.token });
  const fun = await api.post('/api/buckets', { name: 'Fun', monthlyLimit: 2000 }, { token: s.token });
  const rent = await api.post('/api/buckets', { name: 'Transport', monthlyLimit: 300, hardLimit: true }, { token: s.token });
  s.food = food.body.id; s.fun = fun.body.id; s.transport = rent.body.id;
  const dup = await api.post('/api/buckets', { name: 'food', monthlyLimit: 10 }, { token: s.token });
  const bad = await api.post('/api/buckets', { name: 'X', monthlyLimit: -5 }, { token: s.token });
  const actual = `${food.status}, ${fun.status}, ${rent.status}; dup ${short(dup)}; invalid ${short(bad)}`;
  const pass = food.status === 201 && fun.status === 201 && rent.status === 201 && dup.status === 409 && bad.status === 400;
  rec.add('IT-02', 'Buckets', 'Create Food 1000, Fun 2000, Transport 300 (hard limit); duplicate "food"; name "X" with limit -5', '201 ×3; dup 409 BUCKET_NAME_TAKEN; invalid 400', actual, pass);
  assert.ok(pass, actual);
});

test('IT-03 expense reaches 85% → NEAR_LIMIT alert; future date rejected', async () => {
  const r = await api.post('/api/transactions', { type: 'expense', amount: 850, date: today(), bucketId: s.food, paymentMethod: 'card', note: 'Groceries' }, { token: s.token });
  const alerts = await api.get('/api/buckets/alerts', { token: s.token });
  const future = await api.post('/api/transactions', { type: 'expense', amount: 5, date: '2099-01-01', bucketId: s.food, paymentMethod: 'cash' }, { token: s.token });
  const actual = `${r.status} state=${r.body.budget && r.body.budget.state} alertRaised=${r.body.alertRaised}; alerts=${alerts.body.items.map((a) => a.level).join('/')}; future ${short(future)}`;
  const pass = r.status === 201 && r.body.budget.state === 'NEAR_LIMIT' && r.body.alertRaised && alerts.body.items.length === 1 && future.status === 400;
  rec.add('IT-03', 'Transactions → Buckets', 'Log 850 EGP in Food (limit 1000, alert 80%); log an expense dated 2099', '201 NEAR_LIMIT + 1 alert; future 400', actual, pass);
  assert.ok(pass, actual);
});

test('IT-04 foreign-currency expense converted with the external API; unknown currency', async () => {
  const r = await api.post('/api/transactions', { type: 'expense', amount: 10, currency: 'USD', date: today(), bucketId: s.fun, paymentMethod: 'card', note: 'Online game' }, { token: s.token });
  const bad = await api.post('/api/transactions', { type: 'expense', amount: 10, currency: 'XYZ', date: today(), bucketId: s.fun, paymentMethod: 'card' }, { token: s.token });
  const t = r.body.transaction || {};
  const actual = `${r.status} 10 USD → ${t.amountBase} EGP at ${t.rate} (${t.rateSource}, ${t.rateDate}); XYZ ${short(bad)}`;
  const pass = r.status === 201 && t.rate > 1 && Math.abs(t.amountBase - Math.round(10 * t.rate * 100) / 100) < 0.01 && bad.status === 400;
  rec.add('IT-04', 'Transactions + external API', 'Log 10 USD in Fun; then currency "XYZ"', '201 with amountBase = 10 × live rate; XYZ 400', actual, pass);
  assert.ok(pass, actual);
});

test('IT-05 hard-limit bucket blocks overspend', async () => {
  const ok = await api.post('/api/transactions', { type: 'expense', amount: 250, date: today(), bucketId: s.transport, paymentMethod: 'mobile_wallet' }, { token: s.token });
  const blocked = await api.post('/api/transactions', { type: 'expense', amount: 100, date: today(), bucketId: s.transport, paymentMethod: 'cash' }, { token: s.token });
  const list = await api.get('/api/transactions', { token: s.token });
  const count = list.body.items.filter((t) => t.bucketId === s.transport).length;
  const actual = `${ok.status}; then ${short(blocked)}; transactions in bucket = ${count}`;
  const pass = ok.status === 201 && blocked.status === 422 && blocked.body.error.code === 'BUDGET_HARD_LIMIT' && count === 1;
  rec.add('IT-05', 'Transactions → Buckets', 'Transport (hard limit 300): 250 then 100', '201; 422 BUDGET_HARD_LIMIT, nothing saved', actual, pass);
  assert.ok(pass, actual);
});

test('IT-06 budget transfer; too large transfer', async () => {
  const before = await api.get(`/api/buckets/${s.fun}`, { token: s.token });
  const tr = await api.post('/api/buckets/transfers', { fromBucketId: s.fun, toBucketId: s.food, amount: 200, month: month() }, { token: s.token });
  const food = await api.get(`/api/buckets/${s.food}`, { token: s.token });
  const tooBig = await api.post('/api/buckets/transfers', { fromBucketId: s.fun, toBucketId: s.food, amount: 100000, month: month() }, { token: s.token });
  const actual = `${tr.status}; Food effectiveLimit=${food.body.budget.effectiveLimit} state=${food.body.budget.state}; Fun had ${before.body.budget.remaining} left; 100000 → ${short(tooBig)}`;
  const pass = tr.status === 201 && food.body.budget.effectiveLimit === 1200 && tooBig.status === 422 && tooBig.body.error.code === 'INSUFFICIENT_BUDGET';
  rec.add('IT-06', 'Buckets', 'Move 200 from Fun to Food; then move 100000', '201, Food limit 1200; 422 INSUFFICIENT_BUDGET', actual, pass);
  assert.ok(pass, actual);
});

test('IT-07 delete bucket with transactions → 409; archive; expense into archived bucket', async () => {
  const del = await api.del(`/api/buckets/${s.fun}`, { token: s.token });
  const arch = await api.post(`/api/buckets/${s.fun}/archive`, undefined, { token: s.token });
  const exp = await api.post('/api/transactions', { type: 'expense', amount: 5, date: today(), bucketId: s.fun, paymentMethod: 'cash' }, { token: s.token });
  const empty = await api.post('/api/buckets', { name: 'Gifts', monthlyLimit: 100 }, { token: s.token });
  const delEmpty = await api.del(`/api/buckets/${empty.body.id}`, { token: s.token });
  const actual = `${short(del)}; archive ${arch.status} status=${arch.body.status}; expense ${short(exp)}; empty bucket delete ${delEmpty.status}`;
  const pass = del.status === 409 && arch.status === 200 && exp.status === 409 && delEmpty.status === 204;
  rec.add('IT-07', 'Buckets ↔ Transactions', 'Delete Fun (has transactions), archive it, log expense into it; delete an empty bucket', '409 BUCKET_HAS_TRANSACTIONS; 200 archived; 409 BUCKET_ARCHIVED; 204', actual, pass);
  assert.ok(pass, actual);
});

test('IT-08 edit transaction re-checks the budget; date change refused', async () => {
  const list = await api.get('/api/transactions', { token: s.token, });
  const groceries = list.body.items.find((t) => t.note === 'Groceries');
  const edit = await api.patch(`/api/transactions/${groceries.id}`, { amount: 1300 }, { token: s.token });
  const dateEdit = await api.patch(`/api/transactions/${groceries.id}`, { date: '2026-01-01' }, { token: s.token });
  const actual = `${edit.status} amount=${edit.body.transaction && edit.body.transaction.amount} state=${edit.body.budget && edit.body.budget.state}; date change ${short(dateEdit)}`;
  const pass = edit.status === 200 && edit.body.budget.state === 'OVER_LIMIT' && dateEdit.status === 400;
  rec.add('IT-08', 'Transactions → Buckets', 'Change Groceries 850 → 1300 (Food limit 1200); try to change the date', '200 OVER_LIMIT; 400', actual, pass);
  assert.ok(pass, actual);
});

test('IT-09 filters, income, dashboard and trends agree', async () => {
  await api.post('/api/transactions', { type: 'income', amount: 15000, date: today(), paymentMethod: 'bank_transfer', note: 'Salary' }, { token: s.token });
  const card = await api.get('/api/transactions?paymentMethod=card', { token: s.token });
  const all = await api.get('/api/transactions', { token: s.token });
  const dash = await api.get(`/api/insights/dashboard?month=${month()}`, { token: s.token });
  const trends = await api.get('/api/insights/trends?months=6', { token: s.token });
  const badMonth = await api.get('/api/insights/dashboard?month=2026-13', { token: s.token });
  const actual = `card=${card.body.items.length}; list expense=${all.body.totals.expense} income=${all.body.totals.income}; dashboard expense=${dash.body.expense} savingsRate=${dash.body.savingsRate}%; trends months=${trends.body.series.length}; month 2026-13 → ${short(badMonth)}`;
  const pass = card.body.items.every((t) => t.paymentMethod === 'card') && dash.body.expense === all.body.totals.expense
    && dash.body.income === 15000 && trends.body.series.length === 6 && badMonth.status === 400;
  rec.add('IT-09', 'Transactions + Insights', 'Add income 15000; filter by card; compare dashboard to list; 6-month trends; invalid month', 'filter only card; totals equal; 6 months; 400', actual, pass);
  assert.ok(pass, actual);
});

test('IT-10 CSV report generate, download, delete', async () => {
  const from = `${month()}-01`;
  const gen = await api.post('/api/insights/reports', { type: 'transactions', from, to: today() }, { token: s.token });
  const budgetRep = await api.post('/api/insights/reports', { type: 'budget', month: month() }, { token: s.token });
  const dl = await api.get(`/api/insights/reports/${gen.body.id}/download`, { token: s.token });
  const del = await api.del(`/api/insights/reports/${gen.body.id}`, { token: s.token });
  const list = await api.get('/api/insights/reports', { token: s.token });
  const firstLine = typeof dl.body.content === 'string' ? dl.body.content.split('\r\n')[0] : '';
  const actual = `${gen.status} rows=${gen.body.rows}; budget report ${budgetRep.status} rows=${budgetRep.body.rows}; download ${dl.status} header "${firstLine}"; delete ${del.status}; remaining ${list.body.count}`;
  const pass = gen.status === 201 && budgetRep.status === 201 && dl.status === 200 && firstLine.startsWith('date,type,amount') && del.status === 204 && list.body.count === 1;
  rec.add('IT-10', 'Insights → Transactions/Buckets', 'Generate transactions + budget CSV, download, delete one', '201, 201, 200 CSV, 204, 1 left', actual, pass);
  assert.ok(pass, actual);
});

test('IT-11 external API failure handled safely', async () => {
  const fx = require('../services/transactions-service/lib/fx.js');
  const saved = process.env.FX_API_URL;
  process.env.FX_API_URL = 'http://127.0.0.1:9/v6/latest';
  fx.clearFxCache(); // same module instance the service uses, so no cached rate hides the failure
  const r = await api.post('/api/transactions', { type: 'expense', amount: 3, currency: 'KWD', date: today(), bucketId: s.food, paymentMethod: 'card' }, { token: s.token });
  process.env.FX_API_URL = saved || '';
  if (!saved) delete process.env.FX_API_URL;
  const list = await api.get('/api/transactions?bucketId=' + s.food, { token: s.token });
  const saved3 = list.body.items.some((t) => t.currency === 'KWD');
  const actual = `${short(r)}; KWD transaction saved=${saved3}`;
  const pass = r.status === 503 && r.body.error.code === 'FX_UNAVAILABLE' && !saved3;
  rec.add('IT-11', 'Transactions + external API', 'FX API unreachable while logging 3 KWD', '503 FX_UNAVAILABLE, nothing saved', actual, pass);
  assert.ok(pass, actual);
});

test('IT-12 admin: overview, disable a user, user cannot log in', async () => {
  await gw.apps.auth.locals.createUser({ name: 'Admin', email: 'admin@example.com', password: 'AdminPass2026', role: 'admin' });
  const login = await api.post('/api/auth/login', { email: 'admin@example.com', password: 'AdminPass2026' });
  const admin = login.body.token;
  const overview = await api.get('/api/insights/admin/overview', { token: admin });
  const users = await api.get('/api/auth/users', { token: admin });
  const mona = users.body.items.find((u) => u.email === 'mona@example.com');
  const self = users.body.items.find((u) => u.email === 'admin@example.com');
  const dis = await api.patch(`/api/auth/users/${mona.id}/status`, { status: 'disabled' }, { token: admin });
  const blocked = await api.post('/api/auth/login', { email: 'mona@example.com', password: 'BudgetPass2026' });
  const selfDis = await api.patch(`/api/auth/users/${self.id}/status`, { status: 'disabled' }, { token: admin });
  const hasHash = JSON.stringify(users.body).includes('passwordHash');
  const actual = `overview ${overview.status} users=${overview.body.users && overview.body.users.total} txns=${overview.body.transactions && overview.body.transactions.transactions}; disable ${dis.status}; login ${short(blocked)}; self-disable ${short(selfDis)}; hashes exposed=${hasHash}`;
  const pass = overview.status === 200 && dis.status === 200 && blocked.status === 403 && selfDis.status === 409 && !hasHash;
  rec.add('IT-12', 'Auth + Insights (admin)', 'Admin overview; disable Mona; Mona logs in; admin disables self', '200; 200; 403; 409; no hashes', actual, pass);
  assert.ok(pass, actual);
});

// Unit tests of the pure business rules (no HTTP, no database).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { recorder, root } = require('./helpers');

const budget = require(path.join(root, 'services/buckets-service/lib/budget.js'));
const analytics = require(path.join(root, 'services/insights-service/lib/analytics.js'));
const { jwt, validate } = require(path.join(root, 'services/auth-service/node_modules/pb-common'));
const rec = recorder('unit');

const bucket = (over = {}) => ({ id: 'b1', name: 'Food', monthlyLimit: 1000, alertThreshold: 80, rollover: false, hardLimit: false, status: 'active', createdAt: '2026-09-15T10:00:00Z', ...over });

test('UT-01 effective limit with transfers', () => {
  const s = budget.bucketStatus(bucket(), '2026-11', { spent: 500, transfers: [{ toBucketId: 'b1', amount: 200 }, { fromBucketId: 'b1', amount: 50 }] });
  rec.add('UT-01', 'Buckets', 'effectiveLimit = 1000 + 200 in - 50 out, spent 500', '1150, OK', `${s.effectiveLimit}, ${s.state}`, s.effectiveLimit === 1150 && s.state === 'OK');
  assert.strictEqual(s.effectiveLimit, 1150);
});

test('UT-02 rollover capped at one monthly limit', () => {
  const s = budget.bucketStatus(bucket({ rollover: true }), '2026-11', { spent: 0, prevSpent: 100, prevTransfers: [{ toBucketId: 'b1', amount: 800 }] });
  rec.add('UT-02', 'Buckets', 'rollover of 1700 unused is capped at 1000', 'rolloverIn 1000', `rolloverIn ${s.rolloverIn}`, s.rolloverIn === 1000);
  assert.strictEqual(s.rolloverIn, 1000);
});

test('UT-03 no rollover in the creation month', () => {
  const s = budget.bucketStatus(bucket({ rollover: true, createdAt: '2026-11-02T00:00:00Z' }), '2026-11', { spent: 0, prevSpent: 0 });
  rec.add('UT-03', 'Buckets', 'bucket created this month gets no rollover', 'rolloverIn 0', `rolloverIn ${s.rolloverIn}`, s.rolloverIn === 0);
  assert.strictEqual(s.rolloverIn, 0);
});

test('UT-04 state thresholds', () => {
  const states = [790, 800, 1000, 1000.01].map((spent) => budget.classify(spent, 1000, 80));
  rec.add('UT-04', 'Buckets', 'states at 79%, 80%, 100%, >100%', 'OK, NEAR_LIMIT, NEAR_LIMIT, OVER_LIMIT', states.join(', '),
    states.join() === 'OK,NEAR_LIMIT,NEAR_LIMIT,OVER_LIMIT');
  assert.deepStrictEqual(states, ['OK', 'NEAR_LIMIT', 'NEAR_LIMIT', 'OVER_LIMIT']);
});

test('UT-05 hard limit projection, edit replaces old amount', () => {
  const b = bucket({ hardLimit: true });
  const s = budget.bucketStatus(b, '2026-11', { spent: 900 });
  const blocked = budget.projectSpend(b, s, 150);
  const edit = budget.projectSpend(b, s, 150, 100);
  rec.add('UT-05', 'Buckets', 'hard limit: +150 on 900/1000 blocked; editing a 100 expense to 150 allowed', 'false, true', `${blocked.allowed}, ${edit.allowed}`, !blocked.allowed && edit.allowed);
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(edit.allowed, true);
});

test('UT-06 transfer rules', () => {
  const from = bucket();
  const to = bucket({ id: 'b2', name: 'Fun' });
  const st = { remaining: 300 };
  const a = budget.checkTransfer({ from, to, fromStatus: st, amount: 400, month: '2026-11', current: '2026-11' });
  const b = budget.checkTransfer({ from, to, fromStatus: st, amount: 100, month: '2026-10', current: '2026-11' });
  const c = budget.checkTransfer({ from, to: from, fromStatus: st, amount: 100, month: '2026-11', current: '2026-11' });
  const ok = budget.checkTransfer({ from, to, fromStatus: st, amount: 300, month: '2026-11', current: '2026-11' });
  const actual = [a && a.code, b && b.code, c && c.code, ok].join(', ');
  rec.add('UT-06', 'Buckets', 'too much / past month / same bucket / valid', 'INSUFFICIENT_BUDGET, PAST_MONTH, SAME_BUCKET, null', actual,
    actual === 'INSUFFICIENT_BUDGET, PAST_MONTH, SAME_BUCKET, ');
  assert.strictEqual(ok, null);
});

test('UT-07 trend and projection', () => {
  const t = analytics.trend([100, 200, 300, 400]);
  const p = analytics.projectMonthEnd(300, 10, 30);
  rec.add('UT-07', 'Insights', 'slope of 100,200,300,400; run-rate 300 in 10 of 30 days', 'rising 100; 900', `${t.direction} ${t.slope}; ${p}`, t.direction === 'rising' && t.slope === 100 && p === 900);
  assert.strictEqual(p, 900);
});

test('UT-08 CSV formula injection neutralised', () => {
  const cell = analytics.csvCell('=HYPERLINK("http://evil","x")');
  rec.add('UT-08', 'Insights', 'cell starting with = is prefixed with \' and quoted', 'starts with "\'=', cell.slice(0, 3), cell.startsWith('"\'='));
  assert.ok(cell.startsWith('"\'='));
});

test('UT-09 JWT rejects alg none, tampering and expiry', () => {
  const secret = 'k'.repeat(40);
  const good = jwt.sign({ sub: 'u1', role: 'user' }, secret);
  const [h, p] = good.split('.');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
  const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin', exp: 9999999999 })).toString('base64url')}.${good.split('.')[2]}`;
  const expired = jwt.sign({ sub: 'u1', role: 'user' }, secret, { expiresInSec: -10 });
  const r = [jwt.verify(good, secret).ok, jwt.verify(none, secret).reason, jwt.verify(tampered, secret).reason, jwt.verify(expired, secret).reason].join(', ');
  rec.add('UT-09', 'Shared auth', 'valid / alg none / role changed / expired', 'true, bad_algorithm, bad_signature, expired', r, r === 'true, bad_algorithm, bad_signature, expired');
  assert.strictEqual(r, 'true, bad_algorithm, bad_signature, expired');
});

test('UT-10 validator rejects unknown fields', () => {
  let message = '';
  try { validate({ name: 'x', role: 'admin' }, { name: { type: 'string' } }); } catch (e) { message = `${e.status} ${e.message}`; }
  rec.add('UT-10', 'Shared', 'mass assignment: extra field "role"', '400 role is not an allowed field.', message, message === '400 role is not an allowed field.');
  assert.strictEqual(message, '400 role is not an allowed field.');
});

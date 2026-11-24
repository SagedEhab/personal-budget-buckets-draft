// Lambda packaging tests: each service's lambda.handler answers an API Gateway v2 event
// (the event shape Floci/AWS API Gateway sends), and the Lambda-Invoke service-to-service path works.
// This proves the handler wiring locally; it is NOT a Floci deployment test.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { recorder, root, today } = require('./helpers');

const rec = recorder('lambda');
const svc = (name) => path.join(root, 'services', `${name}-service`);

test('LT-01 every lambda.handler answers an API Gateway v2 event', async () => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'local-test';
  const { toApiGatewayEvent } = require(path.join(svc('auth'), 'node_modules/pb-common'));
  const results = [];
  for (const name of ['auth', 'buckets', 'transactions', 'insights']) {
    const { handler } = require(path.join(svc(name), 'lambda.js'));
    const res = await handler(toApiGatewayEvent({ method: 'GET', path: `/api/${name}/health`, headers: {} }), {});
    results.push(`${name}:${res.statusCode}:${JSON.parse(res.body).runtime}`);
  }
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  const pass = results.every((r) => r.endsWith(':200:lambda'));
  rec.add('LT-01', 'Lambda packaging', 'Invoke each handler with a v2 health event', '200 runtime=lambda ×4', results.join(', '), pass);
  assert.ok(pass, results.join());
});

test('LT-02 service-to-service calls over Lambda Invoke transport', async () => {
  // Route calls to the target handler in-process instead of the AWS SDK (no Floci here)
  const handlers = {};
  for (const name of ['auth', 'buckets', 'transactions', 'insights']) handlers[`pb-${name}-api`] = require(path.join(svc(name), 'lambda.js')).handler;
  const invoked = [];
  for (const name of ['auth', 'buckets', 'transactions', 'insights']) {
    const common = require(path.join(svc(name), 'node_modules/pb-common'));
    common.setInvoker(async (fn, event) => { invoked.push(`${name}→${fn} ${event.requestContext.http.method} ${event.rawPath}`); return handlers[fn](event, {}); });
  }
  Object.assign(process.env, {
    SERVICE_TRANSPORT: 'lambda', AUTH_FUNCTION: 'pb-auth-api', BUCKETS_FUNCTION: 'pb-buckets-api',
    TRANSACTIONS_FUNCTION: 'pb-transactions-api', INSIGHTS_FUNCTION: 'pb-insights-api'
  });
  const { toApiGatewayEvent } = require(path.join(svc('auth'), 'node_modules/pb-common'));
  const call = async (fn, method, p, body, token) => {
    const res = await handlers[fn](toApiGatewayEvent({ method, path: p, body, headers: token ? { authorization: `Bearer ${token}` } : {} }), {});
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const reg = await call('pb-auth-api', 'POST', '/api/auth/register', { name: 'Lambda User', email: 'lambda@example.com', password: 'LambdaPass2026' });
  const token = reg.body.token;
  const b = await call('pb-buckets-api', 'POST', '/api/buckets', { name: 'Bills', monthlyLimit: 500 }, token);
  const t = await call('pb-transactions-api', 'POST', '/api/transactions', { type: 'expense', amount: 450, date: today(), bucketId: b.body.id, paymentMethod: 'card' }, token);
  const d = await call('pb-insights-api', 'GET', '/api/insights/dashboard', undefined, token);
  delete process.env.SERVICE_TRANSPORT;
  const actual = `register ${reg.status}, bucket ${b.status}, expense ${t.status} state=${t.body.budget && t.body.budget.state}, dashboard ${d.status} expense=${d.body.expense}; ${invoked.length} invokes: ${[...new Set(invoked.map((i) => i.split(' ')[0]))].join(', ')}`;
  const pass = t.status === 201 && t.body.budget.state === 'NEAR_LIMIT' && d.status === 200 && d.body.expense === 450 && invoked.length >= 4;
  rec.add('LT-02', 'Integration (Lambda Invoke)', 'Register → bucket → expense → dashboard with SERVICE_TRANSPORT=lambda', 'expense 201 NEAR_LIMIT; dashboard 450; cross-function invokes happen', actual, pass);
  assert.ok(pass, actual);
});

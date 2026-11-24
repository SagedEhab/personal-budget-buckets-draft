// Insights & Reports service (owner: [TEAMMATE 2]).
// Business capability: turn the user's transactions and budgets into decisions:
// a monthly dashboard, multi-month trends with projections, and downloadable CSV reports.
// It stores no financial data of its own except generated reports:
//   Table PBReports (env REPORTS_TABLE): pk USER#<uid>  sk REPORT#<id>  (metadata; CSV in S3)
// It reads data through the other services' APIs with the user's own token, so it can never
// see more than the user is allowed to see.
const crypto = require('crypto');
const express = require('express');
const {
  createStore, createAuth, validate, wrap, errors, checkId, callService, queryInt,
  parseMonth, parseDay, currentMonth, addMonths, monthRange, today, daysBetween, round2
} = require('pb-common');
const { pctChange, projectMonthEnd, trend, toCsv } = require('../lib/analytics');
const files = require('../lib/reportFiles');

const MAX_REPORTS = 10;

function createInsightRoutes(logger) {
  const store = createStore('REPORTS_TABLE');
  const { requireAuth, requireRole } = createAuth(logger);
  const router = express.Router();
  router.use(requireAuth);
  const userPk = (req) => `USER#${req.user.id}`;

  async function call(req, target, path, query) {
    const r = await callService(target, { path, query, authHeader: req.authHeader, requestId: req.requestId });
    if (r.status !== 200) {
      logger.error('DEPENDENCY_ERROR', { requestId: req.requestId, target, path, status: r.status });
      if (r.status === 401 || r.status === 403) {
        const e = errors.forbidden();
        e.status = r.status;
        throw e;
      }
      throw errors.unavailable('DEPENDENCY_ERROR', `The ${target} service is not available right now.`);
    }
    return r.body;
  }

  // ----- admin overview (aggregated, no personal financial data) -----
  router.get('/admin/overview', requireRole('admin'), wrap(async (req, res) => {
    const [users, txns, buckets, reports] = await Promise.all([
      call(req, 'auth', '/api/auth/users'),
      call(req, 'transactions', '/api/transactions/admin/stats'),
      call(req, 'buckets', '/api/buckets/admin/stats'),
      store.scan({ prefix: 'REPORT#' })
    ]);
    res.status(200).json({
      users: {
        total: users.count,
        admins: users.items.filter((u) => u.role === 'admin').length,
        disabled: users.items.filter((u) => u.status === 'disabled').length,
        activeLast30Days: txns.activeUsers30Days
      },
      transactions: txns,
      buckets,
      reports: { generated: reports.length },
      generatedAt: new Date().toISOString()
    });
  }));

  // 1. Monthly dashboard
  router.get('/dashboard', wrap(async (req, res) => {
    const month = parseMonth(req.query.month, 'month', { def: currentMonth() });
    const prev = addMonths(month, -1);
    const [summary, buckets] = await Promise.all([
      call(req, 'transactions', '/api/transactions/summary', { fromMonth: prev, toMonth: month }),
      call(req, 'buckets', '/api/buckets', { month })
    ]);
    const cur = summary.months[month];
    const before = summary.months[prev];
    const { days } = monthRange(month);
    const now = today();
    const elapsed = month < currentMonth() ? days : month > currentMonth() ? 0 : Number(now.slice(8, 10));

    let cumulative = 0;
    const daily = [];
    for (let d = 1; d <= days; d += 1) {
      const day = `${month}-${String(d).padStart(2, '0')}`;
      const spent = cur.byDay[day] || 0;
      cumulative = round2(cumulative + spent);
      daily.push({ day, spent, cumulative });
    }

    const bucketRows = buckets.items.map((b) => {
      const projected = projectMonthEnd(b.budget.spent, elapsed, days);
      return {
        id: b.id, name: b.name, color: b.color, spent: b.budget.spent, effectiveLimit: b.budget.effectiveLimit,
        percentUsed: b.budget.percentUsed, state: b.budget.state, projectedSpend: projected,
        atRisk: b.budget.state === 'OK' && projected > b.budget.effectiveLimit,
        share: cur.expense > 0 ? round2((b.budget.spent / cur.expense) * 100) : 0
      };
    }).sort((a, b) => b.spent - a.spent);

    res.status(200).json({
      month,
      baseCurrency: summary.baseCurrency,
      income: cur.income,
      expense: cur.expense,
      net: cur.net,
      savingsRate: cur.income > 0 ? round2((cur.net / cur.income) * 100) : null,
      changeVsPreviousMonth: { expense: pctChange(cur.expense, before.expense), income: pctChange(cur.income, before.income) },
      projectedMonthEndExpense: projectMonthEnd(cur.expense, elapsed, days),
      budgetHealth: {
        ok: bucketRows.filter((b) => b.state === 'OK').length,
        nearLimit: bucketRows.filter((b) => b.state === 'NEAR_LIMIT').length,
        overLimit: bucketRows.filter((b) => b.state === 'OVER_LIMIT').length,
        atRisk: bucketRows.filter((b) => b.atRisk).length
      },
      topBuckets: bucketRows.slice(0, 5),
      buckets: bucketRows,
      byPaymentMethod: cur.byPaymentMethod,
      daily
    });
  }));

  // 2. Trends over several months
  router.get('/trends', wrap(async (req, res) => {
    const months = queryInt(req.query.months, 'months', { min: 3, max: 12, def: 6 });
    const to = parseMonth(req.query.to, 'to', { def: currentMonth() });
    const from = addMonths(to, -(months - 1));
    const summary = await call(req, 'transactions', '/api/transactions/summary', { fromMonth: from, toMonth: to });
    const series = Object.entries(summary.months).map(([month, m]) => ({ month, income: m.income, expense: m.expense, net: m.net, count: m.count }));
    const withData = series.filter((s) => s.count > 0);
    const expenses = series.map((s) => s.expense);
    const avg = (arr) => (arr.length ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    res.status(200).json({
      from, to, baseCurrency: summary.baseCurrency, series,
      averageMonthlyExpense: avg(withData.map((s) => s.expense)),
      averageMonthlyIncome: avg(withData.map((s) => s.income)),
      expenseTrend: trend(expenses),
      highestExpenseMonth: withData.length ? withData.reduce((a, b) => (b.expense > a.expense ? b : a)).month : null,
      lowestExpenseMonth: withData.length ? withData.reduce((a, b) => (b.expense < a.expense ? b : a)).month : null
    });
  }));

  // 3. Generate a CSV report
  router.post('/reports', wrap(async (req, res) => {
    const input = validate(req.body, {
      type: { type: 'string', required: true, enum: ['transactions', 'budget'] },
      from: { type: 'string' },
      to: { type: 'string' },
      month: { type: 'string' }
    });
    const existing = await store.query(userPk(req), { prefix: 'REPORT#' });
    if (existing.length >= MAX_REPORTS) {
      throw errors.unprocessable('REPORT_LIMIT_REACHED', `You can keep at most ${MAX_REPORTS} reports. Delete an old one first.`);
    }

    let header;
    let rows;
    let title;
    let truncated = false;
    if (input.type === 'transactions') {
      const from = parseDay(input.from, 'from');
      const to = parseDay(input.to, 'to');
      if (from > to) throw errors.badRequest('from must not be after to.');
      if (daysBetween(from, to) > 366) throw errors.badRequest('A report can cover at most 366 days.');
      const data = await call(req, 'transactions', '/api/transactions', { from, to, limit: 500 });
      truncated = data.total > data.items.length;
      header = ['date', 'type', 'amount', 'currency', `amount_${data.baseCurrency}`, 'bucket', 'payment_method', 'note'];
      rows = data.items.map((t) => [t.date, t.type, t.amount, t.currency, t.amountBase, t.bucketName || '', t.paymentMethod, t.note]);
      title = `Transactions ${from} to ${to}`;
    } else {
      const month = parseMonth(input.month);
      const data = await call(req, 'buckets', '/api/buckets', { month, includeArchived: 'true' });
      header = ['bucket', 'status', 'monthly_limit', 'rollover_in', 'transfers_in', 'transfers_out', 'effective_limit', 'spent', 'remaining', 'percent_used', 'state'];
      rows = data.items.map((b) => [b.name, b.status, b.budget.monthlyLimit, b.budget.rolloverIn, b.budget.transfersIn,
        b.budget.transfersOut, b.budget.effectiveLimit, b.budget.spent, b.budget.remaining, b.budget.percentUsed, b.budget.state]);
      title = `Budget report ${month}`;
    }

    const csv = toCsv(header, rows);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const report = {
      pk: userPk(req), sk: `REPORT#${id}`, id, userId: req.user.id, type: input.type, title,
      rows: rows.length, truncated, sizeBytes: Buffer.byteLength(csv), createdAt: new Date().toISOString()
    };
    if (files.usesS3()) {
      report.s3Key = files.keyFor(req.user.id, id);
      await files.save(report.s3Key, csv);
    } else {
      report.content = csv;
    }
    await store.put(report);
    logger.info('REPORT_GENERATED', { requestId: req.requestId, userId: req.user.id, reportId: id, type: input.type, rows: rows.length });
    const { pk, sk, content, s3Key, ...meta } = report;
    res.status(201).json(meta);
  }));

  // 4. List own reports
  router.get('/reports', wrap(async (req, res) => {
    const items = (await store.query(userPk(req), { prefix: 'REPORT#' }))
      .map(({ pk, sk, content, s3Key, ...meta }) => meta)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.status(200).json({ items, count: items.length, max: MAX_REPORTS });
  }));

  async function loadReport(req) {
    const id = checkId(req.params.id, 'report id');
    const report = await store.get(userPk(req), `REPORT#${id}`);
    if (!report) {
      logger.warn('REPORT_NOT_FOUND_OR_NOT_OWNED', { requestId: req.requestId, userId: req.user.id, reportId: id });
      throw errors.notFound('Report');
    }
    return report;
  }

  // 5. Download
  router.get('/reports/:id/download', wrap(async (req, res) => {
    const report = await loadReport(req);
    const filename = `${report.title.replace(/[^A-Za-z0-9-]+/g, '_')}.csv`;
    logger.info('REPORT_DOWNLOADED', { requestId: req.requestId, userId: req.user.id, reportId: report.id });
    if (report.s3Key) {
      return res.status(200).json({ downloadUrl: await files.downloadUrl(report.s3Key, filename), expiresIn: files.URL_TTL_SEC });
    }
    res.status(200).json({ filename, content: report.content });
  }));

  // 6. Delete
  router.delete('/reports/:id', wrap(async (req, res) => {
    const report = await loadReport(req);
    if (report.s3Key) await files.remove(report.s3Key);
    await store.remove(report.pk, report.sk);
    logger.info('REPORT_DELETED', { requestId: req.requestId, userId: req.user.id, reportId: report.id });
    res.status(204).end();
  }));

  return router;
}

module.exports = { createInsightRoutes };

// Dashboard and Reports views (owner: [TEAMMATE 2]). Talk to /api/insights/*.
const InsightsView = {
  init() {
    const month = document.getElementById('dash-month');
    month.value = UI.thisMonth();
    month.addEventListener('change', () => this.loadDashboard());

    const form = document.getElementById('form-report');
    const today = UI.today();
    form.from.value = `${today.slice(0, 7)}-01`;
    form.to.value = today;
    form.month.value = UI.thisMonth();
    form.type.addEventListener('change', () => {
      const budget = form.type.value === 'budget';
      form.querySelector('.range').classList.toggle('hidden', budget);
      form.querySelector('.month').classList.toggle('hidden', !budget);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); this.generate(form); });
  },

  kpi(label, value, sub) {
    return UI.el('div', { class: 'kpi' }, UI.el('div', { class: 'label', text: label }), UI.el('div', { class: 'value', text: value }), sub ? UI.el('div', { class: 'sub', text: sub }) : null);
  },

  async loadDashboard() {
    const month = document.getElementById('dash-month').value || UI.thisMonth();
    try {
      const [d, t] = await Promise.all([
        Api.get('/api/insights/dashboard', { month }),
        Api.get('/api/insights/trends', { months: 6, to: month })
      ]);
      const cur = d.baseCurrency;
      const change = d.changeVsPreviousMonth.expense;
      UI.clear(document.getElementById('dash-kpis')).append(
        this.kpi('Income', UI.money(d.income, cur)),
        this.kpi('Expenses', UI.money(d.expense, cur), change === null ? 'no data last month' : `${change > 0 ? '+' : ''}${change}% vs last month`),
        this.kpi('Net', UI.money(d.net, cur), d.savingsRate === null ? '' : `savings rate ${UI.pct(d.savingsRate)}`),
        this.kpi('Projected month-end spend', UI.money(d.projectedMonthEndExpense, cur), 'at the current daily rate')
      );
      const totalBudget = d.buckets.reduce((s, b) => s + b.effectiveLimit, 0);
      Charts.line(document.getElementById('chart-daily'), d.daily.map((p) => ({ label: p.day.slice(8), value: p.cumulative })), totalBudget);
      Charts.bars(document.getElementById('chart-buckets'), d.topBuckets.map((b) => ({ label: b.name, value: b.spent, color: b.color })));

      const h = UI.clear(document.getElementById('dash-health'));
      h.append(UI.el('p', { text: `${d.budgetHealth.ok} on track · ${d.budgetHealth.nearLimit} near limit · ${d.budgetHealth.overLimit} over budget · ${d.budgetHealth.atRisk} at risk by month end` }));
      const ul = UI.el('ul', { class: 'plain' });
      for (const b of d.buckets) {
        ul.append(UI.el('li', {},
          UI.el('span', { text: b.name }),
          UI.el('span', {}, UI.el('span', { class: `badge ${b.state}`, text: b.atRisk ? 'At risk' : UI.stateLabel[b.state] }), ` ${UI.pct(b.percentUsed)} · projected ${UI.money(b.projectedSpend)}`)));
      }
      h.append(ul);

      Charts.columns(document.getElementById('chart-trend'), t.series);
      document.getElementById('trend-text').textContent = `Average monthly spend ${UI.money(t.averageMonthlyExpense, t.baseCurrency)} · spending is ${t.expenseTrend.direction}` +
        (t.highestExpenseMonth ? ` · highest month ${t.highestExpenseMonth}` : '');
    } catch (e) { UI.fail(e); }
  },

  async loadReports() {
    try {
      const data = await Api.get('/api/insights/reports');
      const list = UI.clear(document.getElementById('report-list'));
      if (!data.items.length) list.append(UI.el('li', { class: 'muted', text: 'No reports yet.' }));
      for (const r of data.items) {
        list.append(UI.el('li', {},
          UI.el('span', { text: `${r.title} · ${r.rows} rows${r.truncated ? ' (first 500)' : ''}` }),
          UI.el('span', {},
            UI.el('button', { class: 'link', text: 'Download', onclick: () => this.download(r) }),
            UI.el('button', { class: 'link danger', text: 'Delete', onclick: () => this.remove(r) }))));
      }
    } catch (e) { UI.fail(e); }
  },

  async generate(form) {
    const d = UI.formData(form);
    const body = d.type === 'budget' ? { type: 'budget', month: d.month } : { type: 'transactions', from: d.from, to: d.to };
    try { await Api.post('/api/insights/reports', body); UI.toast('Report generated.'); this.loadReports(); } catch (e) { UI.fail(e); }
  },

  async download(r) {
    try {
      const res = await Api.get(`/api/insights/reports/${r.id}/download`);
      if (res.downloadUrl) { window.location.assign(res.downloadUrl); return; } // S3 pre-signed URL
      const blob = new Blob([res.content], { type: 'text/csv' });
      const a = UI.el('a', { href: URL.createObjectURL(blob), download: res.filename });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) { UI.fail(e); }
  },

  async remove(r) {
    try { await Api.del(`/api/insights/reports/${r.id}`); this.loadReports(); } catch (e) { UI.fail(e); }
  }
};

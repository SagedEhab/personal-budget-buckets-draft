// Admin view. Shown only to admins for convenience; the BACKEND enforces the role (403 otherwise).
const AdminView = {
  init() {
    const form = document.getElementById('form-template');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = UI.formData(form);
      try {
        await Api.post('/api/buckets/templates', { name: d.name, suggestedLimit: Number(d.suggestedLimit) });
        form.reset();
        UI.toast('Template added.');
        this.load();
      } catch (err) { UI.fail(err); }
    });
  },

  async load() {
    try {
      const [o, users, templates] = await Promise.all([
        Api.get('/api/insights/admin/overview'),
        Api.get('/api/auth/users'),
        Api.get('/api/buckets/templates')
      ]);
      const k = (label, value) => UI.el('div', { class: 'kpi' }, UI.el('div', { class: 'label', text: label }), UI.el('div', { class: 'value', text: String(value) }));
      UI.clear(document.getElementById('admin-kpis')).append(
        k('Users', o.users.total), k('Active (30 days)', o.users.activeLast30Days), k('Disabled', o.users.disabled),
        k('Transactions', o.transactions.transactions), k('Buckets', o.buckets.buckets), k('Budget alerts', o.buckets.alertsRaised), k('Reports', o.reports.generated));

      const me = UI.user();
      const body = UI.clear(document.querySelector('#user-table tbody'));
      for (const u of users.items) {
        const next = u.status === 'active' ? 'disabled' : 'active';
        body.append(UI.el('tr', {},
          UI.el('td', { text: u.name }), UI.el('td', { text: u.email }), UI.el('td', { text: u.role }), UI.el('td', { text: u.status }),
          UI.el('td', {}, u.id === me.id ? '' : UI.el('button', {
            class: `link ${next === 'disabled' ? 'danger' : ''}`, text: next === 'disabled' ? 'Disable' : 'Enable',
            onclick: async () => {
              try { await Api.patch(`/api/auth/users/${u.id}/status`, { status: next }); this.load(); } catch (err) { UI.fail(err); }
            }
          }))));
      }

      const list = UI.clear(document.getElementById('template-list'));
      for (const t of templates.items) {
        list.append(UI.el('li', {}, UI.el('span', { text: `${t.name} · ${UI.money(t.suggestedLimit)}` }),
          UI.el('button', { class: 'link danger', text: 'Delete', onclick: async () => {
            try { await Api.del(`/api/buckets/templates/${t.id}`); this.load(); } catch (err) { UI.fail(err); }
          } })));
      }
    } catch (e) { UI.fail(e); }
  }
};

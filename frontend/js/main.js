// App shell: shared navigation between the three services' views.
const App = {
  view: 'dashboard',

  init() {
    AuthView.init();
    BucketsView.init();
    TransactionsView.init();
    InsightsView.init();
    AdminView.init();
    document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.view)));
    if (Api.token && UI.user()) this.enter();
  },

  enter() {
    const user = UI.user();
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('nav').classList.remove('hidden');
    document.getElementById('session').classList.remove('hidden');
    document.getElementById('who').textContent = `${user.name} (${user.role})`;
    document.querySelector('.admin-only').classList.toggle('hidden', user.role !== 'admin');
    BucketsView.load();
    this.show('dashboard');
  },

  leave() {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById('view-auth').classList.remove('hidden');
    document.getElementById('nav').classList.add('hidden');
    document.getElementById('session').classList.add('hidden');
  },

  show(view) {
    this.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'dashboard') InsightsView.loadDashboard();
    if (view === 'buckets') BucketsView.load();
    if (view === 'transactions') { TransactionsView.load(); TransactionsView.previewFx(document.getElementById('form-txn')); }
    if (view === 'reports') InsightsView.loadReports();
    if (view === 'admin') AdminView.load();
  },

  bucketsChanged(active) { TransactionsView.setBuckets(active); }
};

document.addEventListener('DOMContentLoaded', () => App.init());

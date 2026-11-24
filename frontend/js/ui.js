// UI helpers. Every piece of user data is inserted with textContent (never innerHTML),
// so a note like <script>...</script> is shown as text and cannot run (stored XSS protection).
const UI = {
  el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'style') {
        // CSSOM, not the style attribute: allowed by the page's Content-Security-Policy
        for (const decl of String(v).split(';')) {
          const i = decl.indexOf(':');
          if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
        }
      }
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  },
  clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; },
  money(n, cur) {
    const v = Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return cur ? `${v} ${cur}` : v;
  },
  pct(n) { return n === null || n === undefined ? '-' : `${Number(n).toFixed(1)}%`; },
  toast(message, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.className = `toast${isError ? ' err' : ''}`;
    clearTimeout(UI._t);
    UI._t = setTimeout(() => t.classList.add('hidden'), 4500);
  },
  fail(error) {
    const extra = error.details && error.details.length > 1 ? ` (${error.details.slice(1).join(' ')})` : '';
    UI.toast(`${error.message}${extra}`, true);
  },
  formData(form) {
    const data = {};
    for (const [k, v] of new FormData(form).entries()) data[k] = typeof v === 'string' ? v.trim() : v;
    return data;
  },
  thisMonth() { return new Date().toISOString().slice(0, 7); },
  today() { return new Date().toISOString().slice(0, 10); },
  stateLabel: { OK: 'On track', NEAR_LIMIT: 'Near limit', OVER_LIMIT: 'Over budget' },
  user() {
    try { return JSON.parse(sessionStorage.getItem('pb_user')); } catch { return null; }
  }
};

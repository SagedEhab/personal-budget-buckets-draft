// One place that talks to the backend. Adds the Bearer token, sends JSON, and turns
// error responses into ApiError so every screen shows the server's own message.
// The token is kept in sessionStorage (cleared when the tab closes) and never in localStorage.
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const Api = {
  get token() { return sessionStorage.getItem('pb_token'); },
  set token(value) { if (value) sessionStorage.setItem('pb_token', value); else sessionStorage.removeItem('pb_token'); },

  async request(method, path, body, query) {
    const url = new URL(API_ROOT + path);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (data && data.error) || {};
      if (res.status === 401 && this.token) { this.token = null; window.dispatchEvent(new Event('pb:logout')); }
      throw new ApiError(res.status, e.code || 'ERROR', e.message || `Request failed (${res.status}).`, e.details);
    }
    return data;
  },
  get(path, query) { return this.request('GET', path, undefined, query); },
  post(path, body) { return this.request('POST', path, body || {}); },
  patch(path, body) { return this.request('PATCH', path, body); },
  del(path) { return this.request('DELETE', path); }
};

// Login / registration screen (shared team component).
const AuthView = {
  init() {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const err = document.getElementById('auth-error');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    const showTab = (login) => {
      tabLogin.classList.toggle('active', login);
      tabRegister.classList.toggle('active', !login);
      loginForm.classList.toggle('hidden', !login);
      registerForm.classList.toggle('hidden', login);
      err.textContent = '';
    };
    tabLogin.addEventListener('click', () => showTab(true));
    tabRegister.addEventListener('click', () => showTab(false));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const data = UI.formData(loginForm);
      if (!data.email || !data.password) { err.textContent = 'Enter your e-mail and password.'; return; }
      try {
        const res = await Api.post('/api/auth/login', { email: data.email, password: data.password });
        AuthView.start(res);
        loginForm.reset();
      } catch (error) { err.textContent = error.message; }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const data = UI.formData(registerForm);
      if (!/^(?=.*[A-Za-z])(?=.*\d).{10,}$/.test(data.password || '')) {
        err.textContent = 'Password must be at least 10 characters with a letter and a digit.';
        return;
      }
      try {
        const res = await Api.post('/api/auth/register', data);
        AuthView.start(res);
        registerForm.reset();
        UI.toast('Account created. Start by adding a bucket.');
      } catch (error) { err.textContent = error.message; }
    });

    document.getElementById('logout').addEventListener('click', () => AuthView.logout());
    window.addEventListener('pb:logout', () => AuthView.logout('Your session ended. Please log in again.'));

    Api.get('/api/auth/health')
      .then((h) => { document.getElementById('api-status').textContent = `API online (${h.runtime}).`; })
      .catch(() => { document.getElementById('api-status').textContent = 'API not reachable.'; });
  },

  start({ token, user }) {
    Api.token = token;
    sessionStorage.setItem('pb_user', JSON.stringify(user));
    App.enter();
  },

  logout(message) {
    Api.token = null;
    sessionStorage.removeItem('pb_user');
    App.leave();
    if (message) UI.toast(message, true);
  }
};

(function (window) {
  'use strict';

  var TOKEN_KEY = 'huiyi_console_token';

  async function verifyLogin(user, pass) {
    try {
      var resp = await fetch('/console/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (resp.ok && data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        return { ok: true };
      }
      return { ok: false, error: data.error || '登录失败' };
    } catch (error) {
      return { ok: false, error: error.message || '网络错误' };
    }
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function initLogin() {
    var loginForm = document.getElementById('loginForm');
    var loginError = document.getElementById('loginError');
    var loginUser = document.getElementById('loginUser');
    var loginPass = document.getElementById('loginPass');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (loginError) loginError.style.display = 'none';
      var user = loginUser ? loginUser.value.trim() : '';
      var pass = loginPass ? loginPass.value : '';

      var result = await verifyLogin(user, pass);
      if (result.ok) {
        localStorage.setItem(window.HuiyiConfig.LOGIN_KEY, 'ok');
        window.HuiyiApp.showApp();
        window.HuiyiApp.startApp();
      } else if (loginError) {
        loginError.textContent = result.error || '账号或密码错误';
        loginError.style.display = 'block';
      }
    });

    if (localStorage.getItem(window.HuiyiConfig.LOGIN_KEY) === 'ok') {
      window.HuiyiApp.showApp();
      window.HuiyiApp.startApp();
    }
  }

  window.HuiyiLogin = {
    getToken: getToken,
    TOKEN_KEY: TOKEN_KEY,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogin);
  } else {
    initLogin();
  }
})(window);

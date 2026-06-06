// 视频会议管理后台 - 登录模块
(function(window) {
	'use strict';

	// Token 存储 key
	var TOKEN_KEY = 'huiyi_console_token';

	// 调用后端登录接口
	async function verifyLogin(user, pass) {
		try {
			const resp = await fetch('/console/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: user, password: pass }),
			});
			const data = await resp.json();
			if (resp.ok && data.token) {
				localStorage.setItem(TOKEN_KEY, data.token);
				return { ok: true };
			}
			return { ok: false, error: data.error || '登录失败' };
		} catch (e) {
			return { ok: false, error: e.message || '网络错误' };
		}
	}

	// 获取存储的 token
	function getToken() {
		return localStorage.getItem(TOKEN_KEY) || '';
	}

	function initLogin() {
		var loginForm = document.getElementById('loginForm');
		var loginError = document.getElementById('loginError');
		var loginUser = document.getElementById('loginUser');
		var loginPass = document.getElementById('loginPass');

		loginForm.addEventListener('submit', async function(e) {
			e.preventDefault();
			loginError.style.display = 'none';
			var user = loginUser.value.trim();
			var pass = loginPass.value;
			
			const result = await verifyLogin(user, pass);
			if (result.ok) {
				localStorage.setItem(window.HuiyiConfig.LOGIN_KEY, 'ok');
				window.HuiyiApp.showApp();
				window.HuiyiApp.startApp();
			} else {
				loginError.textContent = result.error || '账号或密码错误';
				loginError.style.display = 'block';
			}
		});

		// 如果已登录过，直接进后台
		if (localStorage.getItem(window.HuiyiConfig.LOGIN_KEY) === 'ok') {
			window.HuiyiApp.showApp();
			window.HuiyiApp.startApp();
		}
	}

	// 导出 getToken 方法供其他模块使用
	window.HuiyiLogin = {
		getToken: getToken,
		TOKEN_KEY: TOKEN_KEY,
	};

	// 页面加载完成后初始化
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initLogin);
	} else {
		initLogin();
	}
})(window);

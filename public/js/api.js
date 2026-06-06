// 视频会议管理后台 - API 模块
(function(window) {
	'use strict';

	function withProtocol(value) {
		if (!value || /^https?:\/\//i.test(value)) return value;
		if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return 'http://' + value;
		return 'https://' + value;
	}

	function normalizeBase(value) {
		return withProtocol(String(value || '').trim()).replace(/\/$/, '');
	}

	function apiUrl(base, path) {
		if (!base) throw new Error('接口地址未配置');
		// 所有 API 请求添加 /api 前缀
		var apiPath = path.startsWith('/api/') ? path : '/api' + path;
		return base + apiPath;
	}

	async function request(base, secret, path, options) {
		options = options || {};
		var headers = new Headers(options.headers || {});
		if (!headers.has('Content-Type') && options.body) {
			headers.set('Content-Type', 'application/json');
		}
		if (secret) {
			headers.set('X-API-Secret', secret);
		}

		var controller = new AbortController();
		var timeoutId = setTimeout(function() { controller.abort(); }, 15000);

		var response;
		try {
			response = await fetch(apiUrl(base, path), {
				method: options.method || 'GET',
				headers: headers,
				body: options.body,
				signal: controller.signal
			});
		} catch (err) {
			clearTimeout(timeoutId);
			if (err.name === 'AbortError') {
				throw new Error('请求超时，服务可能繁忙');
			}
			throw err;
		}
		clearTimeout(timeoutId);

		var text = await response.text();
		var payload = {};
		try {
			payload = text ? JSON.parse(text) : {};
		} catch (e) {
			payload = { raw: text };
		}

		if (!response.ok) {
			throw new Error(payload.error || payload.detail || response.status + ' ' + response.statusText);
		}

		return payload;
	}

	async function changePassword(token, oldPassword, newPassword) {
		var headers = new Headers();
		headers.set('Content-Type', 'application/json');
		headers.set('Authorization', 'Bearer ' + token);

		var controller = new AbortController();
		var timeoutId = setTimeout(function() { controller.abort(); }, 15000);

		var response;
		try {
			response = await fetch('/console/auth/change-password', {
				method: 'POST',
				headers: headers,
				body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword }),
				signal: controller.signal
			});
		} catch (err) {
			clearTimeout(timeoutId);
			if (err.name === 'AbortError') {
				throw new Error('请求超时');
			}
			throw err;
		}
		clearTimeout(timeoutId);

		var payload = {};
		try {
			payload = await response.json();
		} catch (e) {}

		if (!response.ok) {
			throw new Error(payload.error || '修改密码失败');
		}

		return payload;
	}

	window.HuiyiApi = {
		normalizeBase: normalizeBase,
		request: request,
		changePassword: changePassword
	};
})(window);

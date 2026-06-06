(function (window) {
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
    if (!base) throw new Error('API 地址未配置');
    var apiPath = path.startsWith('/api/') ? path : '/api' + path;
    return base + apiPath;
  }

  async function request(base, secret, path, options) {
    options = options || {};
    var headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (secret) headers.set('X-API-Secret', secret);

    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 15000);
    var response;
    try {
      response = await fetch(apiUrl(base, path), {
        method: options.method || 'GET',
        headers: headers,
        body: options.body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('请求超时');
      throw error;
    }
    clearTimeout(timeoutId);

    var text = await response.text();
    var payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(payload.error || payload.detail || response.status + ' ' + response.statusText);
    }
    return payload;
  }

  window.HuiyiApi = {
    normalizeBase: normalizeBase,
    request: request,
  };
})(window);

(function (window) {
  'use strict';

  var state = {
    db: { stats: null, codes: [], connected: false },
    api: { base: '', mainUrl: '', currentUrl: '', backups: [], apiSecret: '', connected: false, statuses: {} },
  };

  function token() {
    return window.HuiyiLogin ? window.HuiyiLogin.getToken() : '';
  }

  function authedFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + token() }, opts.headers || {});
    return fetch(url, opts);
  }

  async function authedJson(url, opts) {
    var resp = await authedFetch(url, opts);
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
    return data;
  }

  function toast(message, type) {
    var stack = document.getElementById('toastStack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function updateSidebarStatus(type, status) {
    var dot = document.getElementById(type + 'StatusDot');
    var text = document.getElementById(type + 'StatusText');
    if (!dot || !text) return;
    dot.className = 'status-dot';
    if (status === 'connected') {
      dot.classList.add('connected');
      text.textContent = type === 'db' ? '数据库已连接' : 'API 已连接';
    } else if (status === 'error') {
      dot.classList.add('error');
      text.textContent = type === 'db' ? '数据库未连接' : 'API 未连接';
    } else if (status === 'loading') {
      text.textContent = type === 'db' ? '正在加载数据库...' : '正在检测 API...';
    } else {
      text.textContent = type === 'db' ? '数据库未连接' : 'API 未配置';
    }
  }

  function formatCountdown(expiresAt) {
    if (!expiresAt) return '-';
    var diff = new Date(expiresAt).getTime() - Date.now();
    if (isNaN(diff) || diff <= 0) return 'Expired';
    var seconds = Math.floor(diff / 1000);
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var rest = seconds % 60;
    var parts = [];
    if (days) parts.push(days + 'd');
    if (hours || days) parts.push(hours + 'h');
    parts.push(minutes + 'm');
    parts.push(rest + 's');
    return parts.join(' ');
  }

  function updateCountdowns() {
    document.querySelectorAll('[data-expires-at]').forEach(function (el) {
      el.textContent = formatCountdown(el.dataset.expiresAt || '');
    });
  }

  function getAssigneeName(row) {
    var parts = [row.assigned_name, row.assigned_to].filter(function (value) {
      return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
    });
    return parts.length ? parts.join(' / ') : '未分配';
  }

  async function loadStats() {
    state.db.stats = await authedJson('/console/codes/stats');
  }

  async function loadCodes() {
    var data = await authedJson('/console/codes');
    state.db.codes = data.codes || [];
  }

  async function loadDatabaseData() {
    updateSidebarStatus('db', 'loading');
    try {
      await Promise.all([loadStats(), loadCodes()]);
      state.db.connected = true;
      updateSidebarStatus('db', 'connected');
    } catch (error) {
      state.db.connected = false;
      updateSidebarStatus('db', 'error');
      console.warn('Database load failed', error);
    }
  }

  async function loadApiConfig() {
    try {
      var data = await authedJson('/console/api-urls');
      state.api.currentUrl = data.currentUrl || '';
      state.api.mainUrl = data.mainUrl || '';
      state.api.base = data.currentUrl || data.mainUrl || '';
      state.api.backups = data.backups || [];
      state.api.apiSecret = data.apiSecret || '';
      renderApiConfig();
      if (state.api.base) await checkApiConnection(false);
      else updateApiStatus(false, 'API 未配置');
    } catch (error) {
      updateApiStatus(false, 'API 配置加载失败');
      console.warn('API config load failed', error);
    }
  }

  function normalizeApiBase(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (window.HuiyiApi && window.HuiyiApi.normalizeBase) return window.HuiyiApi.normalizeBase(raw);
    if (!/^https?:\/\//i.test(raw)) {
      raw = /^(localhost|127\.0\.0\.1)/i.test(raw) ? 'http://' + raw : 'https://' + raw;
    }
    return raw.replace(/\/$/, '');
  }

  function updateApiStatus(ok, text) {
    state.api.connected = !!ok;
    [document.getElementById('apiStatusDot'), document.getElementById('currentStatusDot')].forEach(function (dot) {
      if (!dot) return;
      dot.className = 'status-dot';
      if (ok) dot.classList.add('connected');
      else if (state.api.base) dot.classList.add('error');
    });
    setText('apiStatusText', text || (ok ? 'API 已连接' : 'API 未配置'));
    setText('connectionStatusText', text || (ok ? '已连接' : '未配置'));
  }

  function renderApiConfig() {
    var input = document.querySelector('#apiConfigForm input[name="base"]');
    if (input) input.value = state.api.base || '';
    var grid = document.getElementById('apiUrlsGrid');
    if (!grid) return;
    var items = [];
    if (state.api.base) {
      items.push({
        role: '主接口',
        url: state.api.base,
        key: '',
        status: state.api.statuses[state.api.base] || '',
      });
    }
    (state.api.backups || []).forEach(function (backup, index) {
      items.push({
        role: backup.label || ('备用接口 ' + (index + 1)),
        url: backup.url,
        key: backup.key,
        status: state.api.statuses[backup.url] || '',
      });
    });

    grid.innerHTML = items.length ? items.map(function (item) {
      var statusText = item.status === 'ok' ? '正常' : item.status === 'error' ? '失败' : '未检测';
      var statusClass = item.status === 'ok' ? 'connected' : item.status === 'error' ? 'error' : '';
      var actions = '<button class="btn-inline" data-action="check-api" data-url="' + escapeHtml(item.url) + '">检测</button>';
      if (item.key) {
        actions = '<button class="btn-inline" data-action="use-api" data-url="' + escapeHtml(item.url) + '">设为主接口</button>' + actions +
          '<button class="btn-inline btn-danger" data-action="delete-api" data-key="' + escapeHtml(item.key) + '">删除</button>';
      }
      return '<div class="saved-item">' +
        '<div class="saved-label">' + escapeHtml(item.role) + '</div>' +
        '<div class="saved-value">' + escapeHtml(item.url) + '</div>' +
        '<div class="row-actions"><span class="status-dot ' + statusClass + '"></span><span>' + statusText + '</span>' + actions + '</div>' +
        '</div>';
    }).join('') : '<div class="empty">API 地址未配置</div>';
  }

  function applyApiConfig(data) {
    state.api.currentUrl = data.currentUrl || '';
    state.api.mainUrl = data.mainUrl || '';
    state.api.base = data.currentUrl || data.mainUrl || '';
    state.api.backups = data.backups || [];
    state.api.apiSecret = data.apiSecret || state.api.apiSecret || '';
    renderApiConfig();
  }

  async function saveApiConfig(form) {
    var data = new FormData(form);
    var base = normalizeApiBase(data.get('base'));
    await setMainApi(base);
  }

  async function setMainApi(base) {
    if (!base) throw new Error('请输入 API 地址');
    var result = await authedJson('/console/api-urls/main', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: base }),
    });
    applyApiConfig(result);
    toast('API 主接口已保存', 'ok');
    await checkApiConnection(true);
  }

  async function addBackupApi(form) {
    var data = new FormData(form);
    var url = normalizeApiBase(data.get('backup'));
    if (!url) throw new Error('请输入备用 API 地址');
    var result = await authedJson('/console/api-urls/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url }),
    });
    applyApiConfig(result);
    form.reset();
    toast('备用接口已添加', 'ok');
  }

  async function deleteBackupApi(key) {
    if (!key) return;
    var result = await authedJson('/console/api-urls/backups/' + encodeURIComponent(key), { method: 'DELETE' });
    applyApiConfig(result);
    toast('备用接口已删除', 'ok');
  }

  async function checkApiConnection(showToast, targetUrl) {
    var target = normalizeApiBase(targetUrl || state.api.base);
    if (!target) {
      updateApiStatus(false, 'API 未配置');
      if (showToast) toast('API 地址未配置', 'error');
      return false;
    }
    updateSidebarStatus('api', 'loading');
    var timer;
    try {
      var controller = new AbortController();
      timer = setTimeout(function () { controller.abort(); }, 10000);
      if (window.HuiyiApi && window.HuiyiApi.request) {
        await window.HuiyiApi.request(target, state.api.apiSecret, '/health', { signal: controller.signal });
      } else {
        var resp = await fetch(target + '/api/health', {
          signal: controller.signal,
          headers: { 'X-API-Secret': state.api.apiSecret || '' },
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
      }
      state.api.statuses[target] = 'ok';
      renderApiConfig();
      updateApiStatus(true, 'API 已连接');
      if (showToast) toast('API 连接正常', 'ok');
      return true;
    } catch (error) {
      state.api.statuses[target] = 'error';
      renderApiConfig();
      updateApiStatus(false, 'API 未连接');
      if (showToast) toast('API 检测失败: ' + error.message, 'error');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function checkAllApiUrls() {
    var urls = [state.api.base].concat((state.api.backups || []).map(function (item) { return item.url; })).filter(Boolean);
    if (!urls.length) {
      toast('API 地址未配置', 'error');
      return;
    }
    for (var index = 0; index < urls.length; index += 1) {
      await checkApiConnection(false, urls[index]);
    }
    toast('接口检测完成', 'ok');
  }

  function renderState() {
    var stats = state.db.stats || {};
    setText('totalCount', stats.total != null ? stats.total : '-');
    setText('assignedCount', stats.assigned != null ? stats.assigned : '-');
    setText('inUseCount', stats.in_use != null ? stats.in_use : '-');
    setText('expiredCount', stats.expired != null ? stats.expired : '-');
    renderCodes();
  }

  function renderCodes() {
    var tbody = document.getElementById('codesTable');
    if (!tbody) return;
    var rows = state.db.codes || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
      return;
    }
    var groups = {};
    rows.forEach(function (row) {
      var name = getAssigneeName(row);
      (groups[name] = groups[name] || []).push(row);
    });
    tbody.innerHTML = Object.entries(groups).map(function (entry) {
      var name = entry[0];
      var list = entry[1];
      var used = list.filter(function (code) { return code.status === 'in_use' || code.in_use; }).length;
      var expired = list.filter(function (code) { return code.status === 'expired'; }).length;
      var available = list.length - used - expired;
      var encoded = encodeURIComponent(name);
      return '<tr><td>' + escapeHtml(name) + '</td><td>' + list.length + '</td><td>' + used + '</td><td>' + available + '</td><td>' + expired + '</td>' +
        '<td><div class="row-actions"><button class="btn-inline btn-danger" data-action="delete-assignee" data-assignee="' + encoded + '">删除分组</button><button class="btn-inline" data-action="show-detail" data-assignee="' + encoded + '">详情</button></div></td></tr>';
    }).join('');
  }

  function showAssigneeDetail(name) {
    var codes = (state.db.codes || []).filter(function (row) { return getAssigneeName(row) === name; });
    setText('detailModalTitle', name + ' 的授权码');
    var tbody = document.getElementById('detailTable');
    if (!tbody) return;
    tbody.innerHTML = codes.map(function (row) {
      var code = row.code || '-';
      var status = row.status || (row.in_use ? 'in_use' : 'available');
      var tone = status === 'expired' || status === 'in_use' ? 'danger' : 'ok';
      var room = row.bound_room || row.room_name || '-';
      var actions = [];
      if (status !== 'expired' && room !== '-') {
        actions.push('<button class="btn-inline" data-action="release-code" data-code="' + escapeHtml(code) + '">释放</button>');
      }
      actions.push('<button class="btn-inline btn-danger" data-action="delete-code" data-code="' + escapeHtml(code) + '">删除</button>');
      return '<tr>' +
        '<td><code>' + escapeHtml(code) + '</code></td>' +
        '<td><span class="status-dot ' + tone + '"></span></td>' +
        '<td>' + escapeHtml(room) + '</td>' +
        '<td>' + (row.expires_at ? new Date(row.expires_at).toLocaleString() : '-') +
        '<div class="countdown" data-expires-at="' + (row.expires_at || '') + '">' + formatCountdown(row.expires_at || '') + '</div></td>' +
        '<td><div class="row-actions">' + actions.join('') + '</div></td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>';
    updateCountdowns();
    var modal = document.getElementById('detailModal');
    if (modal) modal.classList.remove('is-hidden');
  }

  async function createCodes(form) {
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.assigned || !String(data.assigned).trim()) throw new Error('请输入分配对象');
    data.count = Number(data.count);
    data.expire_minutes = Number(data.expire_minutes);
    var assigned = String(data.assigned).trim();
    delete data.assigned;
    if (/^\d+$/.test(assigned)) data.assigned_to = Number(assigned);
    else data.assigned_name = assigned;
    var result = await authedJson('/console/codes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    toast('已创建 ' + (result.created || 0) + ' 个授权码', 'ok');
    await reloadData();
  }

  async function releaseCode(code) {
    await authedJson('/console/codes/' + encodeURIComponent(code) + '/release', { method: 'POST' });
    toast('已释放授权码 ' + code, 'ok');
    await reloadData();
  }

  async function deleteCode(code) {
    var result = await authedJson('/console/codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: [code] }),
    });
    toast(result.ok ? '已删除授权码 ' + code : '删除失败', result.ok ? 'ok' : 'error');
    await reloadData();
  }

  async function deleteAssigneeCodes(name) {
    if (!confirm('确定删除 "' + name + '" 的全部授权码？')) return;
    var codes = (state.db.codes || [])
      .filter(function (row) { return getAssigneeName(row) === name; })
      .map(function (row) { return row.code; });
    if (!codes.length) {
      toast('没有可删除的授权码', 'info');
      return;
    }
    var result = await authedJson('/console/codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: codes }),
    });
    toast('已删除 ' + (result.deleted || 0) + ' 个授权码', result.ok ? 'ok' : 'error');
    await reloadData();
    var modal = document.getElementById('detailModal');
    if (modal) modal.classList.add('is-hidden');
  }

  async function cleanup() {
    var result = await authedJson('/console/cleanup', { method: 'POST' });
    toast('已清理 ' + (result.expired_sessions || 0) + ' 个过期会话', 'ok');
    await reloadData();
  }

  async function reloadData() {
    await loadDatabaseData();
    renderState();
  }

  function bindIfPresent(id, eventName, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(eventName, handler);
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var page = this.dataset.page;
        localStorage.setItem('admin_current_page', page);
        document.querySelectorAll('.nav-item').forEach(function (nav) { nav.classList.remove('active'); });
        document.querySelectorAll('.page-content').forEach(function (content) { content.classList.remove('active'); });
        this.classList.add('active');
        var pageEl = document.getElementById('page-' + page);
        if (pageEl) pageEl.classList.add('active');
        if (page === 'chat') refreshChat().catch(function () {});
      });
    });

    bindIfPresent('createForm', 'submit', async function (event) {
      event.preventDefault();
      try { await createCodes(this); }
      catch (error) { toast(error.message, 'error'); }
    });
    bindIfPresent('refreshAllBtn', 'click', async function () { await reloadData(); toast('数据已刷新', 'ok'); });
    bindIfPresent('refreshInlineBtn', 'click', reloadData);
    bindIfPresent('cleanupBtn', 'click', cleanup);
    bindIfPresent('chatRefreshBtn', 'click', refreshChat);
    bindIfPresent('checkAllUrlsBtn', 'click', checkAllApiUrls);
    bindIfPresent('apiConfigForm', 'submit', async function (event) {
      event.preventDefault();
      try { await saveApiConfig(this); }
      catch (error) { toast(error.message, 'error'); }
    });
    bindIfPresent('apiBackupForm', 'submit', async function (event) {
      event.preventDefault();
      try { await addBackupApi(this); }
      catch (error) { toast(error.message, 'error'); }
    });
    bindIfPresent('chatRoomSelect', 'change', async function () {
      try {
        var data = await loadChatMessages(this.value, 500, 0);
        renderChatMessages(data.messages || [], data.total || 0);
      } catch (error) {
        toast('加载消息失败: ' + error.message, 'error');
      }
    });
    bindIfPresent('logoutBtn', 'click', function () {
      localStorage.removeItem('huiyi_console_token');
      localStorage.removeItem(window.HuiyiConfig.LOGIN_KEY);
      window.location.reload();
    });
    bindIfPresent('detailModalClose', 'click', function () {
      document.getElementById('detailModal').classList.add('is-hidden');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var modal = document.getElementById('detailModal');
        if (modal) modal.classList.add('is-hidden');
      }
    });
    var detailModal = document.getElementById('detailModal');
    if (detailModal) {
      detailModal.addEventListener('click', function (event) {
        if (event.target === detailModal) detailModal.classList.add('is-hidden');
      });
    }
    document.body.addEventListener('click', async function (event) {
      var btn = event.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var code = btn.dataset.code || '';
      var assignee = btn.dataset.assignee ? decodeURIComponent(btn.dataset.assignee) : '';
      try {
        if (action === 'show-detail') showAssigneeDetail(assignee);
        if (action === 'delete-assignee') await deleteAssigneeCodes(assignee);
        if (action === 'release-code') await releaseCode(code);
        if (action === 'delete-code') await deleteCode(code);
        if (action === 'check-api') await checkApiConnection(true, btn.dataset.url || '');
        if (action === 'use-api') await setMainApi(btn.dataset.url || '');
        if (action === 'delete-api') await deleteBackupApi(btn.dataset.key || '');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function showApp() {
    document.getElementById('loginOverlay').classList.add('is-hidden');
    document.getElementById('appPage').style.display = '';
  }

  async function startApp() {
    var currentToken = token();
    if (currentToken) {
      try {
        var response = await authedFetch('/console/auth/me');
        if (response.status === 401) {
          localStorage.removeItem('huiyi_console_token');
          localStorage.removeItem(window.HuiyiConfig.LOGIN_KEY);
          window.location.reload();
          return;
        }
      } catch {
        // Keep the UI usable during transient network issues.
      }
    }
    bindEvents();
    var savedPage = localStorage.getItem('admin_current_page') || 'dashboard';
    var savedNavItem = document.querySelector('.nav-item[data-page="' + savedPage + '"]');
    if (savedNavItem) {
      document.querySelectorAll('.nav-item').forEach(function (nav) { nav.classList.remove('active'); });
      document.querySelectorAll('.page-content').forEach(function (content) { content.classList.remove('active'); });
      savedNavItem.classList.add('active');
      var savedPageEl = document.getElementById('page-' + savedPage);
      if (savedPageEl) savedPageEl.classList.add('active');
    }
    await reloadData();
    await loadApiConfig();
    if (savedPage === 'chat') refreshChat().catch(function () {});
  }

  async function loadChatRooms() {
    var data = await authedJson('/console/chat/rooms');
    return data.rooms || [];
  }

  async function loadChatMessages(room, limit, offset) {
    var params = new URLSearchParams();
    if (room) params.set('room', room);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return authedJson('/console/chat/messages?' + params.toString());
  }

  function renderChatRooms(rooms) {
    var select = document.getElementById('chatRoomSelect');
    if (!select) return;
    var currentValue = select.value;
    select.innerHTML = '<option value="">-- All rooms --</option>';
    rooms.forEach(function (room) {
      var option = document.createElement('option');
      option.value = room.room_name;
      option.textContent = room.room_name + ' (' + room.msg_count + ')';
      select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
  }

  function renderChatMessages(messages, total) {
    var container = document.getElementById('chatMessagesContainer');
    var countEl = document.getElementById('chatMsgCount');
    if (!container || !countEl) return;
    countEl.textContent = total + ' messages';
    if (!messages.length) {
      container.innerHTML = '<div class="empty">No chat messages</div>';
      return;
    }
    container.innerHTML = messages.map(function (message) {
      var isLocal = message.sender_identity === '__local__';
      var cls = isLocal ? 'chat-msg sent' : 'chat-msg received';
      var time = message.created_at ? new Date(message.created_at).toLocaleString() : '';
      var name = message.sender_name || message.sender_identity || 'Unknown';
      return '<div class="' + cls + '">' +
        '<div class="chat-msg-header">' +
        '<span class="chat-msg-sender">' + escapeHtml(name) + '</span>' +
        '<span class="chat-msg-time">' + escapeHtml(time) + '</span>' +
        '</div>' +
        '<div class="chat-msg-body">' + escapeHtml(message.content) + '</div>' +
        '</div>';
    }).join('');
  }

  async function refreshChat() {
    try {
      var rooms = await loadChatRooms();
      renderChatRooms(rooms);
      var selectedRoom = document.getElementById('chatRoomSelect')?.value || '';
      var data = await loadChatMessages(selectedRoom, 500, 0);
      renderChatMessages(data.messages || [], data.total || 0);
    } catch (error) {
      toast('加载聊天失败: ' + error.message, 'error');
    }
  }

  window.HuiyiApp = { showApp: showApp, startApp: startApp };
})(window);

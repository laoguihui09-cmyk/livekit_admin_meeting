(function (window) {
  'use strict';

  var state = {
    db: { stats: null, codes: [], connected: false },
    api: { base: '', backups: [], connected: false },
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
      text.textContent = type === 'db' ? 'Database connected' : 'API connected';
    } else if (status === 'error') {
      dot.classList.add('error');
      text.textContent = type === 'db' ? 'Database disconnected' : 'API disconnected';
    } else if (status === 'loading') {
      text.textContent = type === 'db' ? 'Loading database...' : 'Checking API...';
    } else {
      text.textContent = type === 'db' ? 'Database disconnected' : 'API not configured';
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
    return parts.length ? parts.join(' / ') : 'Unassigned';
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
      state.api.base = data.currentUrl || data.mainUrl || '';
      state.api.backups = data.backups || [];
      renderApiConfig();
      if (state.api.base) await checkApiConnection(false);
      else updateApiStatus(false, 'API not configured');
    } catch (error) {
      updateApiStatus(false, 'API config load failed');
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
    setText('apiStatusText', text || (ok ? 'API connected' : 'API not configured'));
    setText('connectionStatusText', text || (ok ? 'Connected' : 'Not configured'));
  }

  function renderApiConfig() {
    var input = document.querySelector('#apiConfigForm input[name="base"]');
    if (input) input.value = state.api.base || '';
    var grid = document.getElementById('apiUrlsGrid');
    if (!grid) return;
    grid.innerHTML = state.api.base
      ? '<div class="saved-item"><div class="saved-label">Main API</div><div class="saved-value">' + escapeHtml(state.api.base) + '</div></div>'
      : '<div class="empty">API URL is not configured</div>';
  }

  async function saveApiConfig(form) {
    var data = new FormData(form);
    var base = normalizeApiBase(data.get('base'));
    if (!base) throw new Error('Please enter API URL');
    var result = await authedJson('/console/api-urls/main', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: base }),
    });
    state.api.base = result.currentUrl || result.mainUrl || base;
    renderApiConfig();
    toast('API URL saved', 'ok');
    await checkApiConnection(true);
  }

  async function checkApiConnection(showToast) {
    if (!state.api.base) {
      updateApiStatus(false, 'API not configured');
      if (showToast) toast('API URL is not configured', 'error');
      return;
    }
    updateSidebarStatus('api', 'loading');
    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 10000);
      var resp = await fetch(state.api.base + '/health/ping', { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      updateApiStatus(true, 'API connected');
      if (showToast) toast('API connected', 'ok');
    } catch (error) {
      updateApiStatus(false, 'API disconnected');
      if (showToast) toast('API check failed: ' + error.message, 'error');
    }
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
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No data</td></tr>';
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
        '<td><div class="row-actions"><button class="btn-inline btn-danger" data-action="delete-assignee" data-assignee="' + encoded + '">Delete group</button><button class="btn-inline" data-action="show-detail" data-assignee="' + encoded + '">Details</button></div></td></tr>';
    }).join('');
  }

  function showAssigneeDetail(name) {
    var codes = (state.db.codes || []).filter(function (row) { return getAssigneeName(row) === name; });
    setText('detailModalTitle', name + ' codes');
    var tbody = document.getElementById('detailTable');
    if (!tbody) return;
    tbody.innerHTML = codes.map(function (row) {
      var code = row.code || '-';
      var status = row.status || (row.in_use ? 'in_use' : 'available');
      var tone = status === 'expired' || status === 'in_use' ? 'danger' : 'ok';
      var room = row.bound_room || row.room_name || '-';
      var actions = [];
      if (status !== 'expired' && room !== '-') {
        actions.push('<button class="btn-inline" data-action="release-code" data-code="' + escapeHtml(code) + '">Release</button>');
      }
      actions.push('<button class="btn-inline btn-danger" data-action="delete-code" data-code="' + escapeHtml(code) + '">Delete</button>');
      return '<tr>' +
        '<td><code>' + escapeHtml(code) + '</code></td>' +
        '<td><span class="status-dot ' + tone + '"></span></td>' +
        '<td>' + escapeHtml(room) + '</td>' +
        '<td>' + (row.expires_at ? new Date(row.expires_at).toLocaleString() : '-') +
        '<div class="countdown" data-expires-at="' + (row.expires_at || '') + '">' + formatCountdown(row.expires_at || '') + '</div></td>' +
        '<td><div class="row-actions">' + actions.join('') + '</div></td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">No data</td></tr>';
    updateCountdowns();
    var modal = document.getElementById('detailModal');
    if (modal) modal.classList.remove('is-hidden');
  }

  async function createCodes(form) {
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.assigned || !String(data.assigned).trim()) throw new Error('Please enter an assignee');
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
    toast('Created ' + (result.created || 0) + ' codes', 'ok');
    await reloadData();
  }

  async function releaseCode(code) {
    await authedJson('/console/codes/' + encodeURIComponent(code) + '/release', { method: 'POST' });
    toast('Released code ' + code, 'ok');
    await reloadData();
  }

  async function deleteCode(code) {
    var result = await authedJson('/console/codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: [code] }),
    });
    toast(result.ok ? 'Deleted code ' + code : 'Delete failed', result.ok ? 'ok' : 'error');
    await reloadData();
  }

  async function deleteAssigneeCodes(name) {
    if (!confirm('Delete all codes for "' + name + '"?')) return;
    var codes = (state.db.codes || [])
      .filter(function (row) { return getAssigneeName(row) === name; })
      .map(function (row) { return row.code; });
    if (!codes.length) {
      toast('No codes to delete', 'info');
      return;
    }
    var result = await authedJson('/console/codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: codes }),
    });
    toast('Deleted ' + (result.deleted || 0) + ' codes', result.ok ? 'ok' : 'error');
    await reloadData();
    var modal = document.getElementById('detailModal');
    if (modal) modal.classList.add('is-hidden');
  }

  async function cleanup() {
    var result = await authedJson('/console/cleanup', { method: 'POST' });
    toast('Cleaned ' + (result.expired_sessions || 0) + ' expired sessions', 'ok');
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
    bindIfPresent('refreshAllBtn', 'click', async function () { await reloadData(); toast('Data refreshed', 'ok'); });
    bindIfPresent('refreshInlineBtn', 'click', reloadData);
    bindIfPresent('cleanupBtn', 'click', cleanup);
    bindIfPresent('chatRefreshBtn', 'click', refreshChat);
    bindIfPresent('checkAllUrlsBtn', 'click', function () { checkApiConnection(true); });
    bindIfPresent('apiConfigForm', 'submit', async function (event) {
      event.preventDefault();
      try { await saveApiConfig(this); }
      catch (error) { toast(error.message, 'error'); }
    });
    bindIfPresent('chatRoomSelect', 'change', async function () {
      try {
        var data = await loadChatMessages(this.value, 500, 0);
        renderChatMessages(data.messages || [], data.total || 0);
      } catch (error) {
        toast('Failed to load messages: ' + error.message, 'error');
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
      toast('Failed to load chat: ' + error.message, 'error');
    }
  }

  window.HuiyiApp = { showApp: showApp, startApp: startApp };
})(window);

// 管理后台主模块
(function (window) {
'use strict';

// ── 状态 ──────────────────────────────────────────────────────────────────
var state = {
db: { stats: null, codes: [], connected: false },
api: { base: '', backups: [], health: null, rooms: [] },
ui: { apiReady: false, apiReachable: false }
};

// ── 工具 ──────────────────────────────────────────────────────────────────
function token() { return window.HuiyiLogin ? window.HuiyiLogin.getToken() : ''; }

function authedFetch(url, opts) {
opts = opts || {};
opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token() }, opts.headers || {});
return fetch(url, opts);
}

async function authedJson(url, opts) {
var resp = await authedFetch(url, opts);
var data = await resp.json().catch(function () { return {}; });
if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
return data;
}

function toast(msg, type) {
var el = document.createElement('div');
el.className = 'toast ' + (type || 'info');
el.textContent = msg;
document.getElementById('toastStack').appendChild(el);
setTimeout(function () { el.remove(); }, 3200);
}

function updateSidebarStatus(type, status) {
var dot = document.getElementById(type + 'StatusDot');
var text = document.getElementById(type + 'StatusText');
if (!dot || !text) return;
dot.className = 'status-dot';
if (status === 'connected') {
dot.classList.add('connected');
text.textContent = type === 'db' ? '数据库已连接' : 'API已连接';
} else if (status === 'error') {
dot.classList.add('error');
text.textContent = type === 'db' ? '数据库未连接' : 'API未连接';
} else if (status === 'loading') {
text.textContent = type === 'db' ? '数据库加载中...' : 'API加载中...';
} else {
text.textContent = type === 'db' ? '数据库未连接' : 'API未配置';
}
}

function formatCountdown(expiresAt) {
if (!expiresAt) return '-';
var diff = new Date(expiresAt).getTime() - Date.now();
if (isNaN(diff) || diff <= 0) return '已过期';
var s = Math.floor(diff / 1000);
var parts = [];
var d = Math.floor(s / 86400); if (d) { parts.push(d + '天'); s %= 86400; }
var h = Math.floor(s / 3600); if (h || d) { parts.push(h + '时'); s %= 3600; }
parts.push(Math.floor(s / 60) + '分');
parts.push(s % 60 + '秒');
return parts.join(' ');
}

function updateCountdowns() {
document.querySelectorAll('[data-expires-at]').forEach(function (el) {
el.textContent = formatCountdown(el.dataset.expiresAt || '');
});
}

function getAssigneeName(row) {
var parts = [row.assigned_name, row.assigned_to].filter(function (v) {
return v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '0';
});
return parts.length ? parts.join(' / ') : '未分配';
}

// ── 数据加载（只操作数据库）──────────────────────────────────────────────
async function loadStats() {
var data = await authedJson('/console/codes/stats');
state.db.stats = data;
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
} catch (e) {
state.db.connected = false;
updateSidebarStatus('db', 'error');
console.warn('数据库加载失败:', e);
}
}

// ── 渲染 ──────────────────────────────────────────────────────────────────
function renderState() {
var stats = state.db.stats || {};
function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

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
if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>'; return; }

var groups = {};
rows.forEach(function (r) {
var name = getAssigneeName(r);
(groups[name] = groups[name] || []).push(r);
});

tbody.innerHTML = Object.entries(groups).map(function (entry) {
var name = entry[0], list = entry[1];
var used = list.filter(function (c) { return c.status === 'in_use' || c.in_use; }).length;
var expired = list.filter(function (c) { return c.status === 'expired'; }).length;
var avail = list.length - used - expired;
var enc = encodeURIComponent(name);
return '<tr><td>' + name + '</td><td>' + list.length + '</td><td>' + used + '</td><td>' + avail + '</td><td>' + expired + '</td>' +
'<td><div class="row-actions"><button class="btn-inline btn-danger" data-action="delete-assignee" data-assignee="' + enc + '">删除该组</button><button class="btn-inline" data-action="show-detail" data-assignee="' + enc + '">查看详情</button></div></td></tr>';
}).join('');
}

function showAssigneeDetail(name) {
var codes = (state.db.codes || []).filter(function (r) { return getAssigneeName(r) === name; });
document.getElementById('detailModalTitle').textContent = name + ' 的授权码';
var tbody = document.getElementById('detailTable');
tbody.innerHTML = codes.map(function (row) {
var code = row.code || '-';
var status = row.status || (row.in_use ? 'in_use' : 'available');
var tone = (status === 'expired' || status === 'in_use') ? 'danger' : 'ok';
var room = row.bound_room || row.room_name || '-';
var canRelease = status !== 'expired' && room !== '-';
var actions = [];
if (canRelease) actions.push('<button class="btn-inline" data-action="release-code" data-code="' + code + '">释放</button>');
actions.push('<button class="btn-inline btn-danger" data-action="delete-code" data-code="' + code + '">删除</button>');
return '<tr>' +
'<td><code>' + code + '</code></td>' +
'<td><span class="status-dot ' + tone + '"></span></td>' +
'<td>' + room + '</td>' +
'<td>' + (row.expires_at ? new Date(row.expires_at).toLocaleString('zh-CN') : '-') +
'<div class="countdown" data-expires-at="' + (row.expires_at || '') + '">' + formatCountdown(row.expires_at || '') + '</div></td>' +
'<td><div class="row-actions">' + actions.join('') + '</div></td></tr>';
}).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>';
updateCountdowns();
document.getElementById('detailModal').classList.remove('is-hidden');
}

// ── 业务操作（只操作数据库）──────────────────────────────────────────────
async function createCodes(form) {
var data = Object.fromEntries(new FormData(form).entries());
if (!data.assigned || !String(data.assigned).trim()) throw new Error('请填写分配对象');
data.count = Number(data.count);
data.expire_minutes = Number(data.expire_minutes);
var assigned = String(data.assigned).trim();
delete data.assigned;
if (/^\d+$/.test(assigned)) data.assigned_to = Number(assigned);
else data.assigned_name = assigned;
var result = await authedJson('/console/codes/create', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(data)
});
toast('创建了 ' + (result.created || 0) + ' 个授权码', 'ok');
await loadStats();
await loadCodes();
renderState();
}

async function releaseCode(code) {
await authedJson('/console/codes/' + encodeURIComponent(code) + '/release', { method: 'POST' });
toast('已释放授权码 ' + code, 'ok');
await loadStats();
await loadCodes();
renderState();
}

async function deleteCode(code) {
var result = await authedJson('/console/codes', {
method: 'DELETE',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ codes: [code] })
});
if (result.ok) {
toast('已删除授权码 ' + code, 'ok');
} else {
toast('删除失败: ' + (result.failed?.join(', ') || '未知错误'), 'error');
}
await loadStats();
await loadCodes();
renderState();
}

async function deleteAssigneeCodes(name) {
if (!confirm('确定要删除「' + name + '」的全部授权码？')) return;
var codes = (state.db.codes || []).filter(function (r) { return getAssigneeName(r) === name; }).map(function (r) { return r.code; });
if (!codes.length) { toast('没有可删除的授权码', 'info'); return; }
var result = await authedJson('/console/codes', {
method: 'DELETE',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ codes: codes })
});
if (result.ok) {
toast('已删除 ' + result.deleted + ' 个授权码', 'ok');
} else {
toast('删除 ' + result.deleted + ' 个，失败 ' + result.failed?.length + ' 个', 'error');
}
await loadStats();
await loadCodes();
renderState();
document.getElementById('detailModal').classList.add('is-hidden');
}

async function cleanup() {
var result = await authedJson('/console/cleanup', { method: 'POST' });
toast('已清理 ' + (result.expired_sessions || 0) + ' 个过期会话', 'ok');
await loadStats();
await loadCodes();
renderState();
}

// ── 事件绑定 ──────────────────────────────────────────────────────────────
function bindEvents() {
// 导航切换
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var page = this.dataset.page;
      localStorage.setItem('admin_current_page', page);
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      document.querySelectorAll('.page-content').forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('page-' + page).classList.add('active');
      if (page === 'chat') { refreshChat().catch(function(){}); }
    });
  });

// 创建授权码
document.getElementById('createForm').addEventListener('submit', async function (e) {
e.preventDefault();
try { await createCodes(this); }
catch (err) { toast(err.message, 'error'); }
});

// 刷新 / 清理
document.getElementById('refreshAllBtn').addEventListener('click', async function () {
await loadDatabaseData();
renderState();
toast('数据已刷新', 'ok');
});
document.getElementById('refreshInlineBtn').addEventListener('click', async function () {
await loadDatabaseData();
renderState();
});
document.getElementById('cleanupBtn').addEventListener('click', async function () {
await cleanup();
});

// 聊天记录
document.getElementById('chatRefreshBtn').addEventListener('click', async function () {
  await refreshChat();
});
document.getElementById('chatRoomSelect').addEventListener('change', async function () {
  try {
    var room = this.value;
    var data = await loadChatMessages(room, 500, 0);
    renderChatMessages(data.messages || [], data.total || 0);
  } catch (e) {
    toast('加载消息失败: ' + e.message, 'error');
  }
});

// 退出登录
document.getElementById('logoutBtn').addEventListener('click', function () {
localStorage.removeItem('huiyi_console_token');
localStorage.removeItem(window.HuiyiConfig.LOGIN_KEY);
window.location.reload();
});

// 详情模态框
var detailModal = document.getElementById('detailModal');
document.getElementById('detailModalClose') && document.getElementById('detailModalClose').addEventListener('click', function () { detailModal.classList.add('is-hidden'); });

// ESC & 遮罩关闭
document.addEventListener('keydown', function (e) {
if (e.key !== 'Escape') return;
document.getElementById('detailModal').classList.add('is-hidden');
});
['detailModal'].forEach(function (id) {
var el = document.getElementById(id);
if (el) el.addEventListener('click', function (e) { if (e.target === el) el.classList.add('is-hidden'); });
});

// 全局 data-action 代理
document.body.addEventListener('click', async function (e) {
var btn = e.target.closest('[data-action]');
if (!btn) return;
var action = btn.dataset.action;
var code = btn.dataset.code || '';
var assignee = btn.dataset.assignee ? decodeURIComponent(btn.dataset.assignee) : '';

try {
if (action === 'show-detail') { showAssigneeDetail(assignee); return; }
if (action === 'delete-assignee') { await deleteAssigneeCodes(assignee); return; }
if (action === 'release-code') {
await releaseCode(code);
if (!detailModal.classList.contains('is-hidden')) {
showAssigneeDetail(document.getElementById('detailModalTitle').textContent.replace(' 的授权码', ''));
}
return;
}
if (action === 'delete-code') {
await deleteCode(code);
if (!detailModal.classList.contains('is-hidden')) {
showAssigneeDetail(document.getElementById('detailModalTitle').textContent.replace(' 的授权码', ''));
}
return;
}
} catch (err) {
toast(err.message, 'error');
}
});
}

// ── 启动 ──────────────────────────────────────────────────────────────────
function showApp() {
document.getElementById('loginOverlay').classList.add('is-hidden');
document.getElementById('appPage').style.display = '';
}

async function startApp() {
var t = token();
if (t) {
try {
var r = await authedFetch('/console/auth/me');
if (r.status === 401) {
localStorage.removeItem('huiyi_console_token');
localStorage.removeItem(window.HuiyiConfig.LOGIN_KEY);
window.location.reload();
return;
}
} catch (e) { /* 网络错误继续 */ }
}

bindEvents();

var savedPage = localStorage.getItem('admin_current_page') || 'dashboard';
var savedNavItem = document.querySelector('.nav-item[data-page="' + savedPage + '"]');
if (savedNavItem) {
document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
document.querySelectorAll('.page-content').forEach(function(p) { p.classList.remove('active'); });
savedNavItem.classList.add('active');
document.getElementById('page-' + savedPage).classList.add('active');
}

await loadDatabaseData();
renderState();
if (savedPage === 'chat') { refreshChat().catch(function(){}); }
}

// ── 聊天记录模块 ──────────────────────────────────────────────────────────
async function loadChatRooms() {
  var data = await authedJson('/console/chat/rooms');
  return data.rooms || [];
}

async function loadChatMessages(room, limit, offset) {
  var params = new URLSearchParams();
  if (room) params.set('room', room);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  var data = await authedJson('/console/chat/messages?' + params.toString());
  return data;
}

function renderChatRooms(rooms) {
  var select = document.getElementById('chatRoomSelect');
  var currentVal = select.value;
  select.innerHTML = '<option value="">-- 全部房间 --</option>';
  rooms.forEach(function (r) {
    var opt = document.createElement('option');
    opt.value = r.room_name;
    opt.textContent = r.room_name + ' (' + r.msg_count + '条)';
    select.appendChild(opt);
  });
  if (currentVal) select.value = currentVal;
}

function renderChatMessages(messages, total) {
  var container = document.getElementById('chatMessagesContainer');
  var countEl = document.getElementById('chatMsgCount');
  countEl.textContent = '共 ' + total + ' 条消息';

  if (!messages.length) {
    container.innerHTML = '<div class="empty">暂无聊天记录</div>';
    return;
  }

  container.innerHTML = messages.map(function (m) {
    var isLocal = m.sender_identity === '__local__';
    var cls = isLocal ? 'chat-msg sent' : 'chat-msg received';
    var time = m.created_at ? new Date(m.created_at).toLocaleString('zh-CN') : '';
    var name = m.sender_name || m.sender_identity || '未知';
    return '<div class="' + cls + '">' +
      '<div class="chat-msg-header">' +
        '<span class="chat-msg-sender">' + escapeHtml(name) + '</span>' +
        '<span class="chat-msg-time">' + time + '</span>' +
      '</div>' +
      '<div class="chat-msg-body">' + escapeHtml(m.content) + '</div>' +
    '</div>';
  }).join('');
}

function unawaited(p) { p.catch(function(){}); }

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function refreshChat() {
  try {
    var rooms = await loadChatRooms();
    renderChatRooms(rooms);

    var selectedRoom = document.getElementById('chatRoomSelect').value;
    var data = await loadChatMessages(selectedRoom, 500, 0);
    renderChatMessages(data.messages || [], data.total || 0);
  } catch (e) {
    toast('加载聊天记录失败: ' + e.message, 'error');
  }
}

window.HuiyiApp = { showApp: showApp, startApp: startApp };

})(window);

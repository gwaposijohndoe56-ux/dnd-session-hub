// ─── DnD Session Hub — Player App ─────────────────────────────────────────

const API = CONFIG.BACKEND_URL + '/api';
let socket = null;
let currentUser = null;
let inQueue = false;
let myQueueStatus = null;
let currentRoomUrl = null;
let chatInitialized = false;

// ── Utils ───────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(id) {
  document.getElementById(id).classList.add('hidden');
}

function getInitials(name) {
  return name ? name.substring(0, 2).toUpperCase() : '??';
}

function colorFromString(str) {
  const colors = ['#8B5CF6','#EC4899','#10B981','#F59E0B','#3B82F6','#EF4444','#14B8A6','#F97316'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Auth Tab Switch ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

// ── Register ────────────────────────────────────────────────────────────────
async function doRegister() {
  hideError('register-error');
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;

  if (!username || !password) return showError('register-error', 'All fields required.');
  if (password !== confirm) return showError('register-error', 'Passwords do not match.');

  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError('register-error', data.error || 'Registration failed.');

    localStorage.setItem('dnd_token', data.token);
    localStorage.setItem('dnd_user', JSON.stringify(data.user));
    initLobby(data.user);
  } catch (err) {
    showError('register-error', 'Cannot reach server. Is the backend running?');
  }
}

// ── Login ───────────────────────────────────────────────────────────────────
async function doLogin() {
  hideError('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) return showError('login-error', 'Enter your credentials.');

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError('login-error', data.error || 'Login failed.');

    localStorage.setItem('dnd_token', data.token);
    localStorage.setItem('dnd_user', JSON.stringify(data.user));
    initLobby(data.user);
  } catch (err) {
    showError('login-error', 'Cannot reach server. Is the backend running?');
  }
}

function doLogout() {
  if (socket) socket.disconnect();
  localStorage.removeItem('dnd_token');
  localStorage.removeItem('dnd_user');
  location.reload();
}

// ── Init Lobby ──────────────────────────────────────────────────────────────
function initLobby(user) {
  currentUser = user;

  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('lobby-screen').classList.remove('hidden');

  // Set nav
  document.getElementById('nav-username').textContent = user.username;

  // Set my avatar
  const avatar = document.getElementById('my-avatar');
  avatar.textContent = getInitials(user.username);
  avatar.style.background = user.avatarColor || colorFromString(user.username);
  document.getElementById('my-name-display').textContent = user.username;

  // Connect socket
  connectSocket(user);

  // Load chat history
  loadChatHistory();

  // Fetch current session state
  fetchSessionState();
}

// ── Socket Connection ───────────────────────────────────────────────────────
function connectSocket(user) {
  const token = localStorage.getItem('dnd_token');
  socket = io(CONFIG.BACKEND_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    setConnectionStatus(true);
    if (inQueue) socket.emit('queue:join');
  });

  socket.on('disconnect', () => setConnectionStatus(false));
  socket.on('connect_error', () => setConnectionStatus(false));

  // Queue updates
  socket.on('queue:update', (data) => renderQueueUpdate(data));

  // Chat
  socket.on('chat:message', (msg) => appendChatMessage(msg));

  // Session events
  socket.on('session:started', ({ roomUrl }) => {
    currentRoomUrl = roomUrl;
    if (inQueue || myQueueStatus === 'approved' || myQueueStatus === 'waiting') {
      showJoinSessionUI(roomUrl);
    }
    toast('⚔ The session has begun! Enter the portal!', 'success');
  });

  socket.on('session:ended', () => {
    hideJoinSessionUI();
    currentRoomUrl = null;
    toast('The session has ended. The party returns to the tavern.', 'info');
    fetchSessionState();
  });

  // Player-specific events
  socket.on('player:kicked', ({ playerId }) => {
    if (playerId === user.id) {
      inQueue = false;
      myQueueStatus = null;
      updateMyStatus('kicked');
      toast('🚫 The Dungeon Master has removed you from the queue.', 'error');
    }
  });

  socket.on('player:approved', ({ playerId }) => {
    if (playerId === user.id) {
      myQueueStatus = 'approved';
      updateMyStatus('approved');
      toast('✅ The DM has approved your entry!', 'success');
    }
  });

  socket.on('player:muted', ({ playerId, muted }) => {
    if (playerId === user.id) {
      toast(muted ? '🔇 You have been muted by the DM.' : '🔊 The DM has unmuted you.', 'info');
    }
  });

  socket.on('player:speak', ({ playerId, canSpeak }) => {
    if (playerId === user.id) {
      toast(canSpeak ? '🎤 You may now speak.' : '🔇 Your speaking privilege has been revoked.', 'info');
    }
  });
}

function setConnectionStatus(connected) {
  document.getElementById('conn-dot').classList.toggle('connected', connected);
  document.getElementById('conn-label').textContent = connected ? 'Connected' : 'Reconnecting...';
  document.getElementById('conn-label').style.color = connected ? 'var(--green-bright)' : 'var(--text-muted)';
}

// ── Queue Controls ──────────────────────────────────────────────────────────
async function joinQueue() {
  const token = localStorage.getItem('dnd_token');
  try {
    const res = await fetch(`${API}/session/join`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Could not join queue.', 'error');

    inQueue = true;
    myQueueStatus = 'waiting';
    updateMyStatus('waiting');
    socket.emit('queue:join');
    toast('You have entered the queue. Await the DM\'s call.', 'success');
  } catch (err) {
    toast('Cannot reach server.', 'error');
  }
}

async function leaveQueue() {
  const token = localStorage.getItem('dnd_token');
  try {
    await fetch(`${API}/session/leave`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    inQueue = false;
    myQueueStatus = null;
    updateMyStatus('none');
    socket.emit('queue:leave');
    toast('You have left the queue.', 'info');
  } catch (err) {
    toast('Error leaving queue.', 'error');
  }
}

function updateMyStatus(status) {
  const badge = document.getElementById('my-status-badge');
  const joinBtn = document.getElementById('join-btn');
  const leaveBtn = document.getElementById('leave-btn');

  const badges = {
    none: '<span class="badge badge-waiting">Not in queue</span>',
    waiting: '<span class="badge badge-waiting"><span class="dot dot-waiting"></span> Waiting</span>',
    approved: '<span class="badge badge-approved"><span class="dot dot-online"></span> Approved</span>',
    in_session: '<span class="badge badge-session"><span class="dot dot-live"></span> In Session</span>',
    kicked: '<span class="badge badge-muted">Removed</span>',
  };

  badge.innerHTML = badges[status] || badges.none;
  joinBtn.disabled = status !== 'none' && status !== 'kicked';
  leaveBtn.style.display = (status === 'waiting' || status === 'approved') ? 'block' : 'none';
}

// ── Render Queue Update ─────────────────────────────────────────────────────
function renderQueueUpdate({ session, queue, onlineCount }) {
  // Invite code
  if (session?.inviteCode) {
    document.getElementById('invite-code-display').textContent = session.inviteCode;
  }

  // Session status badge
  const statusBadge = document.getElementById('session-status-badge');
  const activeAlert = document.getElementById('session-active-alert');
  if (session?.status === 'active') {
    statusBadge.classList.add('hidden');
    activeAlert.classList.remove('hidden');
  } else {
    statusBadge.classList.remove('hidden');
    activeAlert.classList.add('hidden');
  }

  // Online count
  document.getElementById('online-count').textContent = `${onlineCount || 0} online`;

  // Queue lists
  const waiting = queue.filter(q => q.status === 'waiting' || q.status === 'approved');
  const inSession = queue.filter(q => q.status === 'in_session');

  document.getElementById('queue-count').textContent = `${queue.length} adventurer${queue.length !== 1 ? 's' : ''}`;

  renderQueueList('queue-waiting-list', waiting, 'No adventurers waiting');
  renderQueueList('queue-session-list', inSession, 'None in session');

  // Update my status from queue
  if (currentUser) {
    const me = queue.find(q => q.player_id === currentUser.id);
    if (me) {
      inQueue = true;
      myQueueStatus = me.status;
      updateMyStatus(me.status);
    }
  }

  // If session is active and I'm in it, show join button
  if (session?.status === 'active' && session?.roomUrl) {
    currentRoomUrl = session.roomUrl;
    const me = queue.find(q => q.player_id === currentUser?.id);
    if (me && me.status === 'in_session') {
      showJoinSessionUI(session.roomUrl);
    }
  }
}

function renderQueueList(containerId, list, emptyMsg) {
  const el = document.getElementById(containerId);
  if (!list.length) {
    el.innerHTML = `<div class="empty-queue" style="padding:10px 0;font-size:0.9rem">${emptyMsg}</div>`;
    return;
  }

  el.innerHTML = list.map(q => {
    const color = q.avatarColor || colorFromString(q.username || '?');
    const initials = getInitials(q.username || '?');
    const isMe = currentUser && q.player_id === currentUser.id;
    const statusBadge = q.status === 'approved'
      ? '<span class="badge badge-approved" style="font-size:0.6rem">Approved</span>'
      : q.status === 'in_session'
      ? '<span class="badge badge-session" style="font-size:0.6rem">In Session</span>'
      : '';
    const mutedBadge = q.is_muted ? '<span class="badge badge-muted" style="font-size:0.6rem">Muted</span>' : '';

    return `
      <div class="player-row ${isMe ? 'border-gold' : ''}">
        <div class="avatar" style="background:${color}">${initials}</div>
        <span class="player-name">${q.username || '?'} ${isMe ? '<span style="color:var(--text-dim);font-size:0.75rem">(you)</span>' : ''}</span>
        ${statusBadge} ${mutedBadge}
        <span class="dot ${q.isOnline ? 'dot-online' : 'dot-offline'}" title="${q.isOnline ? 'Online' : 'Offline'}"></span>
      </div>
    `;
  }).join('');
}

// ── Session UI ──────────────────────────────────────────────────────────────
function showJoinSessionUI(roomUrl) {
  currentRoomUrl = roomUrl;
  document.getElementById('join-session-area').classList.remove('hidden');
}

function hideJoinSessionUI() {
  document.getElementById('join-session-area').classList.add('hidden');
}

function enterCall() {
  if (currentRoomUrl) {
    const username = encodeURIComponent(currentUser?.username || 'Adventurer');
    window.location.href = `call.html?roomUrl=${encodeURIComponent(currentRoomUrl)}&username=${username}`;
  }
}

// ── Chat ────────────────────────────────────────────────────────────────────
async function loadChatHistory() {
  const token = localStorage.getItem('dnd_token');
  try {
    const res = await fetch(`${API}/session/chat`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    const win = document.getElementById('chat-window');
    if (data.messages?.length) {
      win.innerHTML = '';
      data.messages.forEach(msg => appendChatMessage({
        username: msg.username,
        message: msg.message,
        avatarColor: colorFromString(msg.username),
        isDM: false,
        timestamp: msg.created_at
      }));
    }
  } catch (err) {}
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || !socket) return;
  socket.emit('chat:send', { message: msg, channel: 'tavern' });
  input.value = '';
}

function appendChatMessage({ username, message, avatarColor, isDM }) {
  const win = document.getElementById('chat-window');

  // Remove empty state
  const empty = win.querySelector('.empty-queue');
  if (empty) empty.remove();

  const color = avatarColor || colorFromString(username || '?');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `
    <div class="chat-avatar" style="background:${color}">${getInitials(username)}</div>
    <div class="chat-content">
      <div class="chat-username ${isDM ? 'is-dm' : ''}">${username}${isDM ? ' 🎲' : ''}</div>
      <div class="chat-text">${escapeHtml(message)}</div>
    </div>
  `;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Fetch Session State ─────────────────────────────────────────────────────
async function fetchSessionState() {
  const token = localStorage.getItem('dnd_token');
  if (!token) return;
  try {
    const res = await fetch(`${API}/session/current`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.session) {
      renderQueueUpdate({ session: { ...data.session, inviteCode: data.session.invite_code, roomUrl: data.session.room_url }, queue: data.queue, onlineCount: 0 });
    }
  } catch (err) {}
}

// ── Auto-login if token exists ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('dnd_token');
  const user = localStorage.getItem('dnd_user');
  if (token && user) {
    try {
      initLobby(JSON.parse(user));
    } catch (e) {
      localStorage.clear();
    }
  }
});

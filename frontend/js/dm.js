// ─── DnD Session Hub — DM Panel ────────────────────────────────────────────

const API = CONFIG.BACKEND_URL + '/api';
let dmSocket = null;
let dmToken = null;
let currentRoomUrl = null;
let notesTimer = null;
let currentSessionStatus = 'waiting';

// ── Utils ───────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
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

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── DM Login ────────────────────────────────────────────────────────────────
async function dmLogin() {
  const username = document.getElementById('dm-username').value.trim();
  const password = document.getElementById('dm-password').value;
  const errEl = document.getElementById('dm-login-error');
  errEl.classList.add('hidden');

  if (!username || !password) {
    errEl.textContent = 'Enter your DM credentials.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API}/auth/dm-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Access denied.';
      errEl.classList.remove('hidden');
      return;
    }

    dmToken = data.token;
    localStorage.setItem('dm_token', data.token);
    initDMPanel();
  } catch (err) {
    errEl.textContent = 'Cannot reach server. Is the backend running?';
    errEl.classList.remove('hidden');
  }
}

function dmLogout() {
  if (dmSocket) dmSocket.disconnect();
  localStorage.removeItem('dm_token');
  location.reload();
}

// ── Init DM Panel ───────────────────────────────────────────────────────────
function initDMPanel() {
  document.getElementById('dm-auth-screen').classList.add('hidden');
  document.getElementById('dm-panel').classList.remove('hidden');

  connectDMSocket();
  fetchDMQueue();
}

// ── Socket ──────────────────────────────────────────────────────────────────
function connectDMSocket() {
  dmSocket = io(CONFIG.BACKEND_URL, {
    auth: { token: dmToken },
    reconnection: true,
    reconnectionAttempts: 10
  });

  dmSocket.on('connect', () => {
    setConnStatus(true);
  });

  dmSocket.on('disconnect', () => setConnStatus(false));
  dmSocket.on('connect_error', () => setConnStatus(false));

  dmSocket.on('queue:update', (data) => renderDMUpdate(data));
  dmSocket.on('chat:message', (msg) => appendDMChat(msg));
}

function setConnStatus(connected) {
  const el = document.getElementById('dm-conn-status');
  el.innerHTML = connected
    ? '<span class="dot dot-online"></span> <span style="color:var(--green-bright)">Live</span>'
    : '<span class="dot dot-offline"></span> <span style="color:var(--text-muted)">Disconnected</span>';
}

// ── Fetch Queue ──────────────────────────────────────────────────────────────
async function fetchDMQueue() {
  try {
    const res = await fetch(`${API}/dm/queue`, {
      headers: { 'Authorization': `Bearer ${dmToken}` }
    });
    const data = await res.json();
    if (data.session) {
      renderDMUpdate({
        session: {
          id: data.session.id,
          status: data.session.status,
          inviteCode: data.session.invite_code,
          roomUrl: data.session.room_url,
          dmNotes: data.session.dm_notes
        },
        queue: data.queue.map(q => ({
          ...q,
          username: q.players?.username,
          avatarColor: q.players?.avatar_color
        }))
      });
      // Load notes
      if (data.session.dm_notes) {
        document.getElementById('dm-notes').value = data.session.dm_notes;
      }
    }
  } catch (err) {
    toast('Cannot reach server.', 'error');
  }
}

// ── Render DM Update ─────────────────────────────────────────────────────────
function renderDMUpdate({ session, queue, onlineCount }) {
  if (!session) return;

  currentSessionStatus = session.status;

  // Status badges
  const isActive = session.status === 'active';
  const badgeHtml = isActive
    ? '<span class="badge badge-live"><span class="dot dot-live"></span> LIVE</span>'
    : '<span class="badge badge-waiting"><span class="dot dot-waiting"></span> Waiting</span>';

  document.getElementById('dm-session-badge').innerHTML = badgeHtml;
  document.getElementById('ctrl-status-badge').innerHTML = badgeHtml;
  document.getElementById('ctrl-invite-code').textContent = session.inviteCode || '——';

  // Stats
  const waiting = queue.filter(q => q.status === 'waiting' || q.status === 'approved');
  const approved = queue.filter(q => q.status === 'approved');
  const inSess = queue.filter(q => q.status === 'in_session');

  document.getElementById('stat-total').textContent = waiting.length;
  document.getElementById('stat-approved').textContent = approved.length;
  document.getElementById('stat-session').textContent = inSess.length;
  document.getElementById('dm-online-count').textContent = onlineCount || 0;

  // Buttons
  document.getElementById('start-session-btn').disabled = isActive;
  document.getElementById('end-session-btn').disabled = !isActive;

  // Room URL
  if (isActive && session.roomUrl) {
    currentRoomUrl = session.roomUrl;
    document.getElementById('room-url-display').textContent = session.roomUrl;
    document.getElementById('room-url-container').classList.remove('hidden');
  } else {
    document.getElementById('room-url-container').classList.add('hidden');
  }

  // Queue lists
  renderDMQueueList('dm-queue-list', waiting, 'No players in queue');
  renderDMQueueList('dm-session-list', inSess, 'None in session', true);
}

function renderDMQueueList(containerId, list, emptyMsg, inSession = false) {
  const el = document.getElementById(containerId);
  if (!list.length) {
    el.innerHTML = `<div class="empty-queue" style="padding:10px 0;font-size:0.9rem">${emptyMsg}</div>`;
    return;
  }

  el.innerHTML = list.map(q => {
    const color = q.avatarColor || colorFromString(q.username || '?');
    const initials = getInitials(q.username || '?');
    const approved = q.status === 'approved';
    const muted = q.is_muted;
    const canSpeak = q.can_speak;

    return `
      <div class="player-dm-row">
        <div class="avatar" style="background:${color}">${initials}</div>
        <div style="flex:1">
          <div class="player-name">${escapeHtml(q.username || '?')}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
            ${approved ? '<span class="badge badge-approved" style="font-size:0.6rem">Approved</span>' : ''}
            ${muted ? '<span class="badge badge-muted" style="font-size:0.6rem">Muted</span>' : ''}
            ${!canSpeak ? '<span class="badge badge-muted" style="font-size:0.6rem">No Speak</span>' : ''}
          </div>
        </div>
        <div class="player-actions">
          ${!inSession ? `
            ${!approved ? `<button class="btn btn-green btn-sm" onclick="approvePlayer('${q.player_id}')">✓ Approve</button>` : ''}
          ` : ''}
          <button class="btn btn-sm ${muted ? 'btn-ghost' : 'btn-ember'}" onclick="toggleMute('${q.player_id}', ${!muted})">
            ${muted ? '🔊 Unmute' : '🔇 Mute'}
          </button>
          ${inSession ? `
            <button class="btn btn-sm ${canSpeak ? 'btn-ghost' : 'btn-green'}" onclick="toggleSpeak('${q.player_id}', ${!canSpeak})">
              ${canSpeak ? '🎤 Revoke' : '🎤 Allow'}
            </button>
          ` : ''}
          <button class="btn btn-red btn-sm" onclick="kickPlayer('${q.player_id}', '${escapeHtml(q.username || '')}')">
            ✕ Kick
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── DM Actions ───────────────────────────────────────────────────────────────
async function approvePlayer(playerId) {
  try {
    const res = await fetch(`${API}/dm/approve/${playerId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}` }
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Error approving player', 'error');
    dmSocket.emit('dm:approve', { playerId });
    toast('Player approved.', 'success');
    fetchDMQueue();
  } catch (err) { toast('Server error', 'error'); }
}

async function kickPlayer(playerId, username) {
  if (!confirm(`Remove ${username} from the session?`)) return;
  try {
    const res = await fetch(`${API}/dm/kick/${playerId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}` }
    });
    if (!res.ok) return toast('Error kicking player', 'error');
    dmSocket.emit('dm:kick', { playerId, username });
    toast(`${username} removed.`, 'success');
    fetchDMQueue();
  } catch (err) { toast('Server error', 'error'); }
}

async function toggleMute(playerId, muted) {
  try {
    const res = await fetch(`${API}/dm/mute/${playerId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted })
    });
    if (!res.ok) return toast('Error updating mute', 'error');
    dmSocket.emit('dm:mute', { playerId, muted });
    fetchDMQueue();
  } catch (err) { toast('Server error', 'error'); }
}

async function toggleSpeak(playerId, canSpeak) {
  try {
    const res = await fetch(`${API}/dm/speak/${playerId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ canSpeak })
    });
    if (!res.ok) return toast('Error updating speak', 'error');
    dmSocket.emit('dm:speak', { playerId, canSpeak });
    fetchDMQueue();
  } catch (err) { toast('Server error', 'error'); }
}

async function startSession() {
  document.getElementById('start-session-btn').disabled = true;
  try {
    const res = await fetch(`${API}/dm/start-session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Failed to start session', 'error');
      document.getElementById('start-session-btn').disabled = false;
      return;
    }

    currentRoomUrl = data.roomUrl;
    dmSocket.emit('dm:start_session', { roomUrl: data.roomUrl });
    toast('⚔ Session started! Players are being summoned.', 'success');
    fetchDMQueue();
  } catch (err) {
    toast('Server error', 'error');
    document.getElementById('start-session-btn').disabled = false;
  }
}

async function endSession() {
  if (!confirm('End the current session? All players will be dismissed.')) return;
  try {
    const res = await fetch(`${API}/dm/end-session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmToken}` }
    });
    if (!res.ok) return toast('Failed to end session', 'error');
    dmSocket.emit('dm:end_session');
    currentRoomUrl = null;
    toast('Session ended. The party returns to the tavern.', 'info');
    fetchDMQueue();
  } catch (err) { toast('Server error', 'error'); }
}

function openRoom() {
  if (currentRoomUrl) window.open(currentRoomUrl, '_blank');
}

// ── Notes ────────────────────────────────────────────────────────────────────
function scheduleSaveNotes() {
  clearTimeout(notesTimer);
  document.getElementById('notes-saved').textContent = 'Unsaved changes...';
  notesTimer = setTimeout(saveNotes, 2000);
}

async function saveNotes() {
  const notes = document.getElementById('dm-notes').value;
  try {
    const res = await fetch(`${API}/dm/notes`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${dmToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
    if (res.ok) {
      document.getElementById('notes-saved').textContent = 'Saved ✓';
      setTimeout(() => { document.getElementById('notes-saved').textContent = 'Auto-saving...'; }, 2000);
    }
  } catch (err) {}
}

// ── DM Chat ──────────────────────────────────────────────────────────────────
function dmSendChat() {
  const input = document.getElementById('dm-chat-input');
  const msg = input.value.trim();
  if (!msg || !dmSocket) return;
  dmSocket.emit('chat:send', { message: msg, channel: 'tavern' });
  input.value = '';
}

function appendDMChat({ username, message, avatarColor, isDM }) {
  const win = document.getElementById('dm-chat-window');
  const empty = win.querySelector('.empty-queue');
  if (empty) empty.remove();

  const color = avatarColor || colorFromString(username || '?');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `
    <div class="chat-avatar" style="background:${color}">${getInitials(username)}</div>
    <div class="chat-content">
      <div class="chat-username ${isDM ? 'is-dm' : ''}">${escapeHtml(username)}${isDM ? ' 🎲' : ''}</div>
      <div class="chat-text">${escapeHtml(message)}</div>
    </div>
  `;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

// ── Auto-login ───────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('dm_token');
  if (saved) {
    dmToken = saved;
    initDMPanel();
  }
});

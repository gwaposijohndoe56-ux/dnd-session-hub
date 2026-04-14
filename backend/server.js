require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { supabase, initDB, ensureActiveSession } = require('./db/supabase');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/session', require('./routes/session'));
app.use('/api/dm', require('./routes/dm'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── Socket.IO ──────────────────────────────────────────────────────────────
// Authenticate socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// Track connected users
const connectedUsers = new Map(); // socketId → user info

io.on('connection', (socket) => {
  const user = socket.user;
  connectedUsers.set(socket.id, user);

  console.log(`🎲 ${user.username} connected (${user.isDM ? 'DM' : 'Player'})`);

  // Join appropriate room
  if (user.isDM) {
    socket.join('dm-room');
  }
  socket.join('lobby');

  // Broadcast updated user list
  broadcastQueueUpdate();

  // ── Chat ──────────────────────────────────────────────────────────────────
  socket.on('chat:send', async (data) => {
    const { message, channel = 'tavern' } = data;
    if (!message?.trim() || message.length > 500) return;

    // Save to DB
    const { data: saved } = await supabase.from('chat_messages').insert({
      player_id: user.isDM ? null : user.id,
      username: user.username,
      message: message.trim(),
      channel
    }).select().single();

    const msgData = {
      id: saved?.id,
      username: user.username,
      message: message.trim(),
      avatarColor: user.avatarColor || '#8B5CF6',
      isDM: user.isDM,
      channel,
      timestamp: new Date().toISOString()
    };

    if (channel === 'tavern') {
      io.to('lobby').emit('chat:message', msgData);
    } else if (channel === 'dm_private' && user.isDM) {
      io.to('dm-room').emit('chat:dm_message', msgData);
    }
  });

  // ── Queue Events ──────────────────────────────────────────────────────────
  socket.on('queue:join', async () => {
    if (user.isDM) return;
    socket.join('queue-room');
    await broadcastQueueUpdate();
  });

  socket.on('queue:leave', async () => {
    socket.leave('queue-room');
    await broadcastQueueUpdate();
  });

  // ── DM Controls ──────────────────────────────────────────────────────────
  socket.on('dm:approve', async ({ playerId }) => {
    if (!user.isDM) return;
    io.emit('player:approved', { playerId });
    await broadcastQueueUpdate();
  });

  socket.on('dm:kick', async ({ playerId, username }) => {
    if (!user.isDM) return;
    io.emit('player:kicked', { playerId, username });
    await broadcastQueueUpdate();
  });

  socket.on('dm:mute', async ({ playerId, muted }) => {
    if (!user.isDM) return;
    io.emit('player:muted', { playerId, muted });
    await broadcastQueueUpdate();
  });

  socket.on('dm:speak', async ({ playerId, canSpeak }) => {
    if (!user.isDM) return;
    io.emit('player:speak', { playerId, canSpeak });
    await broadcastQueueUpdate();
  });

  socket.on('dm:start_session', async ({ roomUrl }) => {
    if (!user.isDM) return;
    // Notify all players to join the call
    io.emit('session:started', { roomUrl });
    await broadcastQueueUpdate();
  });

  socket.on('dm:end_session', async () => {
    if (!user.isDM) return;
    io.emit('session:ended', {});
    await broadcastQueueUpdate();
  });

  socket.on('dm:notes', ({ notes }) => {
    if (!user.isDM) return;
    // Notes are private to DM - just confirm save
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    console.log(`👋 ${user.username} disconnected`);
    broadcastQueueUpdate();
  });

  // Ping/pong for connection status
  socket.on('ping', () => socket.emit('pong'));
});

// Broadcast queue state to all connected clients
async function broadcastQueueUpdate() {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) return;

    const { data: queue } = await supabase
      .from('queue')
      .select('*, players(username, avatar_color)')
      .eq('session_id', session.id)
      .neq('status', 'kicked')
      .order('joined_at', { ascending: true });

    // Get online usernames
    const onlineUsernames = new Set(
      Array.from(connectedUsers.values()).map(u => u.username)
    );

    const enrichedQueue = (queue || []).map(q => ({
      ...q,
      username: q.players?.username,
      avatarColor: q.players?.avatar_color,
      isOnline: onlineUsernames.has(q.players?.username)
    }));

    io.emit('queue:update', {
      session: {
        id: session.id,
        status: session.status,
        inviteCode: session.invite_code,
        roomUrl: session.room_url,
        dmNotes: session.dm_notes,
        startedAt: session.started_at
      },
      queue: enrichedQueue,
      onlineCount: connectedUsers.size
    });
  } catch (err) {
    console.error('broadcastQueueUpdate error:', err);
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

async function start() {
  await ensureActiveSession();
  server.listen(PORT, () => {
    console.log(`\n⚔️  DnD Session Hub Backend running on port ${PORT}`);
    console.log(`🎲 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 Socket.IO ready`);
  });
}

start().catch(console.error);

module.exports = { app, io };

const express = require('express');
const fetch = require('node-fetch');
const { supabase, ensureActiveSession } = require('../db/supabase');
const { dmMiddleware } = require('../middleware/auth');
const router = express.Router();

const DAILY_BASE = 'https://api.daily.co/v1';
const DAILY_HEADERS = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.DAILY_API_KEY}`
});

// Helper: create Daily room
async function createDailyRoom() {
  const roomName = 'dnd-' + Date.now();
  const resp = await fetch(`${DAILY_BASE}/rooms`, {
    method: 'POST',
    headers: DAILY_HEADERS(),
    body: JSON.stringify({
      name: roomName,
      privacy: 'public',
      properties: {
        enable_chat: false,
        enable_knocking: false,
        start_video_off: false,
        start_audio_off: false,
        exp: Math.floor(Date.now() / 1000) + 3600 * 6 // 6 hour expiry
      }
    })
  });
  return resp.json();
}

// Get full queue
router.get('/queue', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) return res.json({ session: null, queue: [] });

    const { data: queue } = await supabase
      .from('queue')
      .select('*, players(username, avatar_color)')
      .eq('session_id', session.id)
      .neq('status', 'kicked')
      .order('joined_at', { ascending: true });

    res.json({ session, queue: queue || [] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve player
router.post('/approve/:playerId', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .eq('status', 'waiting')
      .single();

    if (!session) return res.status(400).json({ error: 'No waiting session' });

    await supabase.from('queue')
      .update({ status: 'approved' })
      .eq('player_id', req.params.playerId)
      .eq('session_id', session.id);

    res.json({ message: 'Player approved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Kick player
router.post('/kick/:playerId', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .in('status', ['waiting', 'active'])
      .single();

    if (!session) return res.status(400).json({ error: 'No session' });

    await supabase.from('queue')
      .update({ status: 'kicked' })
      .eq('player_id', req.params.playerId)
      .eq('session_id', session.id);

    res.json({ message: 'Player kicked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Mute/unmute player
router.post('/mute/:playerId', dmMiddleware, async (req, res) => {
  const { muted } = req.body;
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .in('status', ['waiting', 'active'])
      .single();

    await supabase.from('queue')
      .update({ is_muted: muted })
      .eq('player_id', req.params.playerId)
      .eq('session_id', session.id);

    res.json({ message: muted ? 'Player muted' : 'Player unmuted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Allow/revoke speak
router.post('/speak/:playerId', dmMiddleware, async (req, res) => {
  const { canSpeak } = req.body;
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .in('status', ['waiting', 'active'])
      .single();

    await supabase.from('queue')
      .update({ can_speak: canSpeak })
      .eq('player_id', req.params.playerId)
      .eq('session_id', session.id);

    res.json({ message: canSpeak ? 'Speak allowed' : 'Speak revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Start session → create Daily room → move approved players in
router.post('/start-session', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('status', 'waiting')
      .single();

    if (!session) return res.status(400).json({ error: 'No waiting session found' });

    // Create Daily.co room
    const room = await createDailyRoom();
    if (!room.url) return res.status(500).json({ error: 'Failed to create video room', details: room });

    // Update session to active
    await supabase.from('sessions')
      .update({
        status: 'active',
        room_name: room.name,
        room_url: room.url,
        started_at: new Date().toISOString()
      })
      .eq('id', session.id);

    // Move approved/waiting players to in_session
    await supabase.from('queue')
      .update({ status: 'in_session' })
      .eq('session_id', session.id)
      .in('status', ['approved', 'waiting']);

    res.json({ message: 'Session started', roomUrl: room.url, roomName: room.name });
  } catch (err) {
    console.error('Start session error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// End session
router.post('/end-session', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('status', 'active')
      .single();

    if (!session) return res.status(400).json({ error: 'No active session' });

    // Delete Daily room
    if (session.room_name) {
      await fetch(`${DAILY_BASE}/rooms/${session.room_name}`, {
        method: 'DELETE',
        headers: DAILY_HEADERS()
      });
    }

    await supabase.from('sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', session.id);

    // Create new waiting session for next round
    await ensureActiveSession();

    res.json({ message: 'Session ended' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update DM notes
router.put('/notes', dmMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .in('status', ['waiting', 'active'])
      .single();

    if (!session) return res.status(404).json({ error: 'No session' });

    await supabase.from('sessions')
      .update({ dm_notes: notes })
      .eq('id', session.id);

    res.json({ message: 'Notes saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get session URL (for players to join call)
router.get('/room-url', dmMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('room_url, status')
      .eq('status', 'active')
      .single();

    res.json({ roomUrl: session?.room_url || null, status: session?.status || 'waiting' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

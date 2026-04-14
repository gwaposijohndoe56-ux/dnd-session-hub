const express = require('express');
const { supabase } = require('../db/supabase');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// Get current active session + queue
router.get('/current', authMiddleware, async (req, res) => {
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
      .neq('status', 'kicked');

    res.json({ session, queue: queue || [] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Join queue
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id, status, invite_code')
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) return res.status(404).json({ error: 'No active session found' });
    if (session.status === 'active') return res.status(400).json({ error: 'Session already in progress' });

    // Check if already in queue
    const { data: existing } = await supabase
      .from('queue')
      .select('id, status')
      .eq('player_id', req.user.id)
      .eq('session_id', session.id)
      .single();

    if (existing) {
      if (existing.status === 'kicked') {
        return res.status(403).json({ error: 'You have been removed from this session' });
      }
      return res.json({ message: 'Already in queue', sessionId: session.id });
    }

    await supabase.from('queue').insert({
      player_id: req.user.id,
      session_id: session.id,
      status: 'waiting'
    });

    res.json({ message: 'Joined queue', sessionId: session.id });
  } catch (err) {
    console.error('Join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Leave queue
router.post('/leave', authMiddleware, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .eq('status', 'waiting')
      .single();

    if (!session) return res.json({ message: 'No session to leave' });

    await supabase.from('queue')
      .delete()
      .eq('player_id', req.user.id)
      .eq('session_id', session.id);

    res.json({ message: 'Left queue' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get chat messages
router.get('/chat', authMiddleware, async (req, res) => {
  try {
    const { data: messages } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('channel', 'tavern')
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

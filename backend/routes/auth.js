const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../db/supabase');
const router = express.Router();

// Player Register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  // Reserve DM username
  if (username.toLowerCase() === process.env.DM_USERNAME?.toLowerCase()) {
    return res.status(400).json({ error: 'Username reserved' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const colors = ['#8B5CF6','#EC4899','#10B981','#F59E0B','#3B82F6','#EF4444','#14B8A6'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const { data, error } = await supabase
      .from('players')
      .insert({ username, password_hash: hash, avatar_color: avatarColor })
      .select('id, username, avatar_color')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Username already taken' });
      throw error;
    }

    const token = jwt.sign(
      { id: data.id, username: data.username, avatarColor: data.avatar_color, isDM: false },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: data.id, username: data.username, avatarColor: data.avatar_color, isDM: false } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Player Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { data: player, error } = await supabase
      .from('players')
      .select('id, username, password_hash, avatar_color')
      .eq('username', username)
      .single();

    if (error || !player) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, player.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: player.id, username: player.username, avatarColor: player.avatar_color, isDM: false },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: player.id, username: player.username, avatarColor: player.avatar_color, isDM: false } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DM Login
router.post('/dm-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });

  const dmUser = process.env.DM_USERNAME || 'dungeonmaster';
  const dmPass = process.env.DM_PASSWORD || 'dm_password_123';

  if (username !== dmUser) return res.status(401).json({ error: 'Invalid credentials' });

  try {
    // DM password is bcrypt hashed in env or plain for dev
    let valid = false;
    if (dmPass.startsWith('$2')) {
      valid = await bcrypt.compare(password, dmPass);
    } else {
      valid = password === dmPass;
    }

    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: 'dm', username: 'Dungeon Master', isDM: true },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, user: { id: 'dm', username: 'Dungeon Master', isDM: true } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

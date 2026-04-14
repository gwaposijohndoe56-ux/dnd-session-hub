const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize database tables
async function initDB() {
  // Create tables via raw SQL using Supabase
  const tables = [
    `CREATE TABLE IF NOT EXISTS players (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#8B5CF6',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      room_name TEXT UNIQUE,
      room_url TEXT,
      status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','active','ended')),
      dm_notes TEXT DEFAULT '',
      invite_code TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS queue (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','approved','in_session','kicked')),
      is_muted BOOLEAN DEFAULT false,
      can_speak BOOLEAN DEFAULT true,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(player_id, session_id)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT DEFAULT 'tavern' CHECK (channel IN ('tavern','dm_private')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  ];

  for (const sql of tables) {
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error && !error.message.includes('already exists')) {
      // Tables might already exist - try direct query
      console.log('Table init note:', error.message);
    }
  }

  // Ensure there's always an active session
  await ensureActiveSession();
}

async function ensureActiveSession() {
  const { data } = await supabase
    .from('sessions')
    .select('id')
    .eq('status', 'waiting')
    .single();

  if (!data) {
    const inviteCode = 'DRAG' + Math.random().toString(36).substring(2, 6).toUpperCase();
    await supabase.from('sessions').insert({
      status: 'waiting',
      invite_code: inviteCode,
      dm_notes: ''
    });
  }
}

module.exports = { supabase, initDB, ensureActiveSession };

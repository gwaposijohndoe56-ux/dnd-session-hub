-- ═══════════════════════════════════════════════════════════════
-- DnD Session Hub — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Players ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color  TEXT DEFAULT '#8B5CF6',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_name    TEXT UNIQUE,
  room_url     TEXT,
  status       TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','active','ended')),
  dm_notes     TEXT DEFAULT '',
  invite_code  TEXT UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ
);

-- ── Queue ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id   UUID REFERENCES players(id) ON DELETE CASCADE,
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
  status      TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','approved','in_session','kicked')),
  is_muted    BOOLEAN DEFAULT false,
  can_speak   BOOLEAN DEFAULT true,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, session_id)
);

-- ── Chat Messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  message    TEXT NOT NULL,
  channel    TEXT DEFAULT 'tavern' CHECK (channel IN ('tavern','dm_private')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security (optional but recommended) ─────────────────
-- Disable RLS for service role (backend uses service key, bypasses RLS)
ALTER TABLE players      DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE queue        DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_queue_session   ON queue(session_id);
CREATE INDEX IF NOT EXISTS idx_queue_player    ON queue(player_id);
CREATE INDEX IF NOT EXISTS idx_chat_channel    ON chat_messages(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- ── Initial Session ───────────────────────────────────────────────
INSERT INTO sessions (status, invite_code, dm_notes)
VALUES ('waiting', 'DRAG' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 4)), '')
ON CONFLICT DO NOTHING;

-- Done! ✓
SELECT 'Schema created successfully' AS status;

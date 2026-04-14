# ⚔ DnD Session Hub

> A real-time D&D session management system — Google Meet for Dungeons & Dragons.
> Fantasy-themed UI with actual live video calls, queue management, and DM controls.

---

## 🏰 Features

- **Player Accounts** — Register/login with hashed passwords
- **Session Queue** — Join, leave, see your status (waiting → approved → in session)
- **Real-time Chat** — Tavern chat synced across all players via Socket.IO
- **DM Control Panel** — Protected login, approve/kick/mute players, speaker control
- **Live Video Calls** — Real WebRTC via Daily.co, auto-launched when DM starts session
- **DM Notes** — Private notes panel, auto-saved
- **Invite Codes** — Shareable session codes
- **Fantasy UI** — Cinzel typeface, dark tavern aesthetic, torch glow effects

---

## 📁 Structure

```
dnd-session-hub/
├── backend/
│   ├── server.js           # Express + Socket.IO main server
│   ├── routes/
│   │   ├── auth.js         # Register, login, DM login
│   │   ├── session.js      # Queue join/leave, chat history
│   │   └── dm.js           # DM controls, session start/end
│   ├── middleware/
│   │   └── auth.js         # JWT + DM guard
│   ├── db/
│   │   └── supabase.js     # Supabase client + DB init
│   ├── .env                # Your environment variables (DO NOT COMMIT)
│   └── package.json
├── frontend/
│   ├── index.html          # Player lobby
│   ├── dm.html             # DM control panel
│   ├── call.html           # Live video session (Daily.co)
│   ├── css/style.css       # Full fantasy theme
│   └── js/
│       ├── config.js       # Backend URL config
│       ├── app.js          # Player logic
│       └── dm.js           # DM panel logic
├── supabase-schema.sql     # Run this in Supabase SQL Editor
├── .env.example
└── README.md
```

---

## 🚀 Setup

### Step 1 — Supabase Database

1. Go to [supabase.com](https://supabase.com) → Your Project → **SQL Editor**
2. Paste the contents of `supabase-schema.sql` and click **Run**
3. This creates all tables and the first session

### Step 2 — Backend

```bash
cd backend
npm install
# .env is already configured with your keys
node server.js
```

Backend runs on `http://localhost:3001`

### Step 3 — Frontend

Open `frontend/index.html` in a browser, or serve it with any static server:

```bash
# Option A: VS Code Live Server extension (easiest)
# Right-click index.html → Open with Live Server

# Option B: Python
cd frontend
python -m http.server 5500

# Option C: npx
cd frontend
npx serve .
```

### Step 4 — Login as DM

- Go to `dm.html`
- Username: `dungeonmaster`
- Password: `dungeon_master_2024`

> **Change these in `backend/.env`** → `DM_USERNAME` and `DM_PASSWORD`

---

## 🌐 Deploying to GitHub + Render

### Backend (Render.com — free tier)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Add all environment variables from `backend/.env`
6. Copy the Render URL (e.g. `https://dnd-hub.onrender.com`)

### Frontend (GitHub Pages or Netlify)

1. Update `frontend/js/config.js`:
   ```js
   const CONFIG = {
     BACKEND_URL: 'https://your-backend.onrender.com'
   };
   ```
2. Push to GitHub
3. GitHub Pages: Settings → Pages → Deploy from `frontend/` folder
4. OR: Netlify → Drag & drop the `frontend/` folder

---

## 🎲 How It Works

### Player Flow
1. Register/login at `index.html`
2. Click **Join Queue** — you appear in the session queue
3. DM sees you and clicks **Approve**
4. DM clicks **Start Session** — Daily.co room is created
5. You get a **Enter the Session** button → redirected to `call.html`
6. Real WebRTC video call begins inside the fantasy UI

### DM Flow
1. Login at `dm.html`
2. See all players in queue with their status
3. Approve, kick, mute/unmute individual players
4. Click **Start Session** → creates Daily.co room, notifies all players
5. Use DM Notes for private session notes (auto-saved)
6. Click **End Session** → dismisses all players, resets queue

---

## 🔐 Security Notes

- Player passwords: bcrypt hashed (12 rounds)
- DM password: plaintext in .env for dev — hash it for production:
  ```js
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('your_password', 12);
  // Set DM_PASSWORD=<hash> in .env
  ```
- JWT tokens expire in 24h (players) / 12h (DM)
- Never commit `.env` to GitHub — add it to `.gitignore`

---

## 🛠 Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Backend port (default: 3001) |
| `JWT_SECRET` | Secret for JWT signing — make it long & random |
| `DM_USERNAME` | DM login username |
| `DM_PASSWORD` | DM login password (or bcrypt hash) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (backend only) |
| `DAILY_API_KEY` | Daily.co API key |
| `FRONTEND_URL` | Frontend origin for CORS (use `*` for dev) |

---

## 📜 License

Built for the party. Roll for initiative.

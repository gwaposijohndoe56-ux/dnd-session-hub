// ─── Frontend Config ───────────────────────────────────────────────────────
// Change BACKEND_URL to your deployed backend URL when hosting
// For local dev: http://localhost:3001
// For production: https://your-backend.onrender.com

const CONFIG = {
  BACKEND_URL: 'http://localhost:3001',
  // Update this when you deploy the backend
};

// Auto-detect if running on same origin (for deployments)
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  // If deployed, assume backend is on same domain with /api prefix
  // OR override with your deployed backend URL below
  // CONFIG.BACKEND_URL = 'https://your-backend.onrender.com';
}

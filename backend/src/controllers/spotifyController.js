// Spotify Controller - Authorization Code Flow + Client Credentials for search
import db from '../config/database.js';
import crypto from 'crypto';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// Native (Capacitor) deep-link redirect vs web redirect. The redirect_uri MUST
// be identical in the auth request and the token exchange, so both getAuthUrl
// and handleCallback resolve it the same way from the `native` flag.
//   • web    → SPOTIFY_REDIRECT_URI  (or FRONTEND_URL/spotify/callback)
//   • native → SPOTIFY_NATIVE_REDIRECT_URI (or jamie://spotify-callback)
// Both URIs must be registered in the Spotify dashboard's Redirect URIs list.
const NATIVE_FALLBACK_REDIRECT = 'jamie://spotify-callback';
const resolveRedirectUri = (isNative) =>
  isNative
    ? (process.env.SPOTIFY_NATIVE_REDIRECT_URI || NATIVE_FALLBACK_REDIRECT)
    : (process.env.SPOTIFY_REDIRECT_URI || `${process.env.FRONTEND_URL}/spotify/callback`);

// Default timeout for outbound Spotify calls so a hung Spotify endpoint can't
// pin a Node thread for the duration of the express request timeout.
const FETCH_TIMEOUT_MS = 8000;
const timedFetch = (url, opts = {}) =>
  fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });

// OAuth CSRF state — short-lived (10 min) and single-use. Stored in memory
// since this is a 1-instance flow; if we horizontally scale, move to Redis.
const _pendingStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [s, v] of _pendingStates) if (now > v.exp) _pendingStates.delete(s);
}, 5 * 60_000).unref();
const issueState = (userId) => {
  const state = crypto.randomBytes(24).toString('hex');
  _pendingStates.set(state, { userId, exp: Date.now() + 10 * 60_000 });
  return state;
};
// Returns the userId the state was issued to (or null if invalid/expired).
// Deriving identity from the server-side state mapping is what lets the OAuth
// flow complete inside an isolated in-app browser (iOS home-screen PWA) that
// doesn't carry the auth cookie.
const consumeState = (state) => {
  if (!state || typeof state !== 'string') return null;
  const entry = _pendingStates.get(state);
  if (!entry || Date.now() > entry.exp) return null;
  _pendingStates.delete(state);
  return entry.userId;
};

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-top-read',
  'user-read-recently-played'
].join(' ');

// ==========================================
// CLIENT CREDENTIALS (for search - no user login needed)
// ==========================================
let cachedClientToken = null;
let clientTokenExpiry = 0;

const getClientToken = async () => {
  if (cachedClientToken && Date.now() < clientTokenExpiry) {
    return cachedClientToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const res = await timedFetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
      console.error('Spotify client token error:', res.status);
      return null;
    }

    const data = await res.json();
    cachedClientToken = data.access_token;
    clientTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedClientToken;
  } catch (err) {
    console.error('Spotify client token fetch error:', err);
    return null;
  }
};

// ==========================================
// AUTHORIZATION CODE FLOW (for user-specific data)
// ==========================================

// Step 1: Generate Spotify login URL
export const getAuthUrl = (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const isNative = req.query.native === '1' || req.query.native === 'true';
  const redirectUri = resolveRedirectUri(isNative);

  if (!clientId) {
    return res.status(500).json({ error: 'Spotify nicht konfiguriert' });
  }

  // Cryptographically random state pinned to the issuing user — verified in
  // handleCallback. Without this, an attacker can craft an auth URL that
  // links *their* Spotify account to *another* user's JAMIE account.
  const state = issueState(req.userId);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'true'
  });

  res.json({ url: `${SPOTIFY_AUTH_URL}?${params.toString()}` });
};

// Step 2: Exchange authorization code for tokens
export const handleCallback = async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Autorisierungscode fehlt' });
  }

  // Identity comes from the state's server-side mapping, NOT the request auth.
  // The state is a single-use, 10-min, per-user nonce issued by getAuthUrl, so
  // a valid one proves the initiating user — this is what lets the callback
  // finish from an isolated in-app browser (iOS PWA) with no auth cookie.
  const stateUserId = consumeState(state);
  if (!stateUserId) {
    return res.status(400).json({ error: 'Ungültiger oder abgelaufener State-Parameter' });
  }
  // Defense in depth: if the caller IS authenticated, it must be the same user.
  if (req.userId && Number(req.userId) !== Number(stateUserId)) {
    return res.status(400).json({ error: 'State stimmt nicht mit dem angemeldeten Nutzer überein' });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  // Must match the redirect_uri used in getAuthUrl for this same flow.
  const isNative = req.body.native === true || req.body.native === '1';
  const redirectUri = resolveRedirectUri(isNative);

  try {
    const tokenRes = await timedFetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      }).toString()
    });

    if (!tokenRes.ok) {
      const errData = await tokenRes.json();
      console.error('Spotify token exchange error:', errData);
      return res.status(400).json({ error: 'Token-Austausch fehlgeschlagen' });
    }

    const tokenData = await tokenRes.json();

    const userId = stateUserId;

    // Store tokens in database
    await db.query(
      `UPDATE users SET
        spotify_access_token = $1,
        spotify_refresh_token = $2,
        spotify_token_expiry = $3,
        spotify_connected = true,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
      [
        tokenData.access_token,
        tokenData.refresh_token,
        new Date(Date.now() + tokenData.expires_in * 1000),
        userId
      ]
    );

    // Fetch Spotify profile
    let spotifyProfile = null;
    try {
      const profileRes = await timedFetch(`${SPOTIFY_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (profileRes.ok) {
        spotifyProfile = await profileRes.json();
      }
    } catch (e) { /* ignore */ }

    res.json({
      success: true,
      message: 'Spotify erfolgreich verbunden!',
      spotify_profile: spotifyProfile ? {
        display_name: spotifyProfile.display_name,
        image: spotifyProfile.images?.[0]?.url
      } : null
    });
  } catch (error) {
    console.error('Spotify callback error:', error);
    res.status(500).json({ error: 'Spotify-Verbindung fehlgeschlagen' });
  }
};

// Refresh user's access token
const refreshUserToken = async (userId) => {
  const userRes = await db.query(
    'SELECT spotify_refresh_token FROM users WHERE id = $1',
    [userId]
  );

  const refreshToken = userRes.rows[0]?.spotify_refresh_token;
  if (!refreshToken) return null;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  try {
    const tokenRes = await timedFetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });

    if (!tokenRes.ok) {
      console.error('Spotify refresh error:', tokenRes.status);
      await db.query('UPDATE users SET spotify_connected = false WHERE id = $1', [userId]);
      return null;
    }

    const data = await tokenRes.json();

    await db.query(
      `UPDATE users SET
        spotify_access_token = $1,
        spotify_token_expiry = $2,
        spotify_refresh_token = COALESCE($3, spotify_refresh_token),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
      [
        data.access_token,
        new Date(Date.now() + data.expires_in * 1000),
        data.refresh_token || null,
        userId
      ]
    );

    return data.access_token;
  } catch (err) {
    console.error('Spotify refresh fetch error:', err);
    return null;
  }
};

// Get a valid user access token (auto-refresh if expired)
const getUserToken = async (userId) => {
  const userRes = await db.query(
    'SELECT spotify_access_token, spotify_token_expiry, spotify_connected FROM users WHERE id = $1',
    [userId]
  );

  const user = userRes.rows[0];
  if (!user?.spotify_connected) return null;

  if (user.spotify_token_expiry && new Date(user.spotify_token_expiry) > new Date(Date.now() + 60000)) {
    return user.spotify_access_token;
  }

  return await refreshUserToken(userId);
};

// ==========================================
// API ENDPOINTS
// ==========================================

// Search tracks (Client Credentials - no user login needed)
export const searchTracks = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Suchbegriff muss mindestens 2 Zeichen lang sein' });
    }
    if (query.length > 200) {
      return res.status(400).json({ error: 'Suchbegriff zu lang' });
    }

    const token = await getClientToken();

    if (token) {
      const spotifyRes = await timedFetch(
        `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=track&limit=10&market=AT`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (spotifyRes.ok) {
        const data = await spotifyRes.json();
        const items = (data.tracks?.items || []).map(formatTrack);
        return res.json({ items });
      }
      console.error('Spotify search error:', spotifyRes.status);
    }

    res.json({ items: getFallbackResults(query) });
  } catch (error) {
    console.error('Spotify search error:', error);
    res.status(500).json({ error: 'Spotify-Suche fehlgeschlagen' });
  }
};

// Get user's top tracks (Authorization Code Flow required)
export const getTopTracks = async (req, res) => {
  try {
    const token = await getUserToken(req.userId);

    if (!token) {
      return res.status(401).json({ error: 'Spotify nicht verbunden', requiresAuth: true });
    }

    const timeRange = req.query.time_range || 'medium_term';
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const spotifyRes = await timedFetch(
      `${SPOTIFY_API_BASE}/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!spotifyRes.ok) {
      if (spotifyRes.status === 401) {
        const newToken = await refreshUserToken(req.userId);
        if (newToken) {
          const retryRes = await timedFetch(
            `${SPOTIFY_API_BASE}/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
            { headers: { Authorization: `Bearer ${newToken}` } }
          );
          if (retryRes.ok) {
            const data = await retryRes.json();
            return res.json({ items: (data.items || []).map(formatTrack) });
          }
        }
        return res.status(401).json({ error: 'Spotify-Sitzung abgelaufen', requiresAuth: true });
      }
      return res.status(spotifyRes.status).json({ error: 'Spotify-Fehler' });
    }

    const data = await spotifyRes.json();
    res.json({ items: (data.items || []).map(formatTrack) });
  } catch (error) {
    console.error('Spotify top tracks error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Top-Tracks' });
  }
};

// Get user's recently played
export const getRecentlyPlayed = async (req, res) => {
  try {
    const token = await getUserToken(req.userId);

    if (!token) {
      return res.status(401).json({ error: 'Spotify nicht verbunden', requiresAuth: true });
    }

    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const spotifyRes = await timedFetch(
      `${SPOTIFY_API_BASE}/me/player/recently-played?limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!spotifyRes.ok) {
      return res.status(spotifyRes.status).json({ error: 'Spotify-Fehler' });
    }

    const data = await spotifyRes.json();
    const items = (data.items || []).map(item => ({
      ...formatTrack(item.track),
      played_at: item.played_at
    }));

    res.json({ items });
  } catch (error) {
    console.error('Spotify recently played error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der zuletzt gespielten Tracks' });
  }
};

// Disconnect Spotify
export const disconnect = async (req, res) => {
  try {
    await db.query(
      `UPDATE users SET
        spotify_access_token = NULL,
        spotify_refresh_token = NULL,
        spotify_token_expiry = NULL,
        spotify_connected = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
      [req.userId]
    );
    res.json({ success: true, message: 'Spotify wurde getrennt' });
  } catch (error) {
    console.error('Spotify disconnect error:', error);
    res.status(500).json({ error: 'Fehler beim Trennen von Spotify' });
  }
};

// Get connection status
export const getStatus = async (req, res) => {
  try {
    const userRes = await db.query(
      'SELECT spotify_connected FROM users WHERE id = $1',
      [req.userId]
    );
    res.json({ connected: userRes.rows[0]?.spotify_connected || false });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Prüfen des Spotify-Status' });
  }
};

// ==========================================
// HELPERS
// ==========================================

function formatTrack(track) {
  return {
    id: track.id,
    title: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    album: track.album.name,
    cover: track.album.images?.[0]?.url || null,
    preview_url: track.preview_url
  };
}

function getFallbackResults(query) {
  const q = query.toLowerCase();
  const allSongs = [
    { id: 'demo-1', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', cover: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36', preview_url: null },
    { id: 'demo-2', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', cover: 'https://i.scdn.co/image/ab67616d0000b27377f5c6a13f1b8b3de90b1255', preview_url: null },
    { id: 'demo-3', title: 'Shape of You', artist: 'Ed Sheeran', album: 'Divide', cover: 'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96', preview_url: null },
    { id: 'demo-4', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', cover: 'https://i.scdn.co/image/ab67616d0000b2730b51f8d91f3a21e8426361ae', preview_url: null },
    { id: 'demo-5', title: 'Lose Yourself', artist: 'Eminem', album: '8 Mile', cover: 'https://i.scdn.co/image/ab67616d0000b2736ca5c90113b30c3c43ffb8f4', preview_url: null },
    { id: 'demo-6', title: 'Starboy', artist: 'The Weeknd', album: 'Starboy', cover: 'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc452', preview_url: null },
    { id: 'demo-7', title: 'Don\'t Start Now', artist: 'Dua Lipa', album: 'Future Nostalgia', cover: 'https://i.scdn.co/image/ab67616d0000b27377f5c6a13f1b8b3de90b1255', preview_url: null },
    { id: 'demo-8', title: 'Watermelon Sugar', artist: 'Harry Styles', album: 'Fine Line', cover: 'https://i.scdn.co/image/ab67616d0000b27377fdcfda6535601aff081b6a', preview_url: null },
  ];

  return allSongs.filter(s =>
    s.title.toLowerCase().includes(q) ||
    s.artist.toLowerCase().includes(q) ||
    s.album.toLowerCase().includes(q)
  ).slice(0, 5);
}

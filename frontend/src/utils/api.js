import axios from 'axios';
import { isNative, isNativeIOS, NATIVE_API_ORIGIN } from './platform';

// ==========================================
// AXIOS INSTANCE SETUP
// ==========================================

// Native: NEVER use a relative base — the WebView origin is served locally by
// Capacitor, so relative /api calls get index.html back (see NATIVE_API_ORIGIN
// in platform.js for the App-Review incident). Web keeps the same-origin path.
const API_URL = isNative()
  ? `${NATIVE_API_ORIGIN}/api`
  : (import.meta.env.VITE_API_URL || '/api');

const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 10000,
  withCredentials: true, // send httpOnly auth cookie on every request
});

// In-memory token — set by AuthContext after login/refresh (never stored in localStorage)
let _memToken = null;
export const setMemToken = (t) => { _memToken = t; };
export const clearMemToken = () => { _memToken = null; };

// Request Interceptor — adds Authorization header for Socket.IO compat + Capacitor native fallback.
// REST calls are also covered by the httpOnly auth_token cookie sent automatically.
axiosInstance.interceptors.request.use(
  (config) => {
    if (_memToken) {
      config.headers.Authorization = `Bearer ${_memToken}`;
    }
    // Mark requests coming from the installed native app. The backend exempts
    // native traffic from the DACH registration geofence: anyone who installed
    // JAMIE from the App Store / Play Store is a target user regardless of
    // country, and store reviewers sit outside Austria — a 403 on /register
    // reads as "the app is broken" (App Review 2.1). The web PWA sends no such
    // header and keeps its Austria-only signup gate.
    if (isNative()) {
      config.headers['X-Client-Platform'] = isNativeIOS() ? 'ios' : 'android';
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Retry logic with exponential backoff
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const SAFE_METHODS = new Set(['get', 'head', 'options']);

const shouldRetry = (error) => {
  // Never retry non-idempotent methods — prevents double billing, double messages, etc.
  const method = error.config?.method?.toLowerCase();
  if (!SAFE_METHODS.has(method)) return false;
  if (!error.response) return true; // Network error / timeout
  const status = error.response.status;
  return status === 408 || status === 429 || status >= 500;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Response Interceptor - Handle errors + retry
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    if (shouldRetry(error) && config && !config._retryCount) {
      config._retryCount = 0;
    }

    if (shouldRetry(error) && config && config._retryCount < MAX_RETRIES) {
      config._retryCount += 1;
      const delay = RETRY_DELAY * Math.pow(2, config._retryCount - 1) + Math.random() * 500;
      await sleep(delay);
      return axiosInstance(config);
    }

    // 401 handling — clear in-memory token and redirect to login.
    // IMPORTANT: a 401 from an auth attempt (wrong password, etc.) is an
    // EXPECTED response, NOT an expired session. Skip the redirect/token-clear
    // for those so the page never reloads — the calling component shows the
    // error itself. Otherwise the reload wiped the "Passwort falsch" message
    // before the user could see it.
    const reqUrl = error.config?.url || '';
    const isAuthAttempt = /\/auth\/(login|register|google|refresh|apple)/.test(reqUrl);

    // Guest dead-end rescue: a guest who taps an account-only WRITE action
    // (create club, upload photo, create event, join…) gets a 401 "Guest access
    // is disabled" from the backend. Left alone the calling screen shows that
    // raw English error and the user is stuck (a club partner hit exactly this).
    // Bounce them to registration with a flag the auth screen surfaces, so the
    // dead-end becomes a clear "create a free account to continue" path. Scoped
    // to write methods so background GETs never yank a browsing guest away.
    const reqMethod = (error.config?.method || '').toLowerCase();
    const isWriteMethod = !SAFE_METHODS.has(reqMethod);
    if (!isAuthAttempt && isWriteMethod && error.response?.status === 401 && _memToken === 'guest_token') {
      try { sessionStorage.setItem('jamie_guest_blocked', '1'); } catch { /* private mode */ }
      const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
      if (!publicPaths.some(p => window.location.pathname === p || window.location.pathname.startsWith(p + '/'))) {
        window.location.href = '/register';
      }
      return Promise.reject(error);
    }

    if (!isAuthAttempt && error.response?.status === 401 && _memToken !== 'guest_token') {
      clearMemToken();
      const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
      if (!publicPaths.some(p => window.location.pathname === p || window.location.pathname.startsWith(p + '/'))) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ==========================================
// AUTH API
// ==========================================

export const auth = {
  register: (email, password, name, referral_code, date_of_birth) =>
    axiosInstance.post('/auth/register', { email, password, name, date_of_birth, ...(referral_code ? { referral_code } : {}) }),
  
  login: (email, password) => 
    axiosInstance.post('/auth/login', { email, password }),
  
  getProfile: () => 
    axiosInstance.get('/auth/profile'),
  
  updateProfile: (data) => 
    axiosInstance.put('/auth/profile', data),
  
  completeOnboarding: (data) =>
    axiosInstance.put('/auth/onboarding', data),

  changePassword: (currentPassword, newPassword) =>
    axiosInstance.put('/auth/password', { currentPassword, newPassword }),

  deleteAccount: (password) =>
    axiosInstance.delete('/auth/account', { data: { password } }),

  exportData: () =>
    axiosInstance.get('/auth/export'),

  forgotPassword: (email) =>
    axiosInstance.post('/auth/forgot-password', { email }),

  resetPassword: (token, newPassword) =>
    axiosInstance.post('/auth/reset-password', { token, newPassword }),

  sendVerification: () =>
    axiosInstance.post('/auth/send-verification'),

  verifyEmail: (token) =>
    axiosInstance.post('/auth/verify-email', { token }),

  sendEmailCode: (email, name) =>
    axiosInstance.post('/auth/send-email-code', { email, name }),

  verifyEmailCode: (email, code) =>
    axiosInstance.post('/auth/verify-email-code', { email, code }),

  googleLogin: (credential) =>
    axiosInstance.post('/auth/google', { credential }),

  // Apple Sign-In. `identity_token` is the JWS from Apple; `user` is
  // populated only on the very first authorization (first-name/last-name) —
  // Apple never sends it again, so we forward it once for account creation.
  appleLogin: (identity_token, user) =>
    axiosInstance.post('/auth/apple', { identity_token, user }),

  refresh: () =>
    axiosInstance.post('/auth/refresh', {}, { _isRefresh: true }),

  logout: () =>
    axiosInstance.post('/auth/logout'),
};

/**
 * Restore session on app startup using the httpOnly auth cookie.
 * Returns a fresh token (for Socket.IO) or null if no session exists.
 */
export const restoreSession = async () => {
  try {
    const { data } = await auth.refresh();
    return data.token || null;
  } catch {
    return null;
  }
};

// ==========================================
// USERS API
// ==========================================

export const users = {
  getById: (id) => 
    axiosInstance.get(`/users/${id}`),
  
  search: (query, config = {}) =>
    axiosInstance.get('/users/search', { params: { q: query }, ...config })
};

// ==========================================
// GROUPS API
// ==========================================

export const groups = {
  // Get all groups (type = 'group')
  getAll: (params = {}) => {
    const { search, category, location, upcoming, limit, offset } = params;
    return axiosInstance.get('/groups', { 
      params: { type: 'group', search, category, location, upcoming, limit, offset } 
    });
  },
  
  // Get single group
  getById: (id) => 
    axiosInstance.get(`/groups/${id}`),
  
  // Create new group/club
  create: (data) => {
    // Handle both FormData and plain object
    if (data instanceof FormData) {
      return axiosInstance.post('/groups', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    }
    return axiosInstance.post('/groups', data);
  },
  
  // Update group
  update: (id, data) => 
    axiosInstance.put(`/groups/${id}`, data),
  
  // Delete group
  delete: (id) => 
    axiosInstance.delete(`/groups/${id}`),
  
  // Join group
  join: (id, message) => 
    axiosInstance.post(`/groups/${id}/join`, { message }),
  
  // Leave group
  leave: (id) => 
    axiosInstance.post(`/groups/${id}/leave`),
  
  // Toggle favorite
  toggleFavorite: (id) => 
    axiosInstance.post(`/groups/${id}/favorite`),
  
  // Get user's favorites
  getFavorites: () =>
    axiosInstance.get('/groups/user/favorites'),

  // Public likes (Hall-of-Fame moments) — distinct from favorites.
  toggleLike: (id) => axiosInstance.post(`/groups/${id}/like`),
  getMyLikes: () => axiosInstance.get('/groups/likes/mine'),

  // Get user's joined groups
  // fresh=true bypasses the backend's 15s cache — used by the nav unread
  // badge, which must reflect read markers immediately.
  getJoined: (fresh = false) =>
    axiosInstance.get('/groups/user/joined', { params: fresh ? { fresh: '1' } : {} }),

  // Hide/unhide a group-or-club chat from the chat list (per-user)
  archiveChat: (id, archived) =>
    axiosInstance.put(`/groups/${id}/archive`, { archived }),

  // Get group members
  getMembers: (id) => 
    axiosInstance.get(`/groups/${id}/members`),
  
  // Get categories
  getCategories: () => 
    axiosInstance.get('/groups/categories'),
  
  // Join Requests (for group owners)
  getRequests: (groupId) =>
    axiosInstance.get(`/groups/${groupId}/requests`),

  handleRequest: (groupId, requestId, action) =>
    axiosInstance.post(`/groups/${groupId}/requests/${requestId}`, { action }),

  // Waitlist operations
  joinWaitlist: (id) =>
    axiosInstance.post(`/groups/${id}/waitlist/join`),

  leaveWaitlist: (id) =>
    axiosInstance.post(`/groups/${id}/waitlist/leave`),

  getWaitlist: (id) =>
    axiosInstance.get(`/groups/${id}/waitlist`),

  getWaitlistStatus: (id) =>
    axiosInstance.get(`/groups/${id}/waitlist/status`),

  // Kick/remove member (owner only)
  kickMember: (groupId, userId) =>
    axiosInstance.delete(`/groups/${groupId}/members/${userId}`),

  // Invite a friend directly into the group (owner only)
  invite: (groupId, friendId) =>
    axiosInstance.post(`/groups/${groupId}/invite/${friendId}`),

  // Get member avatars for card display
  getMemberAvatars: (id, limit = 4) =>
    axiosInstance.get(`/groups/${id}/members/avatars`, { params: { limit } })
};

// ==========================================
// CLUBS API
// ==========================================

export const clubs = {
  // Get all clubs
  getAll: (params = {}) => {
    const { search, category, location, featured, limit, offset } = params;
    return axiosInstance.get('/clubs', {
      params: { search, category, location, featured, limit, offset }
    });
  },

  // Get single club
  getById: (id) =>
    axiosInstance.get(`/clubs/${id}`),

  // Create new club
  create: (data) => {
    if (data instanceof FormData) {
      return axiosInstance.post('/clubs', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    }
    return axiosInstance.post('/clubs', data);
  },

  // Update club
  update: (id, data) =>
    axiosInstance.put(`/clubs/${id}`, data),

  // Delete club
  delete: (id) =>
    axiosInstance.delete(`/clubs/${id}`),

  // Join club
  join: (id, message) =>
    axiosInstance.post(`/clubs/${id}/join`, { message }),

  // Leave club
  leave: (id) =>
    axiosInstance.post(`/clubs/${id}/leave`),

  // Toggle favorite
  toggleFavorite: (id) =>
    axiosInstance.post(`/clubs/${id}/favorite`),

  // Get user's favorite clubs
  getFavorites: () =>
    axiosInstance.get('/clubs/user/favorites'),

  // Get user's joined clubs
  getJoined: () =>
    axiosInstance.get('/clubs/user/joined'),

  // Get club members
  getMembers: (id) =>
    axiosInstance.get(`/clubs/${id}/members`),

  // Get categories
  getCategories: () =>
    axiosInstance.get('/clubs/categories'),

  // Join Requests (for club owners)
  getRequests: (clubId) =>
    axiosInstance.get(`/clubs/${clubId}/requests`),

  handleRequest: (clubId, requestId, action) =>
    axiosInstance.post(`/clubs/${clubId}/requests/${requestId}`, { action }),

  // Waitlist operations
  joinWaitlist: (id) =>
    axiosInstance.post(`/clubs/${id}/waitlist/join`),

  leaveWaitlist: (id) =>
    axiosInstance.post(`/clubs/${id}/waitlist/leave`),

  getWaitlist: (id) =>
    axiosInstance.get(`/clubs/${id}/waitlist`),

  getWaitlistStatus: (id) =>
    axiosInstance.get(`/clubs/${id}/waitlist/status`),

  // Kick/remove member (owner only)
  kickMember: (clubId, userId) =>
    axiosInstance.delete(`/clubs/${clubId}/members/${userId}`),

  // Co-managers (owner only) — promote a member to / demote from shared management
  addManager: (clubId, userId) =>
    axiosInstance.post(`/clubs/${clubId}/managers`, { userId }),
  removeManager: (clubId, userId) =>
    axiosInstance.delete(`/clubs/${clubId}/managers/${userId}`),

  // Get member avatars for card display
  getMemberAvatars: (id, limit = 4) =>
    axiosInstance.get(`/clubs/${id}/members/avatars`, { params: { limit } }),

  // Club events
  getEvents: (clubId, past = false) =>
    axiosInstance.get(`/clubs/${clubId}/events`, { params: past ? { past: 'true' } : {} }),
  // Discover events from public clubs (Events feed + Events page)
  discoverEvents: () =>
    axiosInstance.get('/clubs/events/discover'),
  createEvent: (clubId, data) =>
    axiosInstance.post(`/clubs/${clubId}/events`, data),
  updateEvent: (clubId, eventId, data) =>
    axiosInstance.put(`/clubs/${clubId}/events/${eventId}`, data),
  deleteEvent: (clubId, eventId) =>
    axiosInstance.delete(`/clubs/${clubId}/events/${eventId}`),
};

// ==========================================
// MESSAGES API
// ==========================================

export const messages = {
  // Send message to group chat
  send: (groupId, content) =>
    axiosInstance.post('/messages', { groupId, content }),

  // Stamp the chat as read (ChatPage unmount — covers messages that arrived
  // while the chat was open; opening it already stamps via GET)
  markRead: (groupId) =>
    axiosInstance.post(`/messages/${groupId}/read`),
  
  // Get messages for a group. Pass `before` (message id) to load older messages.
  get: (groupId, { limit = 50, before } = {}) =>
    axiosInstance.get(`/messages/${groupId}`, { params: { limit, ...(before ? { before } : {}) } }),
  
  // Delete message
  delete: (messageId) => 
    axiosInstance.delete(`/messages/${messageId}`)
};

// ==========================================
// DIRECT MESSAGES API
// ==========================================

export const directMessages = {
  // Send DM
  send: (receiverId, content) => 
    axiosInstance.post('/dm', { receiverId, content }),
  
  // Get conversation with user
  getConversation: (userId, limit = 50, offset = 0) => 
    axiosInstance.get(`/dm/${userId}`, { params: { limit, offset } }),
  
  // Get all conversations list
  getConversations: () =>
    axiosInstance.get('/dm/conversations'),

  // Hide/unhide a DM conversation from the chat list (per-user)
  archiveConversation: (userId, archived) =>
    axiosInstance.put(`/dm/${userId}/archive`, { archived }),
  
  // Mark as read
  markRead: (userId) => 
    axiosInstance.post(`/dm/${userId}/read`)
};

// ==========================================
// FRIENDS API
// ==========================================

export const friends = {
  // Get all friends
  getAll: () =>
    axiosInstance.get('/friends'),

  // Send friend request
  sendRequest: (userId) =>
    axiosInstance.post('/friends/request', { userId }),

  // Respond to friend request (accept/reject)
  respondRequest: (requestId, action) =>
    axiosInstance.post(`/friends/request/${requestId}`, { action }),

  // Get pending incoming requests
  getPending: () =>
    axiosInstance.get('/friends/requests/pending'),

  // Get sent outgoing requests
  getSent: () =>
    axiosInstance.get('/friends/requests/sent'),

  // Check friendship status with a user
  getStatus: (userId) =>
    axiosInstance.get(`/friends/status/${userId}`),

  // Remove friend
  remove: (friendId) =>
    axiosInstance.delete(`/friends/${friendId}`),

  // Block / unblock
  block: (userId) =>
    axiosInstance.post('/friends/block', { userId }),
  unblock: (userId) =>
    axiosInstance.delete(`/friends/block/${userId}`),
  getBlocked: () =>
    axiosInstance.get('/friends/blocked')
};

// ==========================================
// NOTIFICATIONS API
// ==========================================

export const notifications = {
  getAll: () => 
    axiosInstance.get('/notifications'),
  
  markRead: () => 
    axiosInstance.post('/notifications/mark-read'),
  
  markSingleRead: (id) => 
    axiosInstance.post(`/notifications/${id}/read`)
};

// ==========================================
// SPOTIFY API
// ==========================================

export const spotify = {
  // config (e.g. { signal }) is forwarded so the caller's AbortController can
  // actually cancel in-flight searches — previously the 2nd arg was dropped.
  search: (query, config = {}) =>
    axiosInstance.get('/spotify/search', { params: { query }, ...config }),
  // opts.native=true → backend uses the Capacitor deep-link redirect_uri
  getAuthUrl: (opts = {}) =>
    axiosInstance.get('/spotify/auth-url', { params: opts.native ? { native: 1 } : {} }),
  handleCallback: (code, state, opts = {}) =>
    axiosInstance.post('/spotify/callback', { code, state, ...(opts.native ? { native: true } : {}) }),
  getTopTracks: (timeRange = 'medium_term', limit = 10) =>
    axiosInstance.get('/spotify/top-tracks', { params: { time_range: timeRange, limit } }),
  getRecentlyPlayed: (limit = 10) =>
    axiosInstance.get('/spotify/recently-played', { params: { limit } }),
  getStatus: () =>
    axiosInstance.get('/spotify/status'),
  disconnect: () =>
    axiosInstance.post('/spotify/disconnect')
};

// ==========================================
// REPORTS API
// ==========================================

export const reports = {
  create: (reported_type, reported_id, reason, details) =>
    axiosInstance.post('/reports', { reported_type, reported_id, reason, details }),
};

// ==========================================
// BOOST API
// ==========================================

export const boost = {
  getCredits: () => axiosInstance.get('/boost/credits'),
  getPackages: () => axiosInstance.get('/boost/packages'),
  // Widerruf-eligible boost purchases (Settings → Boost-Käufe).
  getPurchases: () => axiosInstance.get('/boost/purchases'),
  apply: (target_type, target_id, hours = 24) =>
    axiosInstance.post('/boost/apply', { target_type, target_id, hours }),
  createStripeIntent: (package_id) =>
    axiosInstance.post('/boost/stripe/create-intent', { package_id }),
  redeemReferral: (code) =>
    axiosInstance.post('/boost/redeem-referral', { code }),
};

// ==========================================
// FEATURE INTEREST API ("Benachrichtige mich" für Coming-Soon-Features)
// ==========================================

export const featureInterest = {
  get: () => axiosInstance.get('/feature-interest'),
  register: (feature) => axiosInstance.post('/feature-interest', { feature }),
};

// ==========================================
// IN-APP PURCHASE API (Apple StoreKit only)
// ==========================================

export const iap = {
  verifyApple: (payload) => axiosInstance.post('/iap/apple/verify', payload),
  restoreApple: (payload) => axiosInstance.post('/iap/apple/restore', payload),
};

// ==========================================
// PUSH API
// ==========================================

export const push = {
  getVapidKey: () => axiosInstance.get('/push/vapid-key'),
  subscribe: (subscription) => axiosInstance.post('/push/subscribe', subscription),
  unsubscribe: (endpoint) => axiosInstance.post('/push/unsubscribe', { endpoint }),
  saveApnsToken: (token) => axiosInstance.post('/push/apns-token', { token }),
};

// ==========================================
// ANALYTICS API
// ==========================================

export const analytics = {
  trackEvent: (event_type, screen_name, duration_ms, metadata, subject_id) =>
    axiosInstance.post('/analytics/event', { event_type, screen_name, duration_ms, metadata, subject_id }),
  suggestCategory: (suggestion) =>
    axiosInstance.post('/analytics/suggest-category', { suggestion }),
};

// ==========================================
// ADMIN API
// ==========================================

export const admin = {
  getStats: () => axiosInstance.get('/admin/stats'),
  // Searchable + paginated user list. Returns { users, total, limit, offset }.
  getUsers: ({ limit = 50, offset = 0, search = '' } = {}) =>
    axiosInstance.get('/admin/users', { params: { limit, offset, search } }),
  deleteUser: (id) => axiosInstance.delete(`/admin/users/${id}`),
  // Toggle roles. Send only the fields you want to change, e.g.
  // { is_admin: true } or { is_trusted_user: false }.
  setUserRole: (id, roles) => axiosInstance.patch(`/admin/users/${id}/role`, roles),
  getScreenTime: () => axiosInstance.get('/admin/screen-time'),
  // Per-user memberships + activity for the manage modal.
  getUserDetail: (id) => axiosInstance.get(`/admin/users/${id}/detail`),
  exportUsers: () => axiosInstance.get('/admin/export/users'),
  exportScreens: () => axiosInstance.get('/admin/export/screens'),
  exportSuggestions: () => axiosInstance.get('/admin/export/suggestions'),
  // Club approval queue (#14)
  getPendingClubs: () => axiosInstance.get('/admin/clubs/pending'),
  approveClub: (id) => axiosInstance.post(`/admin/clubs/${id}/approve`),
  rejectClub: (id) => axiosInstance.post(`/admin/clubs/${id}/reject`),
  // Live presence: users with an active Socket.IO connection right now.
  getOnlineUsers: () => axiosInstance.get('/admin/online-users'),
  // Per-club / per-group view rankings (analytics_events.subject_id ⨯ groups)
  getTopClubs: (days = 30, limit = 20) =>
    axiosInstance.get('/admin/top-clubs', { params: { days, limit } }),
  // Permanent daily growth rollup (DAU/MAU, retention cohorts, engagement).
  getGrowth: (days = 90) =>
    axiosInstance.get('/admin/growth', { params: { days } }),
};

// ==========================================
// SUBSCRIPTION API
// ==========================================

export const subscription = {
  getStatus: () => axiosInstance.get('/subscription/status'),
  // plan: 'weekly' | 'monthly' | 'sixmonth' (server validates + falls back to monthly)
  create: (plan) => axiosInstance.post('/subscription/create', plan ? { plan } : {}),
  cancel: () => axiosInstance.post('/subscription/cancel'),
  // 14-day right of withdrawal (Widerruf) — immediate cancel + full refund.
  withdraw: () => axiosInstance.post('/subscription/withdraw'),
  // Stripe Billing Portal — returns { url } for browser redirect. Server
  // rejects with 400 + managed_by:'apple' if the user's subscription was
  // bought via Apple IAP (App Store handles that path).
  openPortal: () => axiosInstance.post('/subscription/portal'),
};

// ==========================================
// REVIEWS API
// ==========================================

export const reviews = {
  getPending: () => axiosInstance.get('/reviews/pending'),
  submit: (group_id, attendances) => axiosInstance.post('/reviews', { group_id, attendances }),
};

// ==========================================
// UPLOAD API
// ==========================================

export const upload = {
  image: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return axiosInstance.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // uploads need more time than regular API calls
    });
  }
};

// ==========================================
// DEALS / COOPERATIONS API
// ==========================================
// Reads are available to everyone (no Pro gate as of 2026-06-09).
// Write endpoints require admin (enforced on the backend via requireAdmin).
export const deals = {
  getAll: ()        => axiosInstance.get('/deals'),
  getOne: (id)      => axiosInstance.get(`/deals/${id}`),
  // Redemption status / one-shot redeem — caller-scoped.
  getRedemptionStatus: (id) => axiosInstance.get(`/deals/${id}/redemption`),
  redeem:              (id) => axiosInstance.post(`/deals/${id}/redeem`),
  // Admin — includes inactive + expired + redemption_count per row.
  getAllForAdmin:   () => axiosInstance.get('/deals/admin/list'),
  getRedemptions: (id) => axiosInstance.get(`/deals/admin/${id}/redemptions`),
  create: (data)    => axiosInstance.post('/deals', data),
  update: (id, data)=> axiosInstance.put(`/deals/${id}`, data),
  remove: (id)      => axiosInstance.delete(`/deals/${id}`),
};

// ==========================================
// COMBINED API OBJECT
// ==========================================

// ==========================================
// MAP API
// ==========================================

export const map = {
  getPins: (params) => axiosInstance.get('/map/pins', { params }),
  // Austria geocode verifier — fallback when Google Places shows no dropdown.
  geocode: (q) => axiosInstance.get('/map/geocode', { params: { q } }),
};

// ==========================================
// WAITLIST API (international / geofencing)
// ==========================================
export const waitlist = {
  join:     (email, country) => axiosInstance.post('/waitlist', { email, country }),
  getVotes: ()               => axiosInstance.get('/waitlist/votes'),
};

// ==========================================
// SUGGESTIONS API — personalized groups/clubs
// ==========================================
export const suggestions = {
  get: (params = {}) => axiosInstance.get('/suggestions', { params }),
};

// Attach modules to instance for convenience
axiosInstance.auth = auth;
axiosInstance.users = users;
axiosInstance.groups = groups;
axiosInstance.clubs = clubs;
axiosInstance.messages = messages;
axiosInstance.directMessages = directMessages;
axiosInstance.friends = friends;
axiosInstance.notifications = notifications;
axiosInstance.spotify = spotify;
axiosInstance.upload = upload;
axiosInstance.reports = reports;
axiosInstance.boost = boost;
axiosInstance.push = push;
axiosInstance.map      = map;
axiosInstance.waitlist = waitlist;
axiosInstance.deals    = deals;
axiosInstance.suggestions = suggestions;

// Export the instance as 'api'
export const api = axiosInstance;

// Default export
export default api;
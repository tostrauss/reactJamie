import axios from 'axios';

// ==========================================
// AXIOS INSTANCE SETUP
// ==========================================

const API_URL = import.meta.env.VITE_API_URL || '/api';

const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

// Request Interceptor - Add auth token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token && token !== 'guest_token') {
      config.headers.Authorization = `Bearer ${token}`;
    } else if (token === 'guest_token') {
      // Still send guest token for tracking
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Retry logic with exponential backoff
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const shouldRetry = (error) => {
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

    // Retry logic for retryable errors
    if (shouldRetry(error) && config && !config._retryCount) {
      config._retryCount = 0;
    }

    if (shouldRetry(error) && config && config._retryCount < MAX_RETRIES) {
      config._retryCount += 1;
      const delay = RETRY_DELAY * Math.pow(2, config._retryCount - 1) + Math.random() * 500;
      await sleep(delay);
      return axiosInstance(config);
    }

    // 401 handling - redirect to login
    const token = localStorage.getItem('token');
    if (error.response?.status === 401 && token !== 'guest_token') {
      localStorage.removeItem('token');
      const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
      if (!publicPaths.some(p => window.location.pathname.includes(p))) {
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
  register: (email, password, name) => 
    axiosInstance.post('/auth/register', { email, password, name }),
  
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

  forgotPassword: (email) =>
    axiosInstance.post('/auth/forgot-password', { email }),

  resetPassword: (token, newPassword) =>
    axiosInstance.post('/auth/reset-password', { token, newPassword }),

  sendVerification: () =>
    axiosInstance.post('/auth/send-verification'),

  verifyEmail: (token) =>
    axiosInstance.post('/auth/verify-email', { token })
};

// ==========================================
// USERS API
// ==========================================

export const users = {
  getById: (id) => 
    axiosInstance.get(`/users/${id}`),
  
  search: (query) => 
    axiosInstance.get('/users/search', { params: { q: query } })
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
  
  // Get user's joined groups
  getJoined: () => 
    axiosInstance.get('/groups/user/joined'),
  
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

  // Get member avatars for card display
  getMemberAvatars: (id, limit = 4) =>
    axiosInstance.get(`/clubs/${id}/members/avatars`, { params: { limit } })
};

// ==========================================
// MESSAGES API
// ==========================================

export const messages = {
  // Send message to group chat
  send: (groupId, content) => 
    axiosInstance.post('/messages', { groupId, content }),
  
  // Get messages for a group
  get: (groupId, limit = 50, offset = 0) => 
    axiosInstance.get(`/messages/${groupId}`, { params: { limit, offset } }),
  
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
    axiosInstance.delete(`/friends/${friendId}`)
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
  search: (query) =>
    axiosInstance.get('/spotify/search', { params: { query } }),
  getAuthUrl: () =>
    axiosInstance.get('/spotify/auth-url'),
  handleCallback: (code, state) =>
    axiosInstance.post('/spotify/callback', { code, state }),
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
// UPLOAD API
// ==========================================

export const upload = {
  image: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return axiosInstance.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};

// ==========================================
// COMBINED API OBJECT
// ==========================================

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

// Export the instance as 'api'
export const api = axiosInstance;

// Default export
export default api;
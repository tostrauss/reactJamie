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

// Response Interceptor - Handle errors
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = localStorage.getItem('token');
    
    if (error.response?.status === 401 && token !== 'guest_token') {
      localStorage.removeItem('token');
      if (!window.location.pathname.includes('/login') && 
          !window.location.pathname.includes('/register')) {
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
    axiosInstance.put('/auth/onboarding', data)
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
  // Get all groups with filters
  getAll: (params = {}) => {
    const { type, search, category, location, upcoming, limit, offset } = params;
    return axiosInstance.get('/groups', { 
      params: { type, search, category, location, upcoming, limit, offset } 
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
    axiosInstance.post(`/groups/${groupId}/requests/${requestId}`, { action })
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
    axiosInstance.get('/spotify/search', { params: { query } })
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
axiosInstance.messages = messages;
axiosInstance.directMessages = directMessages;
axiosInstance.notifications = notifications;
axiosInstance.spotify = spotify;
axiosInstance.upload = upload;

// Export the instance as 'api'
export const api = axiosInstance;

// Default export
export default api;
import axios from 'axios';

// URL Bestimmung
const API_URL = import.meta.env.VITE_API_URL || '/api';

// Basis Axios Instanz erstellen
const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request Interceptor
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// --- API Module Definitionen ---

const auth = {
  register: (email, password, name) => 
    axiosInstance.post('/auth/register', { email, password, name }),
  login: (email, password) => 
    axiosInstance.post('/auth/login', { email, password }),
  getProfile: () => axiosInstance.get('/auth/profile'),
  updateProfile: (data) => axiosInstance.put('/auth/profile', data),
  completeOnboarding: (data) => axiosInstance.put('/auth/onboarding', data)
};

const users = {
  getById: (id) => axiosInstance.get(`/users/${id}`),
};

const groups = {
  getAll: (type = null, search = '', category = '') => 
    axiosInstance.get('/groups', { params: { type, search, category } }),
  getById: (id) => axiosInstance.get(`/groups/${id}`),
  create: (data) => axiosInstance.post('/groups', data), // FormData direkt senden
  join: (id) => axiosInstance.post(`/groups/${id}/join`),
  leave: (id) => axiosInstance.post(`/groups/${id}/leave`),
  toggleFavorite: (id) => axiosInstance.post(`/groups/${id}/favorite`),
  getFavorites: () => axiosInstance.get('/groups/user/favorites'),
  getJoined: () => axiosInstance.get('/groups/user/joined'),
  getMembers: (id) => axiosInstance.get(`/groups/${id}/members`)
};

const messages = {
  send: (groupId, content) => 
    axiosInstance.post('/messages', { groupId, content }),
  get: (groupId, limit = 50, offset = 0) => 
    axiosInstance.get(`/messages/${groupId}`, { params: { limit, offset } }),
  delete: (messageId) => axiosInstance.delete(`/messages/${messageId}`)
};

const notifications = {
  getAll: () => axiosInstance.get('/notifications'),
  markRead: () => axiosInstance.post('/notifications/mark-read')
};

// --- API Objekt Zusammenbauen ---

// Wir hängen die Module direkt an die Instanz an, 
// damit Importe wie "api.groups.getAll" funktionieren.
axiosInstance.auth = auth;
axiosInstance.users = users;
axiosInstance.groups = groups;
axiosInstance.messages = messages;
axiosInstance.notifications = notifications;

// Export der Hauptinstanz als 'api'
export const api = axiosInstance;

// Einzel-Exporte für Komponenten, die Destructuring nutzen { auth } from ...
export { auth, users, groups, messages, notifications };
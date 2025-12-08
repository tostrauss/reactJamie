import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const auth = {
  register: (email, password, name) => 
    api.post('/auth/register', { email, password, name }),
  login: (email, password) => 
    api.post('/auth/login', { email, password }),
  getProfile: () => api.get('/auth/profile'),
  updateProfile: (data) => api.put('/auth/profile', data)
};

export const groups = {
  getAll: (type = null) => 
    api.get('/groups', { params: { type } }),
  getById: (id) => api.get(`/groups/${id}`),
  create: (title, description, type) => 
    api.post('/groups', { title, description, type }),
  join: (id) => api.post(`/groups/${id}/join`),
  leave: (id) => api.post(`/groups/${id}/leave`),
  toggleFavorite: (id) => api.post(`/groups/${id}/favorite`),
  getFavorites: () => api.get('/groups/user/favorites'),
  getJoined: () => api.get('/groups/user/joined')
};

export const messages = {
  send: (groupId, content) => 
    api.post('/messages', { groupId, content }),
  get: (groupId, limit = 50, offset = 0) => 
    api.get(`/messages/${groupId}`, { params: { limit, offset } }),
  delete: (messageId) => api.delete(`/messages/${messageId}`)
};

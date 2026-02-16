import React, { useContext, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';

// Auth Pages
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';

// Main Pages
import { Home } from './pages/Home';
import { Favorites } from './pages/Favorites';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import ProfileEdit from './pages/ProfileEdit';
import SettingsPage from './pages/SettingsPage';

// Chat Pages
import { ChatList } from './pages/ChatList';
import { ChatPage } from './pages/ChatPage';
import DirectMessagePage from './pages/DirectMessagePage';

// Group & User Pages
import { GroupDetail } from './pages/GroupDetail';
import { CreateGroup } from './pages/CreateGroup';
import { CreateClub } from './pages/CreateClub';
import { GroupRequests } from './pages/GroupRequests';
import { UserProfile } from './pages/UserProfile';

// Notifications
import { Notifications } from './pages/Notifications';

// Styles
import './styles/global.css';
import './styles/home.css';
import './styles/auth.css';
import './styles/chat.css';
import './styles/profile.css';

// SVG Icons
const HomeIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "#FD7666" : "none"} stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9,22 9,12 15,12 15,22"/>
  </svg>
);

const StarIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "#FD7666" : "none"} stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
  </svg>
);

const ChatIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
);

const ProfileIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#FD7666" : "#9BA2B0"} strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const CreateModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  
  if (!isOpen) return null;

  const handleOption = (path) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <h2 className="modal-title">Was möchtest du erstellen?</h2>
        
        <div className="modal-options">
          <button className="modal-option" onClick={() => handleOption('/create-group')}>
            <div className="modal-option-icon">👥</div>
            <div className="modal-option-text">
              <h3>Gruppe erstellen</h3>
              <p>Plane eine Aktivität mit 3-10 Leuten</p>
            </div>
            <div className="modal-option-arrow">→</div>
          </button>
          
          <button className="modal-option" onClick={() => handleOption('/create-club')}>
            <div className="modal-option-icon">🏆</div>
            <div className="modal-option-text">
              <h3>Club gründen</h3>
              <p>Starte eine dauerhafte Community</p>
            </div>
            <div className="modal-option-arrow">→</div>
          </button>
        </div>

        <button className="modal-close-btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
};

const Navigation = () => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const hideNavPaths = ['/login', '/register', '/onboarding'];
  const hideOnChat = location.pathname.startsWith('/chat/');
  
  if (!user || hideNavPaths.includes(location.pathname) || hideOnChat) return null;

  const isActive = (path) => {
    if (path === '/home') return location.pathname === '/home' || location.pathname.startsWith('/group/');
    return location.pathname === path || location.pathname.startsWith(path);
  };

  return (
    <>
      <nav className="bottom-nav">
        <Link to="/home" className={`nav-item ${isActive('/home') ? 'active' : ''}`}>
          <div className="nav-icon"><HomeIcon active={isActive('/home')} /></div>
          <span className="nav-label">Home</span>
        </Link>
        
        <Link to="/favorites" className={`nav-item ${isActive('/favorites') ? 'active' : ''}`}>
          <div className="nav-icon"><StarIcon active={isActive('/favorites')} /></div>
          <span className="nav-label">Favoriten</span>
        </Link>
        
        <button className="nav-add-button" onClick={() => setShowCreateModal(true)}>
          <span className="plus-icon">+</span>
        </button>
        
        <Link to="/chats" className={`nav-item ${isActive('/chats') ? 'active' : ''}`}>
          <div className="nav-icon"><ChatIcon active={isActive('/chats')} /></div>
          <span className="nav-label">Chats</span>
        </Link>
        
        <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
          <div className="nav-icon"><ProfileIcon active={isActive('/profile')} /></div>
          <span className="nav-label">Profil</span>
        </Link>
      </nav>
      
      <CreateModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </>
  );
};

// Protected Route
const ProtectedRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  return user ? children : <Navigate to="/login" replace />;
};

const AuthRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  return user ? <Navigate to="/home" replace /> : children;
};

// Main App Routes
function AppRoutes() {
  const { user } = useContext(AuthContext);

  return (
    <>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
        <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        
        {/* Main */}
        <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/profile/edit" element={<ProtectedRoute><ProfileEdit /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        
        {/* Chats */}
        <Route path="/chats" element={<ProtectedRoute><ChatList /></ProtectedRoute>} />
        <Route path="/chat/:groupId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/dm/:userId" element={<ProtectedRoute><DirectMessagePage /></ProtectedRoute>} />

        {/* Groups */}
        <Route path="/group/:id" element={<ProtectedRoute><GroupDetail /></ProtectedRoute>} />
        <Route path="/group/:id/requests" element={<ProtectedRoute><GroupRequests /></ProtectedRoute>} />
        <Route path="/create-group" element={<ProtectedRoute><CreateGroup /></ProtectedRoute>} />
        <Route path="/create-club" element={<ProtectedRoute><CreateClub /></ProtectedRoute>} />
        
        {/* User */}
        <Route path="/user/:id" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
        
        {/* Notifications */}
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        
        {/* Redirects */}
        <Route path="/" element={<Navigate to={user ? "/home" : "/login"} replace />} />
        
        {/* 404 */}
        <Route path="*" element={
          <div className="page not-found-page">
            <div className="not-found-icon">🤔</div>
            <h1>Seite nicht gefunden</h1>
            <p>Die Seite existiert nicht.</p>
            <Link to="/" className="btn btn-primary">Zur Startseite</Link>
          </div>
        } />
      </Routes>
      <Navigation />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
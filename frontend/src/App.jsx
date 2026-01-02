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

// Chat Pages
import { ChatList } from './pages/ChatList';
import { ChatPage } from './pages/ChatPage';

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

// SVG Icons as components
const HomeIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "#9BA2B0"} strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9,22 9,12 15,12 15,22"/>
  </svg>
);

const StarIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "#fff" : "none"} stroke={active ? "#fff" : "#9BA2B0"} strokeWidth="2">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
  </svg>
);

const ChatIcon = ({ active, badge }) => (
  <div style={{ position: 'relative' }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "#9BA2B0"} strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
  </div>
);

const ProfileIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "#9BA2B0"} strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// Create Modal Component
const CreateModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  
  if (!isOpen) return null;

  const handleOptionClick = (path) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <h2 className="modal-title">Was möchtest du erstellen?</h2>
        
        <div className="modal-options">
          <button className="modal-option" onClick={() => handleOptionClick('/create-group')}>
            <div className="modal-option-icon">👥</div>
            <div className="modal-option-text">
              <h3>Gruppe erstellen</h3>
              <p>Plane eine "einmalige" Aktivität mit anderen</p>
            </div>
          </button>
          
          <button className="modal-option" onClick={() => handleOptionClick('/create-club')}>
            <div className="modal-option-icon">🏆</div>
            <div className="modal-option-text">
              <h3>Club erstellen</h3>
              <p>Gründe eine dauerhafte Community</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

const Navigation = () => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Don't show nav on auth pages, onboarding, or chat detail
  const hideNavPaths = ['/login', '/register', '/onboarding'];
  const hideOnChatDetail = location.pathname.startsWith('/chat/');
  
  if (!user || hideNavPaths.includes(location.pathname) || hideOnChatDetail) return null;

  const isActive = (path) => {
    if (path === '/home') {
      return location.pathname === '/home' || location.pathname.startsWith('/group/');
    }
    return location.pathname === path || location.pathname.startsWith(path);
  };

  return (
    <>
      <nav>
        <Link to="/home" className={`nav-item ${isActive('/home') ? 'active' : ''}`}>
          <div className="nav-icon">
            <HomeIcon active={isActive('/home')} />
          </div>
        </Link>
        
        <Link to="/favorites" className={`nav-item ${isActive('/favorites') ? 'active' : ''}`}>
          <div className="nav-icon">
            <StarIcon active={isActive('/favorites')} />
          </div>
        </Link>
        
        <button 
          className="nav-add-button" 
          onClick={() => setShowCreateModal(true)}
          aria-label="Create new group or club"
        >
          +
        </button>
        
        <Link to="/chats" className={`nav-item ${isActive('/chats') ? 'active' : ''}`}>
          <div className="nav-icon">
            <ChatIcon active={isActive('/chats')} badge={0} />
          </div>
        </Link>
        
        <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
          <div className="nav-icon">
            <ProfileIcon active={isActive('/profile')} />
          </div>
        </Link>
      </nav>
      
      <CreateModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </>
  );
};

// Protected Route Wrapper
const ProtectedRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  return user ? children : <Navigate to="/login" replace />;
};

// Auth Route Wrapper (redirects to home if already logged in)
const AuthRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  return user ? <Navigate to="/home" replace /> : children;
};

// Redirect Plural to Singular Component
const RedirectToGroup = () => {
  const { id } = useParams();
  return <Navigate to={`/group/${id}`} replace />;
};

function AppRoutes() {
  const { user } = useContext(AuthContext);

  return (
    <>
      <Routes>
        {/* ============ AUTH ROUTES ============ */}
        <Route 
          path="/login" 
          element={
            <AuthRoute>
              <Login />
            </AuthRoute>
          } 
        />
        <Route 
          path="/register" 
          element={
            <AuthRoute>
              <Register />
            </AuthRoute>
          } 
        />
        
        {/* ============ ONBOARDING ============ */}
        <Route 
          path="/onboarding" 
          element={
            <ProtectedRoute>
              <Onboarding />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ MAIN PAGES ============ */}
        <Route 
          path="/home" 
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/favorites" 
          element={
            <ProtectedRoute>
              <Favorites />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/profile" 
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/settings" 
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ CHAT ROUTES ============ */}
        <Route 
          path="/chats" 
          element={
            <ProtectedRoute>
              <ChatList />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/chat/:groupId" 
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ GROUP ROUTES ============ */}
        <Route 
          path="/group/:id" 
          element={
            <ProtectedRoute>
              <GroupDetail />
            </ProtectedRoute>
          } 
        />
        {/* ADDED: Fix for plural URL issue */}
        <Route 
          path="/groups/:id" 
          element={<RedirectToGroup />} 
        />
        <Route 
          path="/group/:id/requests" 
          element={
            <ProtectedRoute>
              <GroupRequests />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/create-group" 
          element={
            <ProtectedRoute>
              <CreateGroup />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/create-club" 
          element={
            <ProtectedRoute>
              <CreateClub />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ USER PROFILE ROUTE ============ */}
        <Route 
          path="/user/:id" 
          element={
            <ProtectedRoute>
              <UserProfile />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ NOTIFICATIONS ============ */}
        <Route 
          path="/notifications" 
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          } 
        />
        
        {/* ============ DEFAULT REDIRECTS ============ */}
        <Route 
          path="/" 
          element={<Navigate to={user ? "/home" : "/login"} replace />} 
        />
        
        {/* ============ 404 FALLBACK ============ */}
        <Route 
          path="*" 
          element={
            <div className="page" style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '100vh',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '60px', marginBottom: '20px' }}>🤔</div>
              <h1 style={{ marginBottom: '10px' }}>Seite nicht gefunden</h1>
              <p style={{ color: '#9BA2B0', marginBottom: '30px' }}>
                Die Seite existiert leider nicht.
              </p>
              <Link 
                to="/" 
                className="btn btn-primary"
              >
                Zur Startseite
              </Link>
            </div>
          } 
        />
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

// Helper needed for the redirect logic inside the component tree
import { useParams } from 'react-router-dom';

export default App;
import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { ChatPage } from './pages/ChatPage';
import { Favorites } from './pages/Favorites';
import { Profile } from './pages/Profile';
import { ChatList } from './pages/ChatList';
import { SocketProvider } from './context/SocketContext';
import { GroupDetail } from './pages/GroupDetail';
import { Settings } from './pages/Settings';
import './styles/global.css';

const Navigation = () => {
  const { user, logout } = useContext(AuthContext);
  const location = useLocation();
  
  if (!user) return null;

  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <nav>
      <Link to="/home" className={`nav-item ${isActive('/home')}`}>
        <div className="nav-icon">🏠</div>
        <div className="nav-label">Home</div>
      </Link>
      <Link to="/favorites" className={`nav-item ${isActive('/favorites')}`}>
        <div className="nav-icon">❤️</div>
        <div className="nav-label">Favorites</div>
      </Link>
      <Link to="/chats" className={`nav-item ${isActive('/chats')}`}>
        <div className="nav-icon">💬</div>
        <div className="nav-label">Chats</div>
      </Link>
      <Link to="/profile" className={`nav-item ${isActive('/profile')}`}>
        <div className="nav-icon">👤</div>
        <div className="nav-label">Profile</div>
      </Link>
    </nav>
  );
};

function AppRoutes() {
  const { user } = useContext(AuthContext);

  return (
    <>
      <Routes>
        {/* Auth Routes */}
        <Route path="/login" element={user ? <Navigate to="/home" /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/home" /> : <Register />} />
        
        {/* Protected Routes */}
        <Route path="/home" element={user ? <Home /> : <Navigate to="/login" />} />
        <Route path="/favorites" element={user ? <Favorites /> : <Navigate to="/login" />} />
        <Route path="/chats" element={user ? <ChatList /> : <Navigate to="/login" />} />
        <Route path="/profile" element={user ? <Profile /> : <Navigate to="/login" />} />
        <Route path="/chat/:groupId" element={user ? <ChatPage /> : <Navigate to="/login" />} />
        <Route path="/group/:id" element={user ? <GroupDetail /> : <Navigate to="/login" />} />
        <Route path="/settings" element={user ? <Settings /> : <Navigate to="/login" />} />
        {/* Default Redirect */}
        <Route path="/" element={<Navigate to={user ? "/home" : "/login"} />} />
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
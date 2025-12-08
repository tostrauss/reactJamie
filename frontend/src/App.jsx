import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { ChatPage } from './pages/ChatPage';
import './styles/global.css';

const Navigation = () => {
  const { user, logout } = useContext(AuthContext);
  
  if (!user) return null;

  return (
    <nav>
      <Link to="/home" className="nav-item">
        <div className="nav-icon">🏠</div>
        <div className="nav-label">Home</div>
      </Link>
      <Link to="/favorites" className="nav-item">
        <div className="nav-icon">❤️</div>
        <div className="nav-label">Favorites</div>
      </Link>
      <Link to="/profile" className="nav-item">
        <div className="nav-icon">👤</div>
        <div className="nav-label">Profile</div>
      </Link>
      <button onClick={logout} className="nav-item" style={{ background: 'none', border: 'none' }}>
        <div className="nav-icon">🚪</div>
        <div className="nav-label">Logout</div>
      </button>
    </nav>
  );
};

function AppRoutes() {
  const { user } = useContext(AuthContext);

  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/home" /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/home" /> : <Register />} />
        <Route path="/home" element={user ? <Home /> : <Navigate to="/login" />} />
        <Route path="/chat/:groupId" element={user ? <ChatPage /> : <Navigate to="/login" />} />
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
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

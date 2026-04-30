import jwt from 'jsonwebtoken';

// Guest access only allowed when explicitly enabled via env var
const isGuestAllowed = () => process.env.ALLOW_GUEST_TOKEN === 'true';

const extractToken = (req) => {
  // 1. httpOnly cookie (preferred — XSS-proof)
  if (req.cookies?.auth_token) return req.cookies.auth_token;
  // 2. Authorization header fallback (Capacitor native / API clients)
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
};

export const authenticate = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) return res.status(401).json({ error: 'No authorization header' });

    if (token === 'guest_token') {
      if (!isGuestAllowed()) return res.status(401).json({ error: 'Guest access is disabled' });
      req.userId = 0;
      req.isGuest = true;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) { req.userId = null; return next(); }

    if (token === 'guest_token') {
      req.userId = isGuestAllowed() ? 0 : null;
      req.isGuest = isGuestAllowed();
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch {
    req.userId = null;
    next();
  }
};

export const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Set httpOnly auth cookie — call this after generating a token
export const setAuthCookie = (res, token) => {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// Clear auth cookie on logout
export const clearAuthCookie = (res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
};

export const requireAdmin = async (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { default: db } = await import('../config/database.js');
    const result = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requireCompleteProfile = async (req, res, next) => {
  try {
    if (req.isGuest) return res.status(403).json({ error: 'Guests cannot join groups. Please register.' });

    const { default: db } = await import('../config/database.js');
    const result = await db.query('SELECT onboarding_completed FROM users WHERE id = $1', [req.userId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (!result.rows[0].onboarding_completed) {
      return res.status(403).json({
        error: 'Bitte vervollständige dein Profil, bevor du Gruppen beitrittst.',
        code: 'PROFILE_INCOMPLETE'
      });
    }
    next();
  } catch (error) {
    console.error('Profile check error:', error);
    next(); // Don't block on error
  }
};

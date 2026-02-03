import jwt from 'jsonwebtoken';

/**
 * Required authentication middleware
 * Returns 401 if no valid token
 */
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Skip verification for guest token (dev mode)
    if (token === 'guest_token') {
      req.userId = 0;
      req.isGuest = true;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Optional authentication middleware
 * Sets userId if valid token, but doesn't require it
 */
export const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      req.userId = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      req.userId = null;
      return next();
    }

    if (token === 'guest_token') {
      req.userId = 0;
      req.isGuest = true;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch (error) {
    req.userId = null;
    next();
  }
};

/**
 * Generate JWT token
 */
export const generateToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    process.env.JWT_SECRET, 
    { expiresIn: '30d' }
  );
};

/**
 * Admin check middleware (for future use)
 */
export const requireAdmin = (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

/**
 * Require completed profile middleware
 * User Story 1: "won't be able to request to join events until profile is fully set up"
 */
export const requireCompleteProfile = async (req, res, next) => {
  try {
    // Skip for guests
    if (req.isGuest) {
      return res.status(403).json({ error: 'Guests cannot join groups. Please register.' });
    }

    const { default: db } = await import('../config/database.js');
    const result = await db.query(
      'SELECT onboarding_completed FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

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
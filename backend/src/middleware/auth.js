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
 * Useful for endpoints that personalize for logged-in users
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

    // Handle guest token
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
    // Token invalid/expired, but that's okay for optional auth
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
    { expiresIn: '30d' } // Extended to 30 days for better UX
  );
};

/**
 * Admin check middleware (for future use)
 */
export const requireAdmin = (req, res, next) => {
  // TODO: Implement admin role check
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // For now, just pass through
  next();
};

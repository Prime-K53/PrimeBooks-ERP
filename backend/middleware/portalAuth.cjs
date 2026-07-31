const jwt = require('jsonwebtoken');
const portalAuthService = require('../services/portalAuthService.cjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

function generatePortalToken(user) {
  const payload = {
    id: user.id,
    customer_id: user.customer_id,
    email: user.email,
    role: 'portal_customer',
    company_id: user.company_id || ''
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: portalAuthService.ACCESS_TOKEN_EXPIRY });
}

function generatePortalTokenWithUser(user) {
  return generatePortalToken(user);
}

const verifyPortalToken = (req, res, next) => {
  const publicEndpoints = ['/portal/auth/login', '/portal/auth/forgot-password', '/portal/auth/reset-password', '/portal/auth/refresh'];
  if (publicEndpoints.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'No authentication token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'portal_customer') {
      return res.status(403).json({
        error: 'Invalid token role',
        message: 'This token is not valid for portal access'
      });
    }
    req.portalUser = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please login again.'
      });
    }
    return res.status(403).json({
      error: 'Invalid token',
      message: 'Authentication failed'
    });
  }
};

module.exports = {
  generatePortalToken,
  generatePortalTokenWithUser,
  verifyPortalToken,
  JWT_SECRET
};

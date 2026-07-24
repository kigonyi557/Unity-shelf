const jwt = require('jsonwebtoken');

// Populates req.account = { userId, name, accountType, estateBranch } from
// the Bearer token the front end sends via authHeaders(). Some routes
// (sync's public hero-preview call) work fine with no token at all — those
// use optionalAuth instead.
function requireAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Session required — please log in again.' });
  try {
    req.account = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Session expired — please log in again.' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.account = jwt.verify(token, process.env.JWT_SECRET); } catch (err) { /* ignore — treat as anonymous */ }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.account || req.account.accountType !== 'Library Assistant') {
    return res.status(403).json({ success: false, message: 'Library Assistant access required.' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };

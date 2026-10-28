const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Secure is added automatically when the site is served over HTTPS (directly or via a proxy).
function cookie(req, value, maxAge) {
  return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)').run(token, userId, expires);
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_DAYS * 86400));
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

// ---- Password reset ----
const RESET_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Only the hash is stored, so a leaked database can't be used to reset passwords.
function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
  db.prepare('INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES(?, ?, ?)').run(sha256(token), userId, Date.now() + RESET_MINUTES * 60000);
  return token;
}

function findResetToken(token) {
  const row = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(sha256(String(token || '')));
  return row && row.expires_at > Date.now() ? row.user_id : null;
}

// Sets the new password, uses up the token and signs the user out everywhere.
function resetPassword(token, password) {
  const userId = findResetToken(token);
  if (!userId) return null;
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return userId;
}

// Attaches req.user (or null) on every request.
function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.role, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
    if (row && row.expires_at > Date.now()) {
      delete row.expires_at;
      req.user = row;
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, loadUser, requireUser, requireAdmin, createResetToken, findResetToken, resetPassword, RESET_MINUTES };

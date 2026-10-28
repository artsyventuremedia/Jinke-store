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

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  (await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()));
  (await db.run('INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)', token, userId, expires));
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_DAYS * 86400));
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) (await db.run('DELETE FROM sessions WHERE token = ?', token));
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

// ---- Password reset ----
const RESET_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Only the hash is stored, so a leaked database can't be used to reset passwords.
async function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  (await db.run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', userId, Date.now()));
  (await db.run('INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES(?, ?, ?)', sha256(token), userId, Date.now() + RESET_MINUTES * 60000));
  return token;
}

async function findResetToken(token) {
  const row = (await db.get('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?', sha256(String(token || ''))));
  return row && row.expires_at > Date.now() ? row.user_id : null;
}

// Sets the new password, uses up the token and signs the user out everywhere.
async function resetPassword(token, password) {
  const userId = await findResetToken(token);
  if (!userId) return null;
  (await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId));
  (await db.run('DELETE FROM password_resets WHERE user_id = ?', userId));
  (await db.run('DELETE FROM sessions WHERE user_id = ?', userId));
  return userId;
}

// Attaches req.user (or null) on every request.
async function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = (await db.get(`
      SELECT u.id, u.name, u.email, u.phone, u.role, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token));
    if (row && row.expires_at > Date.now()) {
      delete row.expires_at;
      req.user = row;
    } else if (row) {
      (await db.run('DELETE FROM sessions WHERE token = ?', token));
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

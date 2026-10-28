// Small, dependency-free hardening helpers.

// Fixed-window rate limiter keyed by client IP (+ optional extra key such as the email being tried).
function rateLimit({ windowMs, max, message = 'Too many attempts. Please wait a few minutes and try again.', key = () => '' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = `${req.ip}|${key(req)}`;
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Blocks cross-site requests that change data. Browsers always send Origin on cross-site POST/PUT/DELETE,
// and our API only accepts JSON or multipart bodies, which a plain HTML form on another site can't send as JSON.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/razorpay/webhook' || req.path === '/courier/webhook') return next(); // server-to-server, verified by signature/token
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  const type = req.get('content-type') || '';
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
  if (hasBody && !/^application\/json|^multipart\/form-data/i.test(type)) {
    return res.status(415).json({ error: 'Unsupported content type' });
  }
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

module.exports = { rateLimit, sameOrigin, securityHeaders };

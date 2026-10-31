const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, migrate, UPLOADS_DIR, ON_VERCEL, CONFIG_PROBLEMS } = require('./lib/db');
const { loadUser } = require('./lib/auth');
const { seedIfEmpty, updateContent } = require('./lib/seed');
const { seedPages } = require('./lib/pages');
const { getOrder } = require('./lib/shop');
const { sameOrigin, securityHeaders } = require('./lib/security');
const { mountPages, notFound } = require('./lib/render');
const { scheduleBackups } = require('./lib/backup');
const { ensureInvoiceNumber, renderInvoice } = require('./lib/invoice');
const jobs = require('./lib/jobs');

// One-time start-up (tables, first-run catalogue, policy pages). Requests wait for it; if it fails
// (e.g. the database is unreachable), the next request tries again instead of the server staying broken.
let starting = null;
function ready() {
  starting ||= (async () => {
    await migrate();
    await seedIfEmpty();
    await updateContent();
    await seedPages();
  })().catch((err) => { starting = null; throw err; });
  return starting;
}

// Background jobs have no request to read the site address from; use PUBLIC_URL, or the last one seen.
let lastBaseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Trust the first proxy (Vercel, Caddy, nginx) for the client IP and HTTPS detection.
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
app.use(securityHeaders);
app.use((req, _res, next) => {
  if (!process.env.PUBLIC_URL && req.get('host')) lastBaseUrl = `${req.protocol}://${req.get('host')}`;
  next();
});
app.get('/favicon.ico', (_req, res) => res.redirect(301, '/assets/brand/favicon-32.png'));

// If the store can't start (setup incomplete, database unreachable), say why instead of crashing.
// Tokens and URLs are never included — only which setting is missing or what the database replied.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeMessage = (err) => String(err?.message || err).replace(/(libsql|https?|wss?):\/\/\S+/gi, '[database address]').replace(/ey[\w-]{20,}\.[\w-]+\.[\w-]+/g, '[token]').slice(0, 300);
function setupPage(res, problems) {
  res.status(503).set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store setup needed — Jinke</title><meta name="robots" content="noindex"><link rel="icon" href="/assets/brand/favicon-32.png">
<style>body{font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:#f7f4ee;color:#161616;margin:0;padding:40px 16px}
main{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.06)}img{height:44px}h1{font-size:22px;margin:18px 0 8px}
li{margin:10px 0}code{background:#f3efe7;padding:1px 6px;border-radius:5px}.muted{color:#6b6a66;font-size:14px}</style></head>
<body><main><img src="/assets/brand/logo.png" alt="ಜಿಂಕೆ"><h1>The store is almost ready</h1>
<p>It can't open its database yet. Fix the following in your Vercel project, then redeploy:</p>
<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
<p class="muted">Full steps: README → “Option V: Vercel”. This page disappears as soon as the database works.</p></main></body></html>`);
}
app.get('/healthz', async (_req, res) => {
  if (CONFIG_PROBLEMS.length) return res.status(503).json({ ok: false, problems: CONFIG_PROBLEMS });
  try {
    await ready();
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, database: process.env.TURSO_DATABASE_URL ? 'turso' : 'file', uploads: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'disk' });
  } catch (err) {
    res.status(503).json({ ok: false, problems: [`Database error: ${safeMessage(err)}`] });
  }
});
app.use(async (req, res, next) => {
  if (req.path.startsWith('/assets/')) return next(); // let the setup page load its logo
  if (CONFIG_PROBLEMS.length) return req.path.startsWith('/api/') ? res.status(503).json({ error: CONFIG_PROBLEMS.join(' ') }) : setupPage(res, CONFIG_PROBLEMS);
  try {
    await ready();
  } catch (err) {
    console.error('Start-up failed:', err);
    const problem = `The database could not be opened: ${safeMessage(err)}. Check that TURSO_DATABASE_URL and TURSO_AUTH_TOKEN belong to the same database.`;
    return req.path.startsWith('/api/') ? res.status(503).json({ error: problem }) : setupPage(res, [problem]);
  }
  next();
});

// Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>" (see vercel.json).
app.get('/api/cron/jobs', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = String(req.get('authorization') || '');
  const ok = secret && given.length === `Bearer ${secret}`.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(`Bearer ${secret}`));
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ok: true, ...(await jobs.runDueJobs(lastBaseUrl, { force: true })) });
});

// Keep the raw body: the Razorpay webhook signature is computed over the exact bytes received.
app.use('/api', sameOrigin, express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use('/api', (req, _res, next) => { req.body ??= {}; next(); }); // Express 5 leaves body undefined when none was sent
app.use(loadUser);

app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

mountPages(app);

// Invoices: customers open theirs with order number + phone (like tracking); admins open any order's.
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
app.get('/invoice/:orderNo', async (req, res) => {
  const row = await db.get('SELECT id, phone, invoice_no FROM orders WHERE order_no = ?', String(req.params.orderNo).toUpperCase());
  if (!row || !row.invoice_no || digits(row.phone) !== digits(req.query.phone)) return notFound(req, res);
  res.set('Cache-Control', 'private, no-store').type('html').send(await renderInvoice(await getOrder(row.id)));
});
app.get('/admin/invoice/:id', async (req, res) => {
  if (req.user?.role !== 'admin') return res.redirect('/admin/');
  const id = Number(req.params.id);
  if (!(await ensureInvoiceNumber(id))) return notFound(req, res);
  res.set('Cache-Control', 'private, no-store').type('html').send(await renderInvoice(await getOrder(id), { forAdmin: true }));
});
// Static files. On Vercel these are served by the CDN from public/ and Express never sees them.
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: PROD ? '30d' : 0, index: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0, index: false }));
app.get(['/admin', '/admin/'], (req, res) => {
  if (req.path === '/admin') return res.redirect(301, '/admin/');
  res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.use(notFound);

app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = status >= 500 && !err.expose ? 'Something went wrong' : err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 4 MB or smaller' : err.message;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

module.exports = app;

// On Vercel the exported app is run as a function; everywhere else this is a normal long-running server.
if (!ON_VERCEL) {
  ready().then(() => {
    scheduleBackups();
    setInterval(() => jobs.runDueJobs(lastBaseUrl).catch((err) => console.error('Background job failed:', err.message)), 60 * 1000).unref();
    app.listen(PORT, () => {
      console.log(`Store running at http://localhost:${PORT}${PROD ? ' (production)' : ''}`);
      console.log(`Admin dashboard at http://localhost:${PORT}/admin/`);
    });
  }).catch((err) => {
    console.error('Could not start the store:', err.message);
    process.exit(1);
  });
}

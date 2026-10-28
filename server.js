const path = require('path');
const express = require('express');
const { db, UPLOADS_DIR } = require('./lib/db');
const { loadUser } = require('./lib/auth');
const { seedIfEmpty } = require('./lib/seed');
const { seedPages } = require('./lib/pages');
const { cancelOrder, markPaid } = require('./lib/shop');
const { sameOrigin, securityHeaders } = require('./lib/security');
const { mountPages, notFound } = require('./lib/render');
const { scheduleBackups } = require('./lib/backup');
const payments = require('./lib/payments');
const shiprocket = require('./lib/shiprocket');
const notify = require('./lib/notify');
const { getOrder } = require('./lib/shop');
const { ensureInvoiceNumber, renderInvoice } = require('./lib/invoice');

seedIfEmpty();
seedPages();
scheduleBackups();

// Online orders hold stock while the customer pays. Release it if payment isn't completed within 30 minutes,
// after checking with Razorpay that the payment really didn't go through.
async function releaseAbandonedOrders() {
  if (!payments.razorpayConfig()) return;
  const stale = db.prepare(`SELECT id, payment_ref FROM orders WHERE payment_method = 'online' AND payment_status = 'pending'
    AND status = 'pending' AND payment_ref IS NOT NULL AND created_at < datetime('now', '-30 minutes')`).all();
  for (const o of stale) {
    try {
      const rzp = await payments.fetchRazorpayOrder(o.payment_ref);
      if (rzp.status === 'paid') markPaid(o.id, null, 'Payment received (confirmed by Razorpay)');
      else if (rzp.status !== 'attempted' || Date.now() / 1000 - rzp.created_at > 2 * 3600) cancelOrder(o.id, 'Payment not completed — order released');
    } catch (err) {
      console.error(`Could not check payment for order ${o.id}:`, err.message);
    }
  }
}
setInterval(releaseAbandonedOrders, 5 * 60 * 1000).unref();

// Background jobs have no request to read the site address from; use PUBLIC_URL, or the last one seen.
let lastBaseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

// Pull courier tracking every 2 hours (Shiprocket's webhook usually gets there first).
setInterval(async () => {
  for (const { id } of await shiprocket.syncTracking()) notify.statusChanged(getOrder(id), lastBaseUrl);
}, 2 * 60 * 60 * 1000).unref();

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Trust the first proxy (Caddy/nginx) for the client IP and HTTPS detection.
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
app.use(securityHeaders);
app.use((req, _res, next) => {
  if (!process.env.PUBLIC_URL && req.get('host')) lastBaseUrl = `${req.protocol}://${req.get('host')}`;
  next();
});
app.get('/favicon.ico', (_req, res) => res.redirect(301, '/assets/brand/favicon-32.png'));
app.get('/healthz', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

// Keep the raw body: the Razorpay webhook signature is computed over the exact bytes received.
app.use('/api', sameOrigin, express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(loadUser);

app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

mountPages(app);

// Invoices: customers open theirs with order number + phone (like tracking); admins open any order's.
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
app.get('/invoice/:orderNo', (req, res) => {
  const row = db.prepare('SELECT id, phone, invoice_no FROM orders WHERE order_no = ?').get(String(req.params.orderNo).toUpperCase());
  if (!row || !row.invoice_no || digits(row.phone) !== digits(req.query.phone)) return notFound(req, res);
  res.set('Cache-Control', 'private, no-store').type('html').send(renderInvoice(getOrder(row.id)));
});
app.get('/admin/invoice/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.redirect('/admin/');
  const id = Number(req.params.id);
  if (!ensureInvoiceNumber(id)) return notFound(req, res);
  res.set('Cache-Control', 'private, no-store').type('html').send(renderInvoice(getOrder(id), { forAdmin: true }));
});
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: PROD ? '30d' : 0, index: false }));
// HTML is only served through mountPages (which fills in titles and meta tags); the admin app is static.
app.use((req, res, next) => (req.path.endsWith('.html') && !req.path.startsWith('/admin/') ? notFound(req, res) : next()));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0, index: false }));
app.get(['/admin', '/admin/'], (req, res) => {
  if (req.path === '/admin') return res.redirect(301, '/admin/');
  res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.use(notFound);

app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = status >= 500 && !err.expose ? 'Something went wrong' : err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller' : err.message;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

app.listen(PORT, () => {
  console.log(`Store running at http://localhost:${PORT}${PROD ? ' (production)' : ''}`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin/`);
});

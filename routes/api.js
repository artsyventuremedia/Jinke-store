const express = require('express');
const { db, getSettings } = require('../lib/db');
const { hashPassword, verifyPassword, createSession, destroySession, requireUser, createResetToken, findResetToken, resetPassword, RESET_MINUTES } = require('../lib/auth');
const { rateLimit } = require('../lib/security');
const { HttpError, GSTIN_RE, serializeProduct, quote, placeOrder, getOrder, markPaid, cancelOrder } = require('../lib/shop');
const payments = require('../lib/payments');
const mailer = require('../lib/mailer');
const notify = require('../lib/notify');
const shiprocket = require('../lib/shiprocket');
const { getPage } = require('../lib/pages');
const { allCategories, withProductCounts, DESCENDANTS_SQL } = require('../lib/catalog');

const router = express.Router();

// Express 4 does not catch rejected promises; route async handlers through next().
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Strips internal fields before an order goes to the browser, and adds the invoice link once one exists.
function publicOrder(o) {
  for (const k of ['user_id', 'payment_ref', 'shiprocket_order_id', 'shiprocket_shipment_id', 'label_url']) delete o[k];
  o.invoice_url = o.invoice_no ? `/invoice/${encodeURIComponent(o.order_no)}?phone=${encodeURIComponent(digits(o.phone))}` : null;
  return o;
}

const MIN = 60 * 1000;
const limits = {
  login: rateLimit({ windowMs: 15 * MIN, max: 10, key: (req) => String(req.body.email || '').toLowerCase(), message: 'Too many login attempts. Please wait 15 minutes and try again.' }),
  loginIp: rateLimit({ windowMs: 15 * MIN, max: 40, message: 'Too many login attempts. Please wait 15 minutes and try again.' }),
  register: rateLimit({ windowMs: 60 * MIN, max: 10 }),
  forgot: rateLimit({ windowMs: 15 * MIN, max: 5, message: 'Too many reset requests. Please wait 15 minutes and try again.' }),
  // Reset links carry a 256-bit random token, so this only needs to stop floods, not guessing.
  reset: rateLimit({ windowMs: 15 * MIN, max: 30 }),
  orders: rateLimit({ windowMs: 10 * MIN, max: 20, message: 'Too many orders from your network. Please try again shortly.' }),
  track: rateLimit({ windowMs: 10 * MIN, max: 40 }),
  write: rateLimit({ windowMs: 60 * MIN, max: 20 }),
};

function checkoutParams(o) {
  const s = getSettings();
  return {
    key: payments.razorpayConfig().keyId,
    order_id: o.payment_ref,
    amount: o.total * 100,
    currency: 'INR',
    name: s.store_name,
    description: `Order #${o.order_no}`,
    prefill: { name: o.name, email: o.email, contact: o.phone },
  };
}

const PUBLIC_SETTINGS = ['store_name', 'tagline', 'announcement', 'phone', 'whatsapp', 'email', 'address',
  'shipping_fee', 'free_shipping_above', 'cod_enabled', 'online_enabled', 'instagram', 'facebook', 'youtube', 'logo', 'bulk_min_qty', 'gstin', 'business_name'];

router.get('/store', (_req, res) => {
  const s = getSettings();
  const settings = Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]]));
  settings.payment_mode = payments.razorpayConfig() ? 'razorpay' : 'demo';
  res.json({
    settings,
    categories: withProductCounts(allCategories()),
    collections: db.prepare('SELECT * FROM collections ORDER BY sort, name').all(),
  });
});

router.get('/home', (_req, res) => {
  const list = (where) => db.prepare(`SELECT * FROM products WHERE status = 'active' AND ${where} ORDER BY created_at DESC LIMIT 12`).all().map((p) => serializeProduct(p));
  res.json({
    banners: db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY sort, id').all(),
    trending: list('is_trending = 1'),
    featured: list('is_featured = 1'),
    newest: list('1 = 1'),
    testimonials: db.prepare('SELECT * FROM testimonials WHERE active = 1 ORDER BY id DESC').all(),
  });
});

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
  name: 'p.name ASC',
  discount: '(COALESCE(p.mrp, p.price) - p.price) * 1.0 / COALESCE(p.mrp, p.price) DESC',
};

router.get('/products', (req, res) => {
  const where = ["p.status = 'active'"];
  const params = [];
  const { q, category, collection, min, max, size, sort, in_stock } = req.query;
  if (q) {
    where.push('(p.name LIKE ? OR p.tags LIKE ? OR p.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  // A parent category (e.g. Apparels) includes everything in the categories below it.
  if (category) { where.push(`p.category_id IN (${DESCENDANTS_SQL})`); params.push(category); }
  if (collection) { where.push('col.slug = ?'); params.push(collection); }
  if (min) { where.push('p.price >= ?'); params.push(parseInt(min, 10) || 0); }
  if (max) { where.push('p.price <= ?'); params.push(parseInt(max, 10) || 0); }
  if (size) { where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.label = ? AND v.stock > 0)'); params.push(size); }
  if (in_stock === '1') where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.stock > 0)');
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = Math.min(48, parseInt(req.query.per, 10) || 24);
  const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN collections col ON col.id = p.collection_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const rows = db.prepare(`SELECT p.*, c.name AS category_name, col.name AS collection_name ${from} ORDER BY ${SORTS[sort] || SORTS.newest} LIMIT ? OFFSET ?`)
    .all(...params, per, (page - 1) * per);
  const sizes = db.prepare("SELECT DISTINCT v.label FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' ORDER BY v.id").all().map((r) => r.label);
  res.json({ products: rows.map((p) => serializeProduct(p)), total, page, pages: Math.ceil(total / per), sizes });
});

router.get('/products/:slug', (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, col.name AS collection_name, col.slug AS collection_slug
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN collections col ON col.id = p.collection_id
    WHERE p.slug = ? AND p.status = 'active'`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const related = db.prepare(`SELECT * FROM products WHERE status = 'active' AND id != ? AND (category_id = ? OR collection_id = ?) ORDER BY RANDOM() LIMIT 8`)
    .all(p.id, p.category_id, p.collection_id).map((r) => serializeProduct(r));
  const reviews = db.prepare(`SELECT r.id, r.name, r.rating, r.text, r.created_at,
      EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = r.product_id AND o.user_id = r.user_id AND o.status = 'delivered') AS verified
    FROM reviews r WHERE r.product_id = ? AND r.approved = 1 ORDER BY r.id DESC LIMIT 50`).all(p.id);
  const summary = db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS average FROM reviews WHERE product_id = ? AND approved = 1').get(p.id);
  const mine = req.user ? db.prepare('SELECT rating, text, approved FROM reviews WHERE product_id = ? AND user_id = ?').get(p.id, req.user.id) : null;
  res.json({ product: { ...serializeProduct(p), rating: summary }, related, reviews, my_review: mine || null });
});

router.post('/products/:id/reviews', requireUser, limits.write, (req, res) => {
  const productId = Number(req.params.id);
  const rating = parseInt(req.body.rating, 10);
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Choose a rating from 1 to 5 stars');
  if (!db.prepare("SELECT 1 FROM products WHERE id = ? AND status = 'active'").get(productId)) throw new HttpError(404, 'Product not found');
  // One review per customer per product; editing sends it back for approval.
  const existing = db.prepare('SELECT id FROM reviews WHERE product_id = ? AND user_id = ?').get(productId, req.user.id);
  if (existing) {
    db.prepare("UPDATE reviews SET rating = ?, text = ?, approved = 0, created_at = datetime('now') WHERE id = ?").run(rating, text, existing.id);
  } else {
    db.prepare('INSERT INTO reviews(product_id, user_id, name, rating, text) VALUES(?,?,?,?,?)').run(productId, req.user.id, req.user.name, rating, text);
  }
  res.status(201).json({ ok: true });
});

router.get('/pages', (_req, res) => {
  res.json({ pages: db.prepare('SELECT slug, title FROM pages ORDER BY id').all() });
});

router.get('/pages/:slug', (req, res) => {
  const page = getPage(req.params.slug);
  if (!page) throw new HttpError(404, 'Page not found');
  delete page.body;
  res.json({ page });
});

router.post('/cart/quote', (req, res) => {
  res.json(quote(req.body.items || [], req.body.coupon));
});

router.post('/orders', limits.orders, wrap(async (req, res) => {
  const order = placeOrder(req.body, req.user);
  const out = { order_no: order.order_no, total: order.total, phone: order.phone };
  if (order.gateway === 'razorpay') {
    try {
      const rzp = await payments.createRazorpayOrder(order);
      db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(rzp.id, order.id);
      order.payment_ref = rzp.id;
    } catch (err) {
      console.error('Razorpay order creation failed:', err.message);
      cancelOrder(order.id, 'Payment gateway unavailable');
      throw new HttpError(502, 'Online payment is unavailable right now. Please try again or choose cash on delivery.');
    }
    out.razorpay = checkoutParams(order);
  } else {
    notify.orderPlaced(order, baseUrl(req));
  }
  res.status(201).json(out);
}));

// Called by the browser after Razorpay Checkout succeeds.
router.post('/orders/verify', limits.track, (req, res) => {
  const { order_no, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const o = db.prepare('SELECT id, payment_ref FROM orders WHERE order_no = ?').get(String(order_no || ''));
  if (!o || !o.payment_ref || o.payment_ref !== razorpay_order_id) throw new HttpError(404, 'Order not found');
  if (!payments.verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new HttpError(400, 'We could not verify this payment. If money was deducted, contact us with your order number.');
  }
  if (markPaid(o.id, razorpay_payment_id)) notify.orderPlaced(getOrder(o.id), baseUrl(req));
  res.json({ ok: true });
});

// Lets a customer retry payment for an online order that is still unpaid.
router.get('/orders/pay', limits.track, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(req.query.order_no || '').trim().toUpperCase());
  if (!o || digits(o.phone) !== digits(req.query.phone)) throw new HttpError(404, 'Order not found');
  if (o.payment_status === 'paid') throw new HttpError(409, 'This order is already paid');
  if (o.status === 'cancelled' || !o.payment_ref || !payments.razorpayConfig()) throw new HttpError(409, 'This order can no longer be paid. Please place a new order.');
  res.json({ order_no: o.order_no, razorpay: checkoutParams(o) });
});

// Razorpay webhook (Dashboard → Webhooks → events: payment.captured, order.paid).
router.post('/razorpay/webhook', (req, res) => {
  if (!payments.verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'Invalid signature' });
  const { event, payload } = req.body;
  if (event === 'payment.captured' || event === 'order.paid') {
    const pay = payload?.payment?.entity || {};
    const rzpOrderId = pay.order_id || payload?.order?.entity?.id;
    const o = rzpOrderId && db.prepare('SELECT id FROM orders WHERE payment_ref = ?').get(rzpOrderId);
    if (o && markPaid(o.id, pay.id, 'Payment received (confirmed by Razorpay)')) notify.orderPlaced(getOrder(o.id), baseUrl(req));
  }
  res.json({ ok: true });
});

// Shiprocket tracking webhook (Shiprocket → Settings → API → Webhooks). Shiprocket sends our token in x-api-key.
router.post('/courier/webhook', (req, res) => {
  const expected = getSettings().shiprocket_webhook_token;
  if (!expected || req.get('x-api-key') !== expected) return res.status(401).json({ error: 'Invalid token' });
  const b = req.body || {};
  const o = (b.awb && db.prepare('SELECT id FROM orders WHERE tracking_no = ?').get(String(b.awb)))
    || (b.order_id && db.prepare('SELECT id FROM orders WHERE order_no = ?').get(String(b.order_id)));
  if (o) {
    const status = b.current_status || b.shipment_status || '';
    const location = (b.scans && b.scans[b.scans.length - 1]?.location) || '';
    if (shiprocket.applyTracking(o.id, status, location)) notify.statusChanged(getOrder(o.id), baseUrl(req));
  }
  res.json({ ok: true });
});

router.get('/track', limits.track, (req, res) => {
  const { order_no, phone } = req.query;
  const o = db.prepare('SELECT id, phone FROM orders WHERE order_no = ?').get(String(order_no || '').trim().toUpperCase());
  if (!o || digits(o.phone) !== digits(phone)) return res.status(404).json({ error: 'No order found with those details' });
  const full = getOrder(o.id);
  publicOrder(full);
  full.can_pay = full.payment_method === 'online' && full.payment_status !== 'paid' && full.status !== 'cancelled' && !!payments.razorpayConfig();
  res.json(full);
});

router.post('/bulk-enquiry', limits.write, (req, res) => {
  const b = req.body || {};
  const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const e = { name: str(b.name, 100), company: str(b.company, 150), email: str(b.email, 150), phone: str(b.phone, 20), city: str(b.city, 100),
    products: (Array.isArray(b.products) ? b.products.map((x) => str(x, 60)).join(', ') : str(b.products, 300)),
    quantity: parseInt(b.quantity, 10) || null, customization: str(b.customization, 100), needed_by: str(b.needed_by, 20), message: str(b.message, 2000),
    gstin: str(b.gstin, 15).toUpperCase() };
  if (!e.name) throw new HttpError(400, 'Please enter your name');
  if (!/^\S+@\S+\.\S+$/.test(e.email)) throw new HttpError(400, 'Enter a valid email');
  if (!/^[+\d\s-]{10,15}$/.test(e.phone)) throw new HttpError(400, 'Enter a valid phone number');
  if (!e.products) throw new HttpError(400, 'Choose at least one product type');
  if (!e.quantity || e.quantity < 1) throw new HttpError(400, 'Enter the approximate quantity');
  if (e.gstin && !GSTIN_RE.test(e.gstin)) throw new HttpError(400, 'Enter a valid 15-character GSTIN, or leave it empty');
  const id = Number(db.prepare(`INSERT INTO bulk_enquiries(name, company, email, phone, city, products, quantity, customization, needed_by, message, gstin)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(e.name, e.company, e.email, e.phone, e.city, e.products, e.quantity, e.customization, e.needed_by, e.message, e.gstin || null).lastInsertRowid);
  mailer.bulkEnquiry({ id, ...e }, baseUrl(req));
  res.status(201).json({ ok: true });
});

router.post('/subscribe', limits.write, (req, res) => {
  const email = String(req.body.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  db.prepare('INSERT OR IGNORE INTO subscribers(email) VALUES(?)').run(email);
  res.json({ ok: true });
});

// ---- Customer accounts ----
router.post('/auth/register', limits.register, (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) throw new HttpError(400, 'Name, email and password are required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists');
  const r = db.prepare('INSERT INTO users(name, email, phone, password_hash) VALUES(?,?,?,?)').run(name.trim(), email.trim(), phone || null, hashPassword(password));
  createSession(req, res, Number(r.lastInsertRowid));
  res.status(201).json({ ok: true });
});

router.post('/auth/login', limits.loginIp, limits.login, (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  createSession(req, res, u.id);
  res.json({ ok: true, role: u.role });
});

// Always answers the same way, so it can't be used to find out which emails have accounts.
router.post('/auth/forgot', limits.forgot, (req, res) => {
  const u = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(String(req.body.email || '').trim());
  if (u) mailer.passwordReset(u, `${baseUrl(req)}/reset?token=${createResetToken(u.id)}`, RESET_MINUTES);
  res.json({ ok: true, email_enabled: mailer.isConfigured() });
});

router.get('/auth/reset', limits.reset, (req, res) => {
  res.json({ valid: !!findResetToken(req.query.token) });
});

router.post('/auth/reset', limits.reset, (req, res) => {
  const { token, password } = req.body;
  if (String(password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  const userId = resetPassword(token, String(password));
  if (!userId) throw new HttpError(400, 'This reset link has expired or was already used. Please request a new one.');
  createSession(req, res, userId);
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  res.json({ ok: true, role: u.role });
});

router.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

router.get('/me/orders', requireUser, (req, res) => {
  const orders = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id).map((o) => publicOrder(getOrder(o.id)));
  res.json({ orders });
});

router.get('/me/wishlist', requireUser, (req, res) => {
  const rows = db.prepare("SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? AND p.status = 'active'").all(req.user.id);
  res.json({ products: rows.map((p) => serializeProduct(p)) });
});

router.post('/me/wishlist/:productId', requireUser, (req, res) => {
  if (!db.prepare("SELECT 1 FROM products WHERE id = ? AND status = 'active'").get(Number(req.params.productId))) throw new HttpError(404, 'Product not found');
  db.prepare('INSERT OR IGNORE INTO wishlist(user_id, product_id) VALUES(?, ?)').run(req.user.id, Number(req.params.productId));
  res.json({ ok: true });
});

router.delete('/me/wishlist/:productId', requireUser, (req, res) => {
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
  res.json({ ok: true });
});

router.put('/me', requireUser, (req, res) => {
  const { name, phone, password } = req.body;
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), req.user.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone || null, req.user.id);
  if (password) {
    if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;

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
const { background } = require('../lib/background');
const { allCategories, withProductCounts, DESCENDANTS_SQL } = require('../lib/catalog');

const router = express.Router();

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
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

async function checkoutParams(o) {
  const s = await getSettings();
  return {
    key: (await payments.razorpayConfig()).keyId,
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

router.get('/store', async (_req, res) => {
  const s = await getSettings();
  const settings = Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]]));
  settings.payment_mode = (await payments.razorpayConfig()) ? 'razorpay' : 'demo';
  res.json({
    settings,
    categories: await withProductCounts(await allCategories()),
    collections: (await db.all('SELECT * FROM collections ORDER BY sort, name')),
  });
});

router.get('/home', async (_req, res) => {
  const list = async (where) => Promise.all((await db.all(`SELECT * FROM products WHERE status = 'active' AND ${where} ORDER BY created_at DESC LIMIT 12`)).map((p) => serializeProduct(p)));
  const [trending, featured, newest] = await Promise.all([list('is_trending = 1'), list('is_featured = 1'), list('1 = 1')]);
  res.json({
    banners: (await db.all('SELECT * FROM banners WHERE active = 1 ORDER BY sort, id')),
    trending,
    featured,
    newest,
    testimonials: (await db.all('SELECT * FROM testimonials WHERE active = 1 ORDER BY id DESC')),
  });
});

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
  name: 'p.name ASC',
  discount: '(COALESCE(p.mrp, p.price) - p.price) * 1.0 / COALESCE(p.mrp, p.price) DESC',
};

router.get('/products', async (req, res) => {
  const where = ["p.status = 'active'"];
  const params = [];
  // Query values are coerced to strings: ?category=a&category=b would otherwise arrive as an array.
  const one = (v) => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined ? '' : String(v));
  const [q, category, collection, min, max, size, sort, in_stock] = ['q', 'category', 'collection', 'min', 'max', 'size', 'sort', 'in_stock'].map((k) => one(req.query[k]));
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
  const total = (await db.get(`SELECT COUNT(*) AS n ${from}`, ...params)).n;
  const rows = (await db.all(`SELECT p.*, c.name AS category_name, col.name AS collection_name ${from} ORDER BY ${SORTS[sort] || SORTS.newest} LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per));
  const sizes = (await db.all("SELECT DISTINCT v.label FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' ORDER BY v.id")).map((r) => r.label);
  res.json({ products: await Promise.all(rows.map((p) => serializeProduct(p))), total, page, pages: Math.ceil(total / per), sizes });
});

router.get('/products/:slug', async (req, res) => {
  const p = (await db.get(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, col.name AS collection_name, col.slug AS collection_slug
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN collections col ON col.id = p.collection_id
    WHERE p.slug = ? AND p.status = 'active'`, req.params.slug));
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const related = await Promise.all((await db.all(`SELECT * FROM products WHERE status = 'active' AND id != ? AND (category_id = ? OR collection_id = ?) ORDER BY RANDOM() LIMIT 8`, p.id, p.category_id, p.collection_id)).map((r) => serializeProduct(r)));
  const reviews = (await db.all(`SELECT r.id, r.name, r.rating, r.text, r.created_at,
      EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = r.product_id AND o.user_id = r.user_id AND o.status = 'delivered') AS verified
    FROM reviews r WHERE r.product_id = ? AND r.approved = 1 ORDER BY r.id DESC LIMIT 50`, p.id));
  const summary = (await db.get('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS average FROM reviews WHERE product_id = ? AND approved = 1', p.id));
  const mine = req.user ? (await db.get('SELECT rating, text, approved FROM reviews WHERE product_id = ? AND user_id = ?', p.id, req.user.id)) : null;
  res.json({ product: { ...(await serializeProduct(p)), rating: summary }, related, reviews, my_review: mine || null });
});

router.post('/products/:id/reviews', requireUser, limits.write, async (req, res) => {
  const productId = Number(req.params.id);
  const rating = parseInt(req.body.rating, 10);
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Choose a rating from 1 to 5 stars');
  if (!(await db.get("SELECT 1 FROM products WHERE id = ? AND status = 'active'", productId))) throw new HttpError(404, 'Product not found');
  // One review per customer per product; editing sends it back for approval.
  const existing = (await db.get('SELECT id FROM reviews WHERE product_id = ? AND user_id = ?', productId, req.user.id));
  if (existing) {
    (await db.run("UPDATE reviews SET rating = ?, text = ?, approved = 0, created_at = datetime('now') WHERE id = ?", rating, text, existing.id));
  } else {
    (await db.run('INSERT INTO reviews(product_id, user_id, name, rating, text) VALUES(?,?,?,?,?)', productId, req.user.id, req.user.name, rating, text));
  }
  res.status(201).json({ ok: true });
});

router.get('/pages', async (_req, res) => {
  res.json({ pages: (await db.all('SELECT slug, title FROM pages ORDER BY id')) });
});

router.get('/pages/:slug', async (req, res) => {
  const page = await getPage(req.params.slug);
  if (!page) throw new HttpError(404, 'Page not found');
  delete page.body;
  res.json({ page });
});

router.post('/cart/quote', async (req, res) => {
  res.json(await quote(req.body.items || [], req.body.coupon));
});

router.post('/orders', limits.orders, async (req, res) => {
  const order = await placeOrder(req.body, req.user);
  const out = { order_no: order.order_no, total: order.total, phone: order.phone };
  if (order.gateway === 'razorpay') {
    try {
      const rzp = await payments.createRazorpayOrder(order);
      (await db.run('UPDATE orders SET payment_ref = ? WHERE id = ?', rzp.id, order.id));
      order.payment_ref = rzp.id;
    } catch (err) {
      console.error('Razorpay order creation failed:', err.message);
      await cancelOrder(order.id, 'Payment gateway unavailable');
      throw new HttpError(502, 'Online payment is unavailable right now. Please try again or choose cash on delivery.');
    }
    out.razorpay = await checkoutParams(order);
  } else {
    notify.orderPlaced(order, baseUrl(req));
  }
  res.status(201).json(out);
});

// Called by the browser after Razorpay Checkout succeeds.
router.post('/orders/verify', limits.track, async (req, res) => {
  const { order_no, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const o = (await db.get('SELECT id, payment_ref FROM orders WHERE order_no = ?', String(order_no || '')));
  if (!o || !o.payment_ref || o.payment_ref !== razorpay_order_id) throw new HttpError(404, 'Order not found');
  if (!(await payments.verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature))) {
    throw new HttpError(400, 'We could not verify this payment. If money was deducted, contact us with your order number.');
  }
  if (await markPaid(o.id, razorpay_payment_id)) notify.orderPlaced(await getOrder(o.id), baseUrl(req));
  res.json({ ok: true });
});

// Lets a customer retry payment for an online order that is still unpaid.
router.get('/orders/pay', limits.track, async (req, res) => {
  const o = (await db.get('SELECT * FROM orders WHERE order_no = ?', String(req.query.order_no || '').trim().toUpperCase()));
  if (!o || digits(o.phone) !== digits(req.query.phone)) throw new HttpError(404, 'Order not found');
  if (o.payment_status === 'paid') throw new HttpError(409, 'This order is already paid');
  if (o.status === 'cancelled' || !o.payment_ref || !(await payments.razorpayConfig())) throw new HttpError(409, 'This order can no longer be paid. Please place a new order.');
  res.json({ order_no: o.order_no, razorpay: await checkoutParams(o) });
});

// Razorpay webhook (Dashboard → Webhooks → events: payment.captured, order.paid).
router.post('/razorpay/webhook', async (req, res) => {
  if (!(await payments.verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature')))) return res.status(400).json({ error: 'Invalid signature' });
  const { event, payload } = req.body;
  if (event === 'payment.captured' || event === 'order.paid') {
    const pay = payload?.payment?.entity || {};
    const rzpOrderId = pay.order_id || payload?.order?.entity?.id;
    const o = rzpOrderId && (await db.get('SELECT id FROM orders WHERE payment_ref = ?', rzpOrderId));
    if (o && await markPaid(o.id, pay.id, 'Payment received (confirmed by Razorpay)')) notify.orderPlaced(await getOrder(o.id), baseUrl(req));
  }
  res.json({ ok: true });
});

// Shiprocket tracking webhook (Shiprocket → Settings → API → Webhooks). Shiprocket sends our token in x-api-key.
router.post('/courier/webhook', async (req, res) => {
  const expected = (await getSettings()).shiprocket_webhook_token;
  if (!expected || req.get('x-api-key') !== expected) return res.status(401).json({ error: 'Invalid token' });
  const b = req.body || {};
  const o = (b.awb && (await db.get('SELECT id FROM orders WHERE tracking_no = ?', String(b.awb))))
    || (b.order_id && (await db.get('SELECT id FROM orders WHERE order_no = ?', String(b.order_id))));
  if (o) {
    const status = b.current_status || b.shipment_status || '';
    const location = (b.scans && b.scans[b.scans.length - 1]?.location) || '';
    if (await shiprocket.applyTracking(o.id, status, location)) notify.statusChanged(await getOrder(o.id), baseUrl(req));
  }
  res.json({ ok: true });
});

router.get('/track', limits.track, async (req, res) => {
  const { order_no, phone } = req.query;
  const o = (await db.get('SELECT id, phone FROM orders WHERE order_no = ?', String(order_no || '').trim().toUpperCase()));
  if (!o || digits(o.phone) !== digits(phone)) return res.status(404).json({ error: 'No order found with those details' });
  const full = await getOrder(o.id);
  publicOrder(full);
  full.can_pay = full.payment_method === 'online' && full.payment_status !== 'paid' && full.status !== 'cancelled' && !!(await payments.razorpayConfig());
  res.json(full);
});

router.post('/bulk-enquiry', limits.write, async (req, res) => {
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
  const id = Number((await db.run(`INSERT INTO bulk_enquiries(name, company, email, phone, city, products, quantity, customization, needed_by, message, gstin)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, e.name, e.company, e.email, e.phone, e.city, e.products, e.quantity, e.customization, e.needed_by, e.message, e.gstin || null)).lastInsertRowid);
  background(mailer.bulkEnquiry({ id, ...e }, baseUrl(req)));
  res.status(201).json({ ok: true });
});

router.post('/subscribe', limits.write, async (req, res) => {
  const email = String(req.body.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  (await db.run('INSERT OR IGNORE INTO subscribers(email) VALUES(?)', email));
  res.json({ ok: true });
});

// ---- Customer accounts ----
router.post('/auth/register', limits.register, async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) throw new HttpError(400, 'Name, email and password are required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if ((await db.get('SELECT 1 FROM users WHERE email = ?', email))) throw new HttpError(409, 'An account with this email already exists');
  const r = (await db.run('INSERT INTO users(name, email, phone, password_hash) VALUES(?,?,?,?)', name.trim(), email.trim(), phone || null, hashPassword(password)));
  await createSession(req, res, Number(r.lastInsertRowid));
  res.status(201).json({ ok: true });
});

router.post('/auth/login', limits.loginIp, limits.login, async (req, res) => {
  const { email, password } = req.body;
  const u = (await db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim()));
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  await createSession(req, res, u.id);
  res.json({ ok: true, role: u.role });
});

// Always answers the same way, so it can't be used to find out which emails have accounts.
router.post('/auth/forgot', limits.forgot, async (req, res) => {
  const u = (await db.get('SELECT id, name, email FROM users WHERE email = ?', String(req.body.email || '').trim()));
  if (u) background(mailer.passwordReset(u, `${baseUrl(req)}/reset?token=${await createResetToken(u.id)}`, RESET_MINUTES));
  res.json({ ok: true, email_enabled: await mailer.isConfigured() });
});

router.get('/auth/reset', limits.reset, async (req, res) => {
  res.json({ valid: !!(await findResetToken(String(req.query.token || ''))) });
});

router.post('/auth/reset', limits.reset, async (req, res) => {
  const { token, password } = req.body;
  if (String(password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  const userId = await resetPassword(token, String(password));
  if (!userId) throw new HttpError(400, 'This reset link has expired or was already used. Please request a new one.');
  await createSession(req, res, userId);
  const u = (await db.get('SELECT role FROM users WHERE id = ?', userId));
  res.json({ ok: true, role: u.role });
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  res.json({ user: req.user });
});

router.get('/me/orders', requireUser, async (req, res) => {
  const orders = await Promise.all((await db.all('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC', req.user.id)).map(async (o) => publicOrder(await getOrder(o.id))));
  res.json({ orders });
});

router.get('/me/wishlist', requireUser, async (req, res) => {
  const rows = (await db.all("SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? AND p.status = 'active'", req.user.id));
  res.json({ products: await Promise.all(rows.map((p) => serializeProduct(p))) });
});

router.post('/me/wishlist/:productId', requireUser, async (req, res) => {
  if (!(await db.get("SELECT 1 FROM products WHERE id = ? AND status = 'active'", Number(req.params.productId)))) throw new HttpError(404, 'Product not found');
  (await db.run('INSERT OR IGNORE INTO wishlist(user_id, product_id) VALUES(?, ?)', req.user.id, Number(req.params.productId)));
  res.json({ ok: true });
});

router.delete('/me/wishlist/:productId', requireUser, async (req, res) => {
  (await db.run('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', req.user.id, Number(req.params.productId)));
  res.json({ ok: true });
});

router.put('/me', requireUser, async (req, res) => {
  const { name, phone, password } = req.body;
  if (name) (await db.run('UPDATE users SET name = ? WHERE id = ?', String(name).trim(), req.user.id));
  if (phone !== undefined) (await db.run('UPDATE users SET phone = ? WHERE id = ?', phone || null, req.user.id));
  if (password) {
    if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    (await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), req.user.id));
  }
  res.json({ ok: true });
});

module.exports = router;

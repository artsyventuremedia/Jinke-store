const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, tx, getSettings, setSettings, SECRET_SETTINGS, UPLOADS_DIR } = require('../lib/db');
const { requireAdmin, hashPassword, verifyPassword } = require('../lib/auth');
const { HttpError, GSTIN_RE, uniqueSlug, serializeProduct, getOrder, adjustStock, releaseCoupon, ORDER_STATUSES } = require('../lib/shop');
const mailer = require('../lib/mailer');
const notify = require('../lib/notify');
const shiprocket = require('../lib/shiprocket');
const whatsapp = require('../lib/whatsapp');
const sms = require('../lib/sms');
const payments = require('../lib/payments');
const { gstActive, ensureInvoiceNumber, STATE_CODES } = require('../lib/invoice');
const { sqlShift, localDate } = require('../lib/time');
const { allCategories, setParents, descendantIds } = require('../lib/catalog');
const { renderBody } = require('../lib/pages');

const router = express.Router();
router.use(requireAdmin);

// ---- Uploads ----
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  // No SVG: it can carry scripts and is served from the store's own domain.
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype) && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.originalname)),
});

router.post('/upload', upload.array('files', 10), (req, res) => {
  res.json({ urls: (req.files || []).map((f) => `/uploads/${f.filename}`) });
});

// ---- Dashboard ----
router.get('/dashboard', (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
  const since = `-${days - 1} days`;
  const live = "status NOT IN ('cancelled', 'returned')";
  const L = sqlShift(); // compare calendar days in store time, not UTC
  const range = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?)`).get(since);
  const prev = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?) AND date(created_at, ${L}) < date('now', ${L}, ?)`)
    .get(`-${days * 2 - 1} days`, since);
  const daily = db.prepare(`SELECT date(created_at, ${L}) AS day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?) GROUP BY day`).all(since);
  const byDay = Object.fromEntries(daily.map((d) => [d.day, d]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(new Date(Date.now() - i * 864e5));
    series.push({ day: d, orders: byDay[d]?.orders || 0, revenue: byDay[d]?.revenue || 0 });
  }
  res.json({
    days,
    revenue: range.revenue,
    orders: range.orders,
    prev_revenue: prev.revenue,
    prev_orders: prev.orders,
    aov: range.orders ? Math.round(range.revenue / range.orders) : 0,
    customers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    new_customers: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND date(created_at, ${L}) >= date('now', ${L}, ?)`).get(since).n,
    pending: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending', 'confirmed', 'packed')").get().n,
    pending_reviews: db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE approved = 0').get().n,
    new_bulk: db.prepare("SELECT COUNT(*) AS n FROM bulk_enquiries WHERE status = 'new'").get().n,
    series,
    by_status: db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all(),
    recent: db.prepare('SELECT id, order_no, name, total, status, payment_method, created_at FROM orders ORDER BY id DESC LIMIT 8').all(),
    top_products: db.prepare(`SELECT oi.product_id, oi.name, SUM(oi.qty) AS units, SUM(oi.qty * oi.price) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.${live} AND date(o.created_at, ${L}) >= date('now', ${L}, ?)
      GROUP BY oi.product_id ORDER BY units DESC LIMIT 5`).all(since),
    low_stock: db.prepare(`SELECT p.id, p.name, v.label, v.stock FROM variants v JOIN products p ON p.id = v.product_id
      WHERE p.status = 'active' AND v.stock <= 5 ORDER BY v.stock ASC LIMIT 8`).all(),
  });
});

// ---- Products ----
router.get('/products', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.q) { where.push('(p.name LIKE ? OR p.tags LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.category_id) {
    const ids = descendantIds(Number(req.query.category_id));
    where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const rows = db.prepare(`SELECT p.*, c.name AS category_name, col.name AS collection_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN collections col ON col.id = p.collection_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC`).all(...params);
  res.json({ products: rows.map((p) => serializeProduct(p)) });
});

router.get('/products/:id', (req, res) => {
  const p = serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id)));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json({ product: p });
});

function saveProduct(body, id = 0) {
  const name = String(body.name || '').trim();
  const price = parseInt(body.price, 10);
  if (!name) throw new HttpError(400, 'Name is required');
  if (!(price >= 0)) throw new HttpError(400, 'Price is required');
  const mrp = body.mrp ? parseInt(body.mrp, 10) : null;
  const fields = [
    name, body.description || '', price, mrp, body.category_id ? Number(body.category_id) : null,
    body.collection_id ? Number(body.collection_id) : null, JSON.stringify(Array.isArray(body.images) ? body.images : []),
    body.tags || '', body.is_trending ? 1 : 0, body.is_featured ? 1 : 0, body.status === 'draft' ? 'draft' : 'active',
    String(body.hsn || '').trim() || null, body.gst_rate === '' || body.gst_rate == null ? null : parseFloat(body.gst_rate),
  ];
  return tx(() => {
    const slug = uniqueSlug('products', body.slug || name, id);
    if (id) {
      db.prepare(`UPDATE products SET name=?, description=?, price=?, mrp=?, category_id=?, collection_id=?, images=?, tags=?, is_trending=?, is_featured=?, status=?, hsn=?, gst_rate=?, slug=? WHERE id=?`)
        .run(...fields, slug, id);
    } else {
      id = Number(db.prepare(`INSERT INTO products(name, description, price, mrp, category_id, collection_id, images, tags, is_trending, is_featured, status, hsn, gst_rate, slug)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...fields, slug).lastInsertRowid);
    }
    const variants = Array.isArray(body.variants) ? body.variants.filter((v) => String(v.label || '').trim()) : [];
    const keep = variants.filter((v) => v.id).map((v) => Number(v.id));
    // Remove variants dropped in the editor (order history keeps its own copy of name/size).
    const existing = db.prepare('SELECT id FROM variants WHERE product_id = ?').all(id).map((r) => r.id);
    for (const vid of existing) if (!keep.includes(vid)) db.prepare('DELETE FROM variants WHERE id = ?').run(vid);
    for (const v of variants) {
      const stock = Math.max(0, parseInt(v.stock, 10) || 0);
      if (v.id && existing.includes(Number(v.id))) {
        db.prepare('UPDATE variants SET label = ?, sku = ?, stock = ?, image = ? WHERE id = ?').run(v.label.trim(), v.sku || null, stock, v.image || null, Number(v.id));
      } else {
        db.prepare('INSERT INTO variants(product_id, label, sku, stock, image) VALUES(?,?,?,?,?)').run(id, v.label.trim(), v.sku || null, stock, v.image || null);
      }
    }
    return serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  });
}

router.post('/products', (req, res) => res.status(201).json({ product: saveProduct(req.body) }));
router.put('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
  res.json({ product: saveProduct(req.body, id) });
});
router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Orders ----
router.get('/orders', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(order_no LIKE ? OR name LIKE ? OR phone LIKE ? OR email LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  const rows = db.prepare(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS units FROM orders o WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`).all(...params);
  res.json({ orders: rows, statuses: ORDER_STATUSES });
});

const base = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

router.get('/orders/:id', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  const notifications = db.prepare('SELECT channel, event, recipient, ok, detail, created_at FROM notification_log WHERE order_id = ? ORDER BY id DESC LIMIT 30').all(o.id);
  res.json({ order: o, statuses: ORDER_STATUSES, notifications, shiprocket: shiprocket.configured(), gst: gstActive() });
});

router.post('/orders/:id/ship', async (req, res, next) => {
  try {
    if (!shiprocket.configured()) throw new HttpError(400, 'Connect Shiprocket in Integrations first');
    const o = await shiprocket.shipOrder(Number(req.params.id), { courierId: req.body.courier_id });
    ensureInvoiceNumber(o.id);
    notify.statusChanged(getOrder(o.id), base(req));
    res.json({ order: getOrder(o.id) });
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(502, err.message));
  }
});

router.post('/orders/:id/track', async (req, res, next) => {
  try {
    const o = getOrder(Number(req.params.id));
    if (!o?.tracking_no) throw new HttpError(400, 'This order has no tracking number yet');
    const t = await shiprocket.trackAwb(o.tracking_no);
    const moved = shiprocket.applyTracking(o.id, t.status, t.location);
    if (moved) notify.statusChanged(getOrder(o.id), base(req));
    res.json({ status: t.status || 'No updates yet', moved, order: getOrder(o.id) });
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(502, err.message));
  }
});

router.post('/orders/:id/invoice', (req, res) => {
  const no = ensureInvoiceNumber(Number(req.params.id));
  if (!no) throw new HttpError(404, 'Order not found');
  res.json({ invoice_no: no, url: `/admin/invoice/${Number(req.params.id)}` });
});

router.post('/orders/:id/resend', (req, res) => {
  const o = getOrder(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  if (['pending', 'confirmed', 'packed'].includes(o.status)) notify.orderPlaced(o, base(req));
  else notify.statusChanged(o, base(req), null);
  res.json({ ok: true });
});

router.put('/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'Order not found');
  const { status, payment_status, courier, tracking_no, note } = req.body;
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  tx(() => {
    const wasLive = !['cancelled', 'returned'].includes(o.status);
    const nowLive = !['cancelled', 'returned'].includes(status || o.status);
    // Put stock back when an order is cancelled/returned, take it again if reopened.
    if (wasLive !== nowLive) adjustStock(id, nowLive ? -1 : 1);
    if (wasLive && !nowLive) releaseCoupon(o);
    db.prepare(`UPDATE orders SET status = ?, payment_status = ?, courier = ?, tracking_no = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status || o.status, payment_status || o.payment_status, courier ?? o.courier, tracking_no ?? o.tracking_no, id);
    if ((status && status !== o.status) || note) {
      db.prepare('INSERT INTO order_events(order_id, status, note) VALUES(?,?,?)').run(id, status || o.status, note || null);
    }
  });
  // GST: the invoice is issued when the goods are dispatched.
  if (['shipped', 'delivered'].includes(status)) ensureInvoiceNumber(id);
  const updated = getOrder(id);
  if (status && status !== o.status && req.body.notify !== false) notify.statusChanged(updated, base(req), note);
  res.json({ order: updated });
});

// ---- Customers ----
router.get('/customers', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','returned')) AS spent
    FROM users u WHERE u.role = 'customer' AND (u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.phone, '') LIKE ?) ORDER BY u.id DESC`).all(q, q, q);
  res.json({ customers: rows });
});

router.get('/subscribers', (_req, res) => {
  res.json({ subscribers: db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all() });
});

// ---- Simple CRUD resources ----
function crud(table, fields, { slugFrom, duplicate = 'That value is already in use' } = {}) {
  const r = express.Router();
  const unique = (fn) => {
    try { return fn(); } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) throw new HttpError(409, duplicate);
      throw err;
    }
  };
  const values = (body) => fields.map((f) => {
    const v = body[f.name];
    if (f.type === 'bool') return v ? 1 : 0;
    if (f.type === 'int') return v === '' || v == null ? (f.nullable ? null : 0) : parseInt(v, 10);
    return v === '' || v == null ? null : String(v);
  });
  const check = (body) => {
    for (const f of fields) if (f.required && (body[f.name] === '' || body[f.name] == null)) throw new HttpError(400, `${f.label || f.name} is required`);
  };
  r.get('/', (_req, res) => res.json({ items: db.prepare(`SELECT * FROM ${table} ORDER BY ${fields.some((f) => f.name === 'sort') ? 'sort, ' : ''}id DESC`).all() }));
  r.post('/', (req, res) => {
    check(req.body);
    const cols = fields.map((f) => f.name);
    const vals = values(req.body);
    if (slugFrom) { cols.push('slug'); vals.push(uniqueSlug(table, req.body.slug || req.body[slugFrom])); }
    const id = unique(() => db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid);
    res.status(201).json({ item: db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) });
  });
  r.put('/:id', (req, res) => {
    check(req.body);
    const id = Number(req.params.id);
    const cols = fields.map((f) => `${f.name} = ?`);
    const vals = values(req.body);
    if (slugFrom) { cols.push('slug = ?'); vals.push(uniqueSlug(table, req.body.slug || req.body[slugFrom], id)); }
    unique(() => db.prepare(`UPDATE ${table} SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id));
    res.json({ item: db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) });
  });
  r.delete('/:id', (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
    res.json({ ok: true });
  });
  return r;
}

// ---- Categories (a tree; a category may sit under several parents) ----
function saveCategory(body, id = 0) {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  return tx(() => {
    const slug = uniqueSlug('categories', body.slug || name, id);
    const vals = [name, slug, body.image || null, parseInt(body.sort, 10) || 0];
    if (id) db.prepare('UPDATE categories SET name = ?, slug = ?, image = ?, sort = ? WHERE id = ?').run(...vals, id);
    else id = Number(db.prepare('INSERT INTO categories(name, slug, image, sort) VALUES(?,?,?,?)').run(...vals).lastInsertRowid);
    setParents(id, body.parent_ids);
    return allCategories().find((c) => c.id === id);
  });
}
router.get('/categories', (_req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id').all().map((r) => [r.category_id, r.n]));
  res.json({ items: allCategories().map((c) => ({ ...c, products: counts[c.id] || 0 })) });
});
router.post('/categories', (req, res) => res.status(201).json({ item: saveCategory(req.body) }));
router.put('/categories/:id', (req, res) => res.json({ item: saveCategory(req.body, Number(req.params.id)) }));
router.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  // Children of a deleted category move up to its parents, so nothing disappears from the menu.
  tx(() => {
    const parents = db.prepare('SELECT parent_id FROM category_parents WHERE category_id = ?').all(id).map((r) => r.parent_id);
    for (const { category_id: child } of db.prepare('SELECT category_id FROM category_parents WHERE parent_id = ?').all(id)) {
      for (const pid of parents) db.prepare('INSERT OR IGNORE INTO category_parents(category_id, parent_id) VALUES(?, ?)').run(child, pid);
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  res.json({ ok: true });
});

// ---- Bulk enquiries ----
const BULK_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
router.get('/bulk', (req, res) => {
  const status = BULK_STATUSES.includes(req.query.status) ? req.query.status : null;
  res.json({
    items: db.prepare(`SELECT * FROM bulk_enquiries ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 500`).all(...(status ? [status] : [])),
    counts: Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM bulk_enquiries GROUP BY status').all().map((r) => [r.status, r.n])),
    statuses: BULK_STATUSES,
  });
});
router.put('/bulk/:id', (req, res) => {
  const { status, notes } = req.body;
  if (status && !BULK_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  db.prepare('UPDATE bulk_enquiries SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?').run(status || null, notes ?? null, Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/bulk/:id', (req, res) => {
  db.prepare('DELETE FROM bulk_enquiries WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
router.use('/collections', crud('collections', [
  { name: 'name', required: true }, { name: 'description' }, { name: 'image' }, { name: 'sort', type: 'int' },
], { slugFrom: 'name' }));
router.use('/banners', crud('banners', [
  { name: 'kicker' }, { name: 'title', required: true }, { name: 'subtitle' }, { name: 'theme' },
  { name: 'image' }, { name: 'image_label' }, { name: 'image2' }, { name: 'image2_label' },
  { name: 'link' }, { name: 'button_text' }, { name: 'sort', type: 'int' }, { name: 'active', type: 'bool' },
]));
router.use('/testimonials', crud('testimonials', [
  { name: 'name', required: true }, { name: 'role' }, { name: 'text', required: true }, { name: 'rating', type: 'int' }, { name: 'active', type: 'bool' },
]));
router.use('/coupons', crud('coupons', [
  { name: 'code', required: true }, { name: 'type' }, { name: 'value', type: 'int', required: true }, { name: 'min_order', type: 'int' },
  { name: 'max_discount', type: 'int', nullable: true }, { name: 'usage_limit', type: 'int', nullable: true },
  { name: 'expires_at' }, { name: 'active', type: 'bool' },
], { duplicate: 'A coupon with this code already exists' }));

// ---- Reviews ----
router.get('/reviews', (req, res) => {
  const where = req.query.status === 'pending' ? 'WHERE r.approved = 0' : req.query.status === 'approved' ? 'WHERE r.approved = 1' : '';
  const rows = db.prepare(`SELECT r.*, p.name AS product_name, p.slug AS product_slug, u.email FROM reviews r
    JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id ${where} ORDER BY r.approved ASC, r.id DESC LIMIT 500`).all();
  res.json({ reviews: rows, pending: db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE approved = 0').get().n });
});
router.put('/reviews/:id', (req, res) => {
  db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(req.body.approved ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/reviews/:id', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Policy pages ----
router.get('/pages', (_req, res) => {
  res.json({ pages: db.prepare('SELECT slug, title, body, updated_at FROM pages ORDER BY id').all() });
});
router.put('/pages/:slug', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) throw new HttpError(400, 'Title is required');
  const r = db.prepare("UPDATE pages SET title = ?, body = ?, updated_at = datetime('now') WHERE slug = ?").run(title, String(req.body.body || ''), req.params.slug);
  if (!r.changes) throw new HttpError(404, 'Page not found');
  res.json({ ok: true });
});
router.post('/pages/preview', (req, res) => {
  res.json({ html: renderBody(req.body.body || '') });
});

// ---- Integrations ----
function webhookToken() {
  let t = getSettings().shiprocket_webhook_token;
  if (!t) {
    t = crypto.randomBytes(18).toString('base64url');
    setSettings({ shiprocket_webhook_token: t });
  }
  return t;
}

router.get('/integrations', (req, res) => {
  const s = getSettings();
  res.json({
    status: {
      razorpay: !!payments.razorpayConfig(),
      email: mailer.isConfigured(),
      gst: gstActive(s),
      shiprocket: shiprocket.configured(s),
      whatsapp: whatsapp.configured(s),
      sms: sms.configured(s),
    },
    variables: notify.VARIABLES,
    webhooks: {
      razorpay: `${base(req)}/api/razorpay/webhook`,
      shiprocket: `${base(req)}/api/courier/webhook`,
      shiprocket_token: webhookToken(),
    },
    recent: db.prepare(`SELECT n.channel, n.event, n.recipient, n.ok, n.detail, n.created_at, o.order_no FROM notification_log n
      LEFT JOIN orders o ON o.id = n.order_id ORDER BY n.id DESC LIMIT 15`).all(),
  });
});

router.post('/integrations/test', async (req, res, next) => {
  const { channel, to } = req.body;
  const s = getSettings();
  try {
    if (channel === 'shiprocket') {
      const pickups = await shiprocket.testConnection();
      return res.json({ ok: true, message: `Connected. Pickup locations: ${pickups.join(', ') || 'none — add one in Shiprocket'}` });
    }
    if (!to) throw new HttpError(400, 'Enter a phone number to send the test to');
    const sample = { order_no: 'TEST123', name: req.user.name, phone: to, total: 999, courier: 'Delhivery', tracking_no: 'AWB123456', payment_method: 'cod' };
    const event = req.body.event || 'order';
    if (channel === 'whatsapp') {
      if (!s.whatsapp_phone_id || !s.whatsapp_token) throw new HttpError(400, 'Save the Phone number ID and access token first');
      const tpl = s[`wa_tpl_${event}`];
      if (!tpl) throw new HttpError(400, `Add a template name for "${event}" first`);
      await whatsapp.sendTemplate(to, tpl, notify.values(event, sample, base(req)));
      return res.json({ ok: true, message: `WhatsApp "${tpl}" sent to ${to}` });
    }
    if (channel === 'sms') {
      if (!s.msg91_authkey) throw new HttpError(400, 'Save the MSG91 auth key first');
      const tpl = s[`msg91_tpl_${event}`];
      if (!tpl) throw new HttpError(400, `Add a template ID for "${event}" first`);
      await sms.sendFlow(to, tpl, notify.values(event, sample, base(req)));
      return res.json({ ok: true, message: `SMS sent to ${to}` });
    }
    throw new HttpError(400, 'Unknown channel');
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(502, err.message));
  }
});

// ---- Settings ----
function settingsForAdmin() {
  const s = getSettings();
  const out = { ...s, secrets_set: {} };
  for (const k of SECRET_SETTINGS) { out.secrets_set[k] = !!s[k]; out[k] = ''; }
  return out;
}
router.get('/settings', (_req, res) => res.json({ settings: settingsForAdmin() }));
router.put('/settings', (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.gstin !== undefined) {
    body.gstin = String(body.gstin).trim().toUpperCase();
    if (body.gstin && !GSTIN_RE.test(body.gstin)) throw new HttpError(400, 'That GSTIN doesn’t look right — it should be 15 characters, e.g. 29ABCDE1234F1Z5');
    // The first two digits are the state code, which decides CGST+SGST vs IGST.
    const state = body.gstin && Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === body.gstin.slice(0, 2));
    if (state) body.business_state = state;
  }
  setSettings(body);
  res.json({ settings: settingsForAdmin() });
});
router.post('/settings/test-email', async (req, res, next) => {
  try {
    await mailer.testEmail(req.body.to || req.user.email);
    res.json({ ok: true });
  } catch (err) {
    next(new HttpError(400, `Email failed: ${err.message}`));
  }
});

router.put('/password', (req, res) => {
  const { current, next } = req.body;
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  if (String(next || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  // Sign out every other device that was using the old password.
  const thisSession = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, thisSession || '');
  res.json({ ok: true });
});

module.exports = router;

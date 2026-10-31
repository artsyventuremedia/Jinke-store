const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, tx, getSettings, setSettings, SECRET_SETTINGS, UPLOADS_DIR, ON_VERCEL } = require('../lib/db');
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
const { background } = require('../lib/background');
const jobs = require('../lib/jobs');

const router = express.Router();
router.use(requireAdmin);

// ---- Uploads ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // Vercel caps a request body at 4.5 MB
  // No SVG: it can carry scripts and is served from the store's own domain.
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype) && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.originalname)),
});

// Saved to Vercel Blob when BLOB_READ_WRITE_TOKEN is set (Vercel → Storage → Blob), otherwise to the uploads folder.
async function storeUpload(file) {
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const blob = await put(`uploads/${name}`, file.buffer, { access: 'public', contentType: file.mimetype });
    return blob.url;
  }
  if (ON_VERCEL) throw new HttpError(400, 'Photo uploads need Vercel Blob: in Vercel, open Storage → Create → Blob and connect it to this project, then redeploy.');
  await fs.promises.writeFile(path.join(UPLOADS_DIR, name), file.buffer);
  return `/uploads/${name}`;
}

router.post('/upload', upload.array('files', 10), async (req, res) => {
  const urls = [];
  for (const f of req.files || []) urls.push(await storeUpload(f));
  res.json({ urls });
});

// ---- Dashboard ----
router.get('/dashboard', async (req, res) => {
  background(jobs.runDueJobs(base(req)));
  const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
  const since = `-${days - 1} days`;
  const live = "status NOT IN ('cancelled', 'returned')";
  const L = sqlShift(); // compare calendar days in store time, not UTC
  const range = (await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?)`, since));
  const prev = (await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?) AND date(created_at, ${L}) < date('now', ${L}, ?)`, `-${days * 2 - 1} days`, since));
  const daily = (await db.all(`SELECT date(created_at, ${L}) AS day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders WHERE ${live} AND date(created_at, ${L}) >= date('now', ${L}, ?) GROUP BY day`, since));
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
    customers: (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'")).n,
    new_customers: (await db.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND date(created_at, ${L}) >= date('now', ${L}, ?)`, since)).n,
    pending: (await db.get("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending', 'confirmed', 'packed')")).n,
    pending_reviews: (await db.get('SELECT COUNT(*) AS n FROM reviews WHERE approved = 0')).n,
    new_bulk: (await db.get("SELECT COUNT(*) AS n FROM bulk_enquiries WHERE status = 'new'")).n,
    series,
    by_status: (await db.all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')),
    recent: (await db.all('SELECT id, order_no, name, total, status, payment_method, created_at FROM orders ORDER BY id DESC LIMIT 8')),
    top_products: (await db.all(`SELECT oi.product_id, oi.name, SUM(oi.qty) AS units, SUM(oi.qty * oi.price) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.${live} AND date(o.created_at, ${L}) >= date('now', ${L}, ?)
      GROUP BY oi.product_id ORDER BY units DESC LIMIT 5`, since)),
    low_stock: (await db.all(`SELECT p.id, p.name, v.label, v.stock FROM variants v JOIN products p ON p.id = v.product_id
      WHERE p.status = 'active' AND v.stock <= 5 ORDER BY v.stock ASC LIMIT 8`)),
  });
});

// ---- Products ----
router.get('/products', async (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.q) { where.push('(p.name LIKE ? OR p.tags LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { where.push('p.status = ?'); params.push(String(req.query.status)); }
  if (req.query.category_id) {
    const ids = await descendantIds(Number(req.query.category_id));
    where.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const rows = (await db.all(`SELECT p.*, c.name AS category_name, col.name AS collection_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN collections col ON col.id = p.collection_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC`, ...params));
  res.json({ products: await Promise.all(rows.map((p) => serializeProduct(p))) });
});

router.get('/products/:id', async (req, res) => {
  const p = await serializeProduct(await db.get('SELECT * FROM products WHERE id = ?', Number(req.params.id)));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json({ product: p });
});

async function saveProduct(body, id = 0) {
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
  return tx(async () => {
    const slug = await uniqueSlug('products', body.slug || name, id);
    if (id) {
      (await db.run(`UPDATE products SET name=?, description=?, price=?, mrp=?, category_id=?, collection_id=?, images=?, tags=?, is_trending=?, is_featured=?, status=?, hsn=?, gst_rate=?, slug=? WHERE id=?`, ...fields, slug, id));
    } else {
      id = Number((await db.run(`INSERT INTO products(name, description, price, mrp, category_id, collection_id, images, tags, is_trending, is_featured, status, hsn, gst_rate, slug)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...fields, slug)).lastInsertRowid);
    }
    const variants = Array.isArray(body.variants) ? body.variants.filter((v) => String(v.label || '').trim()) : [];
    const keep = variants.filter((v) => v.id).map((v) => Number(v.id));
    // Remove variants dropped in the editor (order history keeps its own copy of name/size).
    const existing = (await db.all('SELECT id FROM variants WHERE product_id = ?', id)).map((r) => r.id);
    for (const vid of existing) if (!keep.includes(vid)) (await db.run('DELETE FROM variants WHERE id = ?', vid));
    for (const v of variants) {
      const stock = Math.max(0, parseInt(v.stock, 10) || 0);
      if (v.id && existing.includes(Number(v.id))) {
        (await db.run('UPDATE variants SET label = ?, sku = ?, stock = ?, image = ? WHERE id = ?', v.label.trim(), v.sku || null, stock, v.image || null, Number(v.id)));
      } else {
        (await db.run('INSERT INTO variants(product_id, label, sku, stock, image) VALUES(?,?,?,?,?)', id, v.label.trim(), v.sku || null, stock, v.image || null));
      }
    }
    return serializeProduct((await db.get('SELECT * FROM products WHERE id = ?', id)));
  });
}

router.post('/products', async (req, res) => res.status(201).json({ product: await saveProduct(req.body) }));
router.put('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.get('SELECT 1 FROM products WHERE id = ?', id))) throw new HttpError(404, 'Product not found');
  res.json({ product: await saveProduct(req.body, id) });
});
router.delete('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  // Linked rows are removed explicitly (an online database may not enforce ON DELETE CASCADE).
  await tx(async () => {
    for (const t of ['variants', 'wishlist', 'reviews']) await db.run(`DELETE FROM ${t} WHERE product_id = ?`, id);
    await db.run('DELETE FROM products WHERE id = ?', id);
  });
  res.json({ ok: true });
});

// ---- Orders ----
router.get('/orders', async (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) { where.push('(order_no LIKE ? OR name LIKE ? OR phone LIKE ? OR email LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
  const rows = (await db.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS units FROM orders o WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`, ...params));
  res.json({ orders: rows, statuses: ORDER_STATUSES });
});

const base = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

router.get('/orders/:id', async (req, res) => {
  const o = await getOrder(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  const notifications = (await db.all('SELECT channel, event, recipient, ok, detail, created_at FROM notification_log WHERE order_id = ? ORDER BY id DESC LIMIT 30', o.id));
  res.json({ order: o, statuses: ORDER_STATUSES, notifications, shiprocket: await shiprocket.configured(), gst: await gstActive() });
});

router.post('/orders/:id/ship', async (req, res, next) => {
  try {
    if (!(await shiprocket.configured())) throw new HttpError(400, 'Connect Shiprocket in Integrations first');
    const o = await shiprocket.shipOrder(Number(req.params.id), { courierId: req.body.courier_id });
    await ensureInvoiceNumber(o.id);
    const updated = await getOrder(o.id);
    notify.statusChanged(updated, base(req));
    res.json({ order: updated });
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(502, err.message));
  }
});

router.post('/orders/:id/track', async (req, res, next) => {
  try {
    const o = await getOrder(Number(req.params.id));
    if (!o?.tracking_no) throw new HttpError(400, 'This order has no tracking number yet');
    const t = await shiprocket.trackAwb(o.tracking_no);
    const moved = await shiprocket.applyTracking(o.id, t.status, t.location);
    const updated = await getOrder(o.id);
    if (moved) notify.statusChanged(updated, base(req));
    res.json({ status: t.status || 'No updates yet', moved, order: updated });
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(502, err.message));
  }
});

router.post('/orders/:id/invoice', async (req, res) => {
  const no = await ensureInvoiceNumber(Number(req.params.id));
  if (!no) throw new HttpError(404, 'Order not found');
  res.json({ invoice_no: no, url: `/admin/invoice/${Number(req.params.id)}` });
});

router.post('/orders/:id/resend', async (req, res) => {
  const o = await getOrder(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  if (['pending', 'confirmed', 'packed'].includes(o.status)) notify.orderPlaced(o, base(req));
  else notify.statusChanged(o, base(req), null);
  res.json({ ok: true });
});

router.put('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const o = (await db.get('SELECT * FROM orders WHERE id = ?', id));
  if (!o) throw new HttpError(404, 'Order not found');
  const { status, payment_status, courier, tracking_no, note } = req.body;
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  await tx(async () => {
    const wasLive = !['cancelled', 'returned'].includes(o.status);
    const nowLive = !['cancelled', 'returned'].includes(status || o.status);
    // Put stock back when an order is cancelled/returned, take it again if reopened.
    if (wasLive !== nowLive) await adjustStock(id, nowLive ? -1 : 1);
    if (wasLive && !nowLive) await releaseCoupon(o);
    (await db.run(`UPDATE orders SET status = ?, payment_status = ?, courier = ?, tracking_no = ?, updated_at = datetime('now') WHERE id = ?`, status || o.status, payment_status || o.payment_status, courier ?? o.courier, tracking_no ?? o.tracking_no, id));
    if ((status && status !== o.status) || note) {
      (await db.run('INSERT INTO order_events(order_id, status, note) VALUES(?,?,?)', id, status || o.status, note || null));
    }
  });
  // GST: the invoice is issued when the goods are dispatched.
  if (['shipped', 'delivered'].includes(status)) await ensureInvoiceNumber(id);
  const updated = await getOrder(id);
  if (status && status !== o.status && req.body.notify !== false) notify.statusChanged(updated, base(req), note);
  res.json({ order: updated });
});

// ---- Customers ----
router.get('/customers', async (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  const rows = (await db.all(`SELECT u.id, u.name, u.email, u.phone, u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','returned')) AS spent
    FROM users u WHERE u.role = 'customer' AND (u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.phone, '') LIKE ?) ORDER BY u.id DESC`, q, q, q));
  res.json({ customers: rows });
});

router.get('/subscribers', async (_req, res) => {
  res.json({ subscribers: (await db.all('SELECT * FROM subscribers ORDER BY id DESC')) });
});

// ---- Simple CRUD resources ----
function crud(table, fields, { slugFrom, duplicate = 'That value is already in use', beforeDelete } = {}) {
  const r = express.Router();
  const unique = async (fn) => {
    try { return await fn(); } catch (err) {
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
  r.get('/', async (_req, res) => res.json({ items: (await db.all(`SELECT * FROM ${table} ORDER BY ${fields.some((f) => f.name === 'sort') ? 'sort, ' : ''}id DESC`)) }));
  r.post('/', async (req, res) => {
    check(req.body);
    const cols = fields.map((f) => f.name);
    const vals = values(req.body);
    if (slugFrom) { cols.push('slug'); vals.push(await uniqueSlug(table, req.body.slug || req.body[slugFrom])); }
    const id = await unique(async () => (await db.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals)).lastInsertRowid);
    res.status(201).json({ item: (await db.get(`SELECT * FROM ${table} WHERE id = ?`, id)) });
  });
  r.put('/:id', async (req, res) => {
    check(req.body);
    const id = Number(req.params.id);
    const cols = fields.map((f) => `${f.name} = ?`);
    const vals = values(req.body);
    if (slugFrom) { cols.push('slug = ?'); vals.push(await uniqueSlug(table, req.body.slug || req.body[slugFrom], id)); }
    await unique(async () => (await db.run(`UPDATE ${table} SET ${cols.join(', ')} WHERE id = ?`, ...vals, id)));
    res.json({ item: (await db.get(`SELECT * FROM ${table} WHERE id = ?`, id)) });
  });
  r.delete('/:id', async (req, res) => {
    await tx(async () => {
      if (beforeDelete) await beforeDelete(Number(req.params.id));
      await db.run(`DELETE FROM ${table} WHERE id = ?`, Number(req.params.id));
    });
    res.json({ ok: true });
  });
  return r;
}

// ---- Categories (a tree; a category may sit under several parents) ----
async function saveCategory(body, id = 0) {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  return tx(async () => {
    const slug = await uniqueSlug('categories', body.slug || name, id);
    const vals = [name, slug, body.image || null, parseInt(body.sort, 10) || 0];
    if (id) (await db.run('UPDATE categories SET name = ?, slug = ?, image = ?, sort = ? WHERE id = ?', ...vals, id));
    else id = Number((await db.run('INSERT INTO categories(name, slug, image, sort) VALUES(?,?,?,?)', ...vals)).lastInsertRowid);
    await setParents(id, body.parent_ids);
    return (await allCategories()).find((c) => c.id === id);
  });
}
router.get('/categories', async (_req, res) => {
  const counts = Object.fromEntries((await db.all('SELECT category_id, COUNT(*) AS n FROM products GROUP BY category_id')).map((r) => [r.category_id, r.n]));
  res.json({ items: (await allCategories()).map((c) => ({ ...c, products: counts[c.id] || 0 })) });
});
router.post('/categories', async (req, res) => res.status(201).json({ item: await saveCategory(req.body) }));
router.put('/categories/:id', async (req, res) => res.json({ item: await saveCategory(req.body, Number(req.params.id)) }));
router.delete('/categories/:id', async (req, res) => {
  const id = Number(req.params.id);
  // Children of a deleted category move up to its parents, so nothing disappears from the menu.
  await tx(async () => {
    const parents = (await db.all('SELECT parent_id FROM category_parents WHERE category_id = ?', id)).map((r) => r.parent_id);
    for (const { category_id: child } of (await db.all('SELECT category_id FROM category_parents WHERE parent_id = ?', id))) {
      for (const pid of parents) (await db.run('INSERT OR IGNORE INTO category_parents(category_id, parent_id) VALUES(?, ?)', child, pid));
    }
    await db.run('DELETE FROM category_parents WHERE category_id = ? OR parent_id = ?', id, id);
    await db.run('UPDATE products SET category_id = NULL WHERE category_id = ?', id);
    await db.run('DELETE FROM categories WHERE id = ?', id);
  });
  res.json({ ok: true });
});

// ---- Bulk enquiries ----
const BULK_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
router.get('/bulk', async (req, res) => {
  const status = BULK_STATUSES.includes(String(req.query.status)) ? String(req.query.status) : null;
  res.json({
    items: (await db.all(`SELECT * FROM bulk_enquiries ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 500`, ...(status ? [status] : []))),
    counts: Object.fromEntries((await db.all('SELECT status, COUNT(*) AS n FROM bulk_enquiries GROUP BY status')).map((r) => [r.status, r.n])),
    statuses: BULK_STATUSES,
  });
});
router.put('/bulk/:id', async (req, res) => {
  const { status, notes } = req.body;
  if (status && !BULK_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  (await db.run('UPDATE bulk_enquiries SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?', status || null, notes ?? null, Number(req.params.id)));
  res.json({ ok: true });
});
router.delete('/bulk/:id', async (req, res) => {
  (await db.run('DELETE FROM bulk_enquiries WHERE id = ?', Number(req.params.id)));
  res.json({ ok: true });
});
router.use('/collections', crud('collections', [
  { name: 'name', required: true }, { name: 'description' }, { name: 'image' }, { name: 'sort', type: 'int' },
], { slugFrom: 'name', beforeDelete: (id) => db.run('UPDATE products SET collection_id = NULL WHERE collection_id = ?', id) }));
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
router.get('/reviews', async (req, res) => {
  const where = req.query.status === 'pending' ? 'WHERE r.approved = 0' : req.query.status === 'approved' ? 'WHERE r.approved = 1' : '';
  const rows = (await db.all(`SELECT r.*, p.name AS product_name, p.slug AS product_slug, u.email FROM reviews r
    JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id ${where} ORDER BY r.approved ASC, r.id DESC LIMIT 500`));
  res.json({ reviews: rows, pending: (await db.get('SELECT COUNT(*) AS n FROM reviews WHERE approved = 0')).n });
});
router.put('/reviews/:id', async (req, res) => {
  (await db.run('UPDATE reviews SET approved = ? WHERE id = ?', req.body.approved ? 1 : 0, Number(req.params.id)));
  res.json({ ok: true });
});
router.delete('/reviews/:id', async (req, res) => {
  (await db.run('DELETE FROM reviews WHERE id = ?', Number(req.params.id)));
  res.json({ ok: true });
});

// ---- Policy pages ----
router.get('/pages', async (_req, res) => {
  res.json({ pages: (await db.all('SELECT slug, title, body, updated_at FROM pages ORDER BY id')) });
});
router.put('/pages/:slug', async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) throw new HttpError(400, 'Title is required');
  const r = (await db.run("UPDATE pages SET title = ?, body = ?, updated_at = datetime('now') WHERE slug = ?", title, String(req.body.body || ''), req.params.slug));
  if (!r.changes) throw new HttpError(404, 'Page not found');
  res.json({ ok: true });
});
router.post('/pages/preview', async (req, res) => {
  res.json({ html: await renderBody(req.body.body || '') });
});

// ---- Integrations ----
async function webhookToken() {
  let t = (await getSettings()).shiprocket_webhook_token;
  if (!t) {
    t = crypto.randomBytes(18).toString('base64url');
    await setSettings({ shiprocket_webhook_token: t });
  }
  return t;
}

router.get('/integrations', async (req, res) => {
  const s = await getSettings();
  res.json({
    status: {
      razorpay: !!(await payments.razorpayConfig()),
      email: await mailer.isConfigured(),
      gst: await gstActive(s),
      shiprocket: await shiprocket.configured(s),
      whatsapp: await whatsapp.configured(s),
      sms: await sms.configured(s),
    },
    variables: notify.VARIABLES,
    webhooks: {
      razorpay: `${base(req)}/api/razorpay/webhook`,
      shiprocket: `${base(req)}/api/courier/webhook`,
      shiprocket_token: await webhookToken(),
    },
    recent: (await db.all(`SELECT n.channel, n.event, n.recipient, n.ok, n.detail, n.created_at, o.order_no FROM notification_log n
      LEFT JOIN orders o ON o.id = n.order_id ORDER BY n.id DESC LIMIT 15`)),
  });
});

router.post('/integrations/test', async (req, res, next) => {
  const { channel, to } = req.body;
  const s = await getSettings();
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
async function settingsForAdmin() {
  const s = await getSettings();
  const out = { ...s, secrets_set: {} };
  for (const k of SECRET_SETTINGS) { out.secrets_set[k] = !!s[k]; out[k] = ''; }
  return out;
}
router.get('/settings', async (_req, res) => res.json({ settings: await settingsForAdmin() }));
router.put('/settings', async (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.content_version; // managed by the store itself
  if (body.gstin !== undefined) {
    body.gstin = String(body.gstin).trim().toUpperCase();
    if (body.gstin && !GSTIN_RE.test(body.gstin)) throw new HttpError(400, 'That GSTIN doesn’t look right — it should be 15 characters, e.g. 29ABCDE1234F1Z5');
    // The first two digits are the state code, which decides CGST+SGST vs IGST.
    const state = body.gstin && Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === body.gstin.slice(0, 2));
    if (state) body.business_state = state;
  }
  await setSettings(body);
  res.json({ settings: await settingsForAdmin() });
});
router.post('/settings/test-email', async (req, res, next) => {
  try {
    await mailer.testEmail(req.body.to || req.user.email);
    res.json({ ok: true });
  } catch (err) {
    next(new HttpError(400, `Email failed: ${err.message}`));
  }
});

router.put('/password', async (req, res) => {
  const { current, next } = req.body;
  const u = (await db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id));
  if (!verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  if (String(next || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  (await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id));
  // Sign out every other device that was using the old password.
  const thisSession = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  (await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', req.user.id, thisSession || ''));
  res.json({ ok: true });
});

module.exports = router;

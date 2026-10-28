const crypto = require('crypto');
const { db, tx, getSettings } = require('./db');
const { razorpayConfig } = require('./payments');
const { localDate } = require('./time');

const MAX_QTY = 20; // per item in one online order; larger quantities go through Bulk Order

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // message is written for the customer, safe to show even for 5xx
  }
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || crypto.randomBytes(3).toString('hex');
}

async function uniqueSlug(table, base, excludeId = 0) {
  let slug = slugify(base);
  let n = 1;
  while ((await db.get(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`, slug, excludeId))) {
    slug = `${slugify(base)}-${++n}`;
  }
  return slug;
}

async function serializeProduct(p, { withVariants = true } = {}) {
  if (!p) return null;
  const out = { ...p, images: JSON.parse(p.images || '[]'), is_trending: !!p.is_trending, is_featured: !!p.is_featured };
  if (withVariants) {
    out.variants = (await db.all('SELECT id, label, sku, stock, image FROM variants WHERE product_id = ? ORDER BY id', p.id));
    out.stock = out.variants.reduce((s, v) => s + v.stock, 0);
  }
  return out;
}

// Validates a coupon against a subtotal; returns { coupon, discount } or throws.
async function evaluateCoupon(code, subtotal) {
  if (!code) return { coupon: null, discount: 0 };
  const c = (await db.get('SELECT * FROM coupons WHERE code = ?', String(code).trim()));
  if (!c || !c.active) throw new HttpError(400, 'Invalid coupon code');
  // Valid through the whole expiry day in store time (dates are stored as YYYY-MM-DD).
  if (c.expires_at && String(c.expires_at).slice(0, 10) < localDate()) throw new HttpError(400, 'This coupon has expired');
  if (c.usage_limit && c.used_count >= c.usage_limit) throw new HttpError(400, 'This coupon has reached its usage limit');
  if (subtotal < c.min_order) throw new HttpError(400, `Add items worth ₹${c.min_order - subtotal} more to use this coupon`);
  let discount = c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value;
  if (c.max_discount) discount = Math.min(discount, c.max_discount);
  return { coupon: c, discount: Math.min(discount, subtotal) };
}

// Prices a cart from the database. items: [{ variant_id, qty }]
async function quote(items, couponCode) {
  if (!Array.isArray(items)) throw new HttpError(400, 'Invalid cart');
  const settings = await getSettings();
  const lines = [];
  const issues = [];
  for (const it of items) {
    const asked = Math.max(1, parseInt(it.qty, 10) || 1);
    const qty = Math.min(MAX_QTY, asked);
    const row = (await db.get(`
      SELECT v.id AS variant_id, v.label AS size, v.sku, v.stock, v.image AS variant_image, p.id AS product_id, p.name, p.slug, p.price, p.mrp, p.images, p.status, p.hsn, p.gst_rate
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`, it.variant_id));
    if (!row || row.status !== 'active') {
      issues.push({ variant_id: it.variant_id, message: 'This item is no longer available' });
      continue;
    }
    const line = {
      variant_id: row.variant_id,
      product_id: row.product_id,
      name: row.name,
      slug: row.slug,
      size: row.size,
      sku: row.sku,
      hsn: row.hsn,
      gst_rate: row.gst_rate,
      price: row.price,
      mrp: row.mrp,
      image: row.variant_image || JSON.parse(row.images || '[]')[0] || null,
      qty,
      stock: row.stock,
      line_total: row.price * qty,
    };
    if (row.stock < asked) issues.push({ variant_id: row.variant_id, message: row.stock ? `Only ${row.stock} left in stock` : 'Out of stock' });
    else if (asked > MAX_QTY) issues.push({ variant_id: row.variant_id, message: `You can order up to ${MAX_QTY} of each item online — for more, use Bulk Order` });
    lines.push(line);
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  let discount = 0;
  let couponError = null;
  let appliedCoupon = null;
  if (couponCode) {
    try {
      const r = await evaluateCoupon(couponCode, subtotal);
      discount = r.discount;
      appliedCoupon = r.coupon.code;
    } catch (e) {
      couponError = e.message;
    }
  }
  const freeAbove = parseInt(settings.free_shipping_above, 10) || 0;
  const fee = parseInt(settings.shipping_fee, 10) || 0;
  const shipping = subtotal === 0 || (freeAbove && subtotal - discount >= freeAbove) ? 0 : fee;
  return {
    gst: gstIncluded(lines, subtotal, discount, shipping, settings),
    lines,
    issues,
    subtotal,
    discount,
    shipping,
    total: subtotal - discount + shipping,
    coupon: appliedCoupon,
    coupon_error: couponError,
    free_shipping_above: freeAbove,
  };
}

// GST already inside the prices (all prices are tax-inclusive), worked out the same way as the invoice:
// the discount is spread across lines by value, and shipping takes the highest rate in the order.
// Returns null when the store isn't GST-registered yet, so nothing is shown to customers.
function gstIncluded(lines, subtotal, discount, shipping, settings) {
  if (settings.gst_enabled !== '1' || !settings.gstin) return null;
  const fallback = parseFloat(settings.gst_rate) || 0;
  let tax = 0;
  let top = fallback;
  for (const l of lines) {
    const rate = l.gst_rate ?? fallback;
    const net = l.line_total - (subtotal ? (discount * l.line_total) / subtotal : 0);
    tax += (net * rate) / (100 + rate);
    top = Math.max(top, rate);
  }
  tax += (shipping * top) / (100 + top);
  return Math.round(tax * 100) / 100;
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// JK + store-local YYMMDD + 5 random digits. Checked for uniqueness (runs inside placeOrder's transaction).
async function newOrderNo() {
  const ymd = localDate().slice(2).replace(/-/g, '');
  for (let i = 0; i < 20; i++) {
    const no = `JK${ymd}${crypto.randomInt(10000, 100000)}`;
    if (!(await db.get('SELECT 1 FROM orders WHERE order_no = ?', no))) return no;
  }
  throw new HttpError(503, 'Could not create an order number, please try again');
}

const REQUIRED = ['name', 'email', 'phone', 'address', 'city', 'state', 'pincode'];

async function placeOrder({ items, coupon, customer, payment_method, notes }, user) {
  for (const f of REQUIRED) {
    if (!customer || !String(customer[f] || '').trim()) throw new HttpError(400, `Please fill in ${f}`);
  }
  if (!/^\d{6}$/.test(String(customer.pincode).trim())) throw new HttpError(400, 'Pincode must be 6 digits');
  if (!/^[+\d\s-]{10,15}$/.test(String(customer.phone).trim())) throw new HttpError(400, 'Enter a valid phone number');
  // Optional business details for a GST invoice (lets a registered business claim input tax credit).
  const buyerGstin = String(customer.gstin || '').trim().toUpperCase() || null;
  const buyerCompany = String(customer.company || '').trim().slice(0, 150) || null;
  if (buyerGstin && !GSTIN_RE.test(buyerGstin)) throw new HttpError(400, 'Enter a valid 15-character GSTIN, e.g. 29ABCDE1234F1Z5');
  if (buyerGstin && !buyerCompany) throw new HttpError(400, 'Enter the business name registered with this GSTIN');
  const settings = await getSettings();
  const method = payment_method === 'online' ? 'online' : 'cod';
  if (method === 'cod' && settings.cod_enabled !== '1') throw new HttpError(400, 'Cash on delivery is not available');
  if (method === 'online' && settings.online_enabled !== '1') throw new HttpError(400, 'Online payment is not available');

  // With Razorpay keys set, online orders wait for a verified payment; without them, online payment is simulated.
  const gateway = method === 'online' && (await razorpayConfig()) ? 'razorpay' : null;
  const prepaidDemo = method === 'online' && !gateway;

  return tx(async () => {
    const q = await quote(items, coupon);
    if (!q.lines.length) throw new HttpError(400, 'Your cart is empty');
    if (q.issues.length) throw new HttpError(409, q.issues[0].message);
    if (coupon && q.coupon_error) throw new HttpError(400, q.coupon_error);

    const orderNo = await newOrderNo();
    const c = customer;
    const res = (await db.run(`
      INSERT INTO orders(order_no, user_id, name, email, phone, address, city, state, pincode,
        subtotal, discount, shipping, total, coupon_code, payment_method, payment_status, status, notes, buyer_company, buyer_gstin)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, orderNo, user ? user.id : null, c.name.trim(), c.email.trim(), c.phone.trim(), c.address.trim(),
      c.city.trim(), c.state.trim(), String(c.pincode).trim(), q.subtotal, q.discount, q.shipping, q.total,
      q.coupon, method,
      prepaidDemo ? 'paid' : 'pending',
      prepaidDemo ? 'confirmed' : 'pending',
      notes ? String(notes).slice(0, 500) : null,
      buyerGstin ? buyerCompany : null, buyerGstin));
    const orderId = Number(res.lastInsertRowid);
    // HSN and GST rate are copied onto the order so later rate changes don't alter past invoices.
    const defaultRate = parseFloat(settings.gst_rate) || 0;
    for (const l of q.lines) {
      // Only succeeds if there is still enough stock — two shoppers can't both buy the last one.
      const r = await db.run('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?', l.qty, l.variant_id, l.qty);
      if (!r.changes) throw new HttpError(409, `${l.name} (${l.size}) just went out of stock`);
      await db.run('INSERT INTO order_items(order_id, product_id, variant_id, name, size, image, price, qty, hsn, gst_rate) VALUES(?,?,?,?,?,?,?,?,?,?)',
        orderId, l.product_id, l.variant_id, l.name, l.size, l.image, l.price, l.qty, l.hsn || settings.hsn_default || null, l.gst_rate ?? defaultRate);
    }
    if (q.coupon) (await db.run('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', q.coupon));
    (await db.run('INSERT INTO order_events(order_id, status, note) VALUES(?, ?, ?)', orderId, 'pending', gateway ? 'Order placed — awaiting payment' : 'Order placed'));
    if (prepaidDemo) (await db.run('INSERT INTO order_events(order_id, status, note) VALUES(?, ?, ?)', orderId, 'confirmed', 'Payment received (demo)'));
    const order = await getOrder(orderId);
    order.gateway = gateway;
    return order;
  });
}

async function getOrder(id) {
  const o = (await db.get('SELECT * FROM orders WHERE id = ?', id));
  if (!o) return null;
  o.items = (await db.all('SELECT * FROM order_items WHERE order_id = ?', id));
  o.events = (await db.all('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id', id));
  return o;
}

// Adds stock back (sign = 1) or takes it again (sign = -1) for every item in an order.
async function adjustStock(orderId, sign) {
  for (const it of (await db.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', orderId))) {
    (await db.run('UPDATE variants SET stock = MAX(0, stock + ?) WHERE id = ?', sign * it.qty, it.variant_id));
  }
}

// Idempotent: returns false if the order was already paid.
async function markPaid(orderId, paymentId, note = 'Payment received') {
  return tx(async () => {
    const o = (await db.get('SELECT status, payment_status FROM orders WHERE id = ?', orderId));
    if (!o || o.payment_status === 'paid') return false;
    // A payment can land after an abandoned order was auto-cancelled; reopen it and take the stock again.
    if (o.status === 'cancelled') await adjustStock(orderId, -1);
    const status = ['pending', 'cancelled'].includes(o.status) ? 'confirmed' : o.status;
    (await db.run("UPDATE orders SET payment_status = 'paid', payment_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?", paymentId || null, status, orderId));
    (await db.run('INSERT INTO order_events(order_id, status, note) VALUES(?, ?, ?)', orderId, status, note));
    return true;
  });
}

// An order that is cancelled before anyone paid for it shouldn't use up one of the coupon's uses.
async function releaseCoupon(o) {
  if (o.coupon_code && o.payment_status !== 'paid') {
    (await db.run('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?', o.coupon_code));
  }
}

async function cancelOrder(orderId, note) {
  await tx(async () => {
    const o = (await db.get('SELECT status, coupon_code, payment_status FROM orders WHERE id = ?', orderId));
    if (!o || ['cancelled', 'returned'].includes(o.status)) return;
    await adjustStock(orderId, 1);
    await releaseCoupon(o);
    (await db.run("UPDATE orders SET status = 'cancelled', payment_status = CASE WHEN payment_status = 'pending' THEN 'failed' ELSE payment_status END, updated_at = datetime('now') WHERE id = ?", orderId));
    (await db.run("INSERT INTO order_events(order_id, status, note) VALUES(?, 'cancelled', ?)", orderId, note || null));
  });
}

const ORDER_STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];

module.exports = { GSTIN_RE, HttpError, slugify, uniqueSlug, serializeProduct, quote, placeOrder, getOrder, evaluateCoupon, adjustStock, releaseCoupon, markPaid, cancelOrder, ORDER_STATUSES };

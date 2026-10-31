const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

// Where the data lives:
// - On Vercel (or anywhere with TURSO_DATABASE_URL set): a Turso database over the network.
// - Everywhere else: a local SQLite file (data/store.db), as before.
const REMOTE_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const ON_VERCEL = !!process.env.VERCEL;

// Setup problems are collected instead of thrown, so the site can show a page explaining what's missing
// (a crash at start-up only shows Vercel's generic "FUNCTION_INVOCATION_FAILED").
const CONFIG_PROBLEMS = [];
if (ON_VERCEL && !REMOTE_URL) {
  CONFIG_PROBLEMS.push('TURSO_DATABASE_URL is not set. Connect a Turso database: Vercel → Storage → Create Database → Turso (Mumbai region), then redeploy.');
}
if (REMOTE_URL && /turso\.io/.test(REMOTE_URL) && !process.env.TURSO_AUTH_TOKEN) {
  CONFIG_PROBLEMS.push('TURSO_AUTH_TOKEN is not set. Add the database token from Turso (or reconnect the Turso integration), then redeploy.');
}
// Never touch the disk on Vercel: it's read-only there, and a write error at start-up crashes the function.
if (!REMOTE_URL && !ON_VERCEL) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (!ON_VERCEL) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Online databases use the pure-JavaScript client (nothing native to load on Vercel); the local-file client,
// which needs a native SQLite library, is only loaded when it's actually used.
function makeClient() {
  if (CONFIG_PROBLEMS.length) return null;
  if (REMOTE_URL) return require('@libsql/client/web').createClient({ url: REMOTE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  return require('@libsql/client').createClient({ url: 'file:' + DB_PATH });
}
const client = makeClient();
const noDatabase = () => { throw Object.assign(new Error(CONFIG_PROBLEMS.join(' ')), { status: 503, expose: true }); };

// Rows come back as array-like objects; hand the rest of the app plain { column: value } objects.
const plain = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));
const stmt = (sql, args) => ({ sql, args: args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a)) });

// Queries run inside the current transaction (if tx() is active for this request), otherwise on the client.
const txStore = new AsyncLocalStorage();
const runner = () => txStore.getStore() || client || noDatabase();

const db = {
  async get(sql, ...args) { return plain(await runner().execute(stmt(sql, args)))[0]; },
  async all(sql, ...args) { return plain(await runner().execute(stmt(sql, args))); },
  async run(sql, ...args) {
    const rs = await runner().execute(stmt(sql, args));
    return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
  },
  // Several statements separated by semicolons (schema setup); not for user input.
  async exec(sql) { return runner().executeMultiple(sql); },
};

// Runs fn inside one write transaction. Nested calls join the transaction that's already open.
async function tx(fn) {
  if (txStore.getStore()) return fn();
  const t = await (client || noDatabase()).transaction('write');
  try {
    const out = await txStore.run(t, fn);
    await t.commit();
    return out;
  } catch (err) {
    try { await t.rollback(); } catch { /* connection already gone */ }
    throw err;
  } finally {
    t.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price INTEGER NOT NULL,
  mrp INTEGER,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  images TEXT NOT NULL DEFAULT '[]',
  tags TEXT,
  is_trending INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT,
  stock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  coupon_code TEXT,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  courier TEXT,
  tracking_no TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  variant_id INTEGER,
  name TEXT NOT NULL,
  size TEXT,
  image TEXT,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL DEFAULT 'percent',
  value INTEGER NOT NULL,
  min_order INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT,
  image TEXT,
  link TEXT,
  button_text TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  text TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS category_parents (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, parent_id)
);
CREATE TABLE IF NOT EXISTS bulk_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT,
  products TEXT,
  quantity INTEGER,
  customization TEXT,
  needed_by TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoice_counters (
  fy TEXT PRIMARY KEY,
  last INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  recipient TEXT,
  ok INTEGER NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, approved);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`;

// Columns added after the first release; add them to existing databases.
const MIGRATIONS = [
  ['orders', 'payment_ref', 'TEXT'],
  ['orders', 'payment_id', 'TEXT'],
  ['orders', 'invoice_no', 'TEXT'],
  ['orders', 'invoice_date', 'TEXT'],
  ['orders', 'shiprocket_order_id', 'TEXT'],
  ['orders', 'shiprocket_shipment_id', 'TEXT'],
  ['orders', 'label_url', 'TEXT'],
  ['orders', 'tracking_status', 'TEXT'],
  ['products', 'hsn', 'TEXT'],
  ['products', 'gst_rate', 'REAL'],
  ['order_items', 'hsn', 'TEXT'],
  ['order_items', 'gst_rate', 'REAL'],
  ['variants', 'image', 'TEXT'],
  ['banners', 'kicker', 'TEXT'],
  ['banners', 'theme', "TEXT NOT NULL DEFAULT 'light'"],
  ['banners', 'image_label', 'TEXT'],
  ['banners', 'image2', 'TEXT'],
  ['banners', 'image2_label', 'TEXT'],
  ['orders', 'buyer_company', 'TEXT'],
  ['orders', 'buyer_gstin', 'TEXT'],
  ['bulk_enquiries', 'gstin', 'TEXT'],
];

// Creates tables and adds columns introduced after the first release. Safe to run on every start.
async function migrate() {
  if (!client) noDatabase();
  if (!REMOTE_URL) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await client.executeMultiple(SCHEMA);
  for (const [table, col, type] of MIGRATIONS) {
    const has = await db.get(`SELECT 1 AS ok FROM pragma_table_info('${table}') WHERE name = ?`, col);
    if (has) continue;
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch (err) {
      // Another server instance starting at the same moment may have just added it.
      if (!/duplicate column name/i.test(err.message)) throw err;
    }
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref)');
}

const DEFAULT_SETTINGS = {
  store_name: 'Jinke',
  tagline: 'Kannada pride, worn around the world.',
  announcement: 'Free shipping across India on orders above ₹999',
  // Header menu, one item per line: "Label | link". A link to a category with sub-categories becomes a dropdown.
  nav_menu: [
    'Home | /',
    'Apparels | /shop?category=apparels',
    'Rajyotsava Special | /shop?collection=rajyotsava-special',
    'Fridge Magnets | /shop?category=fridge-magnets',
    'Tote Bags | /shop?category=tote-bags',
    'About | /pages/about',
    'Caps | /shop?category=caps',
  ].join('\n'),
  content_version: '0', // one-time catalogue updates already applied to this database (see lib/seed.js)
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  email: 'jinke.wear@gmail.com',
  address: 'Bengaluru, Karnataka, India',
  shipping_fee: '79',
  free_shipping_above: '999',
  cod_enabled: '1',
  online_enabled: '1',
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  youtube: 'https://youtube.com/',
  logo: '/assets/brand/logo.png',
  bulk_min_qty: '25',
  business_name: '',
  gstin: '',
  grievance_officer: '',
  jurisdiction: 'Bengaluru, Karnataka',
  // GST invoices
  gst_enabled: '1', // tax invoices start as soon as a GSTIN is saved
  gst_rate: '5',
  hsn_default: '6109',
  business_state: 'Karnataka',
  invoice_prefix: 'INV',
  // Shiprocket
  shiprocket_email: '',
  shiprocket_password: '',
  shiprocket_pickup: 'Primary',
  shiprocket_webhook_token: '',
  pkg_weight: '0.3',
  pkg_length: '25',
  pkg_breadth: '20',
  pkg_height: '3',
  // WhatsApp Cloud API (Meta)
  whatsapp_enabled: '0',
  whatsapp_phone_id: '',
  whatsapp_token: '',
  whatsapp_lang: 'en',
  wa_tpl_order: '',
  wa_tpl_shipped: '',
  wa_tpl_delivered: '',
  wa_tpl_cancelled: '',
  wa_tpl_admin: '',
  wa_admin_numbers: '',
  // SMS via MSG91 (DLT-approved flows)
  sms_enabled: '0',
  msg91_authkey: '',
  msg91_tpl_order: '',
  msg91_tpl_shipped: '',
  msg91_tpl_delivered: '',
  msg91_tpl_cancelled: '',
  razorpay_key_id: '',
  razorpay_key_secret: '',
  razorpay_webhook_secret: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  mail_from: '',
};

// Never sent to the browser; the admin API only reports whether they are set.
// Never sent to the browser; the admin API only reports whether they are set.
const SECRET_SETTINGS = ['razorpay_key_secret', 'razorpay_webhook_secret', 'smtp_pass', 'shiprocket_password', 'whatsapp_token', 'msg91_authkey'];

// Settings are read on almost every request; cache them briefly (other server instances catch up within seconds).
let cache = { at: 0, value: null };
const CACHE_MS = 3000;

async function getSettings() {
  if (cache.value && Date.now() - cache.at < CACHE_MS && !txStore.getStore()) return { ...cache.value };
  const rows = await db.all('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  if (!txStore.getStore()) cache = { at: Date.now(), value: out };
  return { ...out };
}

async function setSettings(obj) {
  await tx(async () => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      // A blank secret means "keep the saved one"; secrets are cleared via clear_<key>.
      if (SECRET_SETTINGS.includes(k) && !v && !obj[`clear_${k}`]) continue;
      await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v ?? '').trim());
    }
  });
  cache = { at: 0, value: null };
}

module.exports = { CONFIG_PROBLEMS, db, tx, migrate, getSettings, setSettings, SECRET_SETTINGS, DB_PATH, UPLOADS_DIR, REMOTE_URL, ON_VERCEL, client };

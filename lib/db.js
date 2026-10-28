const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'store.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
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
`);

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
for (const [table, col, type] of MIGRATIONS) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref)');

function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const DEFAULT_SETTINGS = {
  store_name: 'Jinke',
  tagline: 'Kannada pride, worn around the world.',
  announcement: 'Free shipping across India on orders above ₹999',
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
const SECRET_SETTINGS = ['razorpay_key_secret', 'razorpay_webhook_secret', 'smtp_pass', 'shiprocket_password', 'whatsapp_token', 'msg91_authkey'];

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      // A blank secret means "keep the saved one"; secrets are cleared via clear_<key>.
      if (SECRET_SETTINGS.includes(k) && !v && !obj[`clear_${k}`]) continue;
      stmt.run(k, String(v ?? '').trim());
    }
  });
}

module.exports = { db, tx, getSettings, setSettings, SECRET_SETTINGS, DB_PATH, UPLOADS_DIR };

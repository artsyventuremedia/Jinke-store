const crypto = require('crypto');
const { db, tx, migrate, DB_PATH, REMOTE_URL } = require('./db');
const { hashPassword } = require('./auth');
const { slugify } = require('./shop');

// Launch photos live in public/assets/products, served as static files (by Vercel's CDN when deployed there).
const photo = (file) => `/assets/products/${file}`;

// [name, parent names, photo for its tile]. Caps sits under both Apparels and Merchandise.
const CATEGORIES = [
  ['Apparels', [], 'kannada-heritage-tee.jpg'],
  ['Merchandise', [], 'kannada-heritage-cap-grey.jpg'],
  ['T-Shirts', ['Apparels'], 'karnataka-folk-map-tee.jpg'],
  ['Round Neck', ['T-Shirts'], 'ka-mysuru-dasara-tee.jpg'],
  ['Collar', ['T-Shirts'], null],
  ['Hoodies', ['Apparels'], null],
  ['Sweatshirts', ['Apparels'], null],
  ['Caps', ['Apparels', 'Merchandise'], 'kannada-heritage-cap-red.jpg'],
  ['Fridge Magnets', ['Merchandise'], null],
  ['Bottles', ['Merchandise'], null],
  ['Key Chains', ['Merchandise'], null],
];

const COLLECTIONS = [
  ['Kannada Heritage', 'Karnataka’s palaces, temples, wildlife and culture, packed into every letter of ಕನ್ನಡ', 'kannada-heritage-tee.jpg'],
  ['Folk Karnataka', 'The folk arts of Karnataka — drummers, dancers and wrestlers — on everyday wear', 'karnataka-folk-map-tee.jpg'],
  ['Mysuru Dasara', 'The palace, the lights and the Jamboo Savari', 'ka-mysuru-dasara-tee.jpg'],
];

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const TEE_DETAILS = `
• Black, round neck, half sleeves
• Full-colour artwork
• Available in S to XXL — see the size chart`;

// Jinke's launch range. Prices, stock and descriptions are a starting point — edit them in Admin → Products.
const PRODUCTS = [
  {
    name: 'Kannada Heritage Tee', category: 'Round Neck', collection: 'Kannada Heritage', price: 699, mrp: 899, trending: 1, featured: 1, hsn: '6109',
    photos: ['kannada-heritage-tee.jpg', 'kannada-heritage-tee-her.jpg'],
    description: `The word ಕನ್ನಡ, filled with Karnataka: Mysuru Palace and the Dasara elephant, the stone chariot of Hampi, temple towers, a tiger and wild elephants from our forests, painted storks, the Brindavan Gardens fountains, a classical dancer and Mysuru silk.${TEE_DETAILS}`,
  },
  {
    name: 'Karnataka Folk Map Tee', category: 'Round Neck', collection: 'Folk Karnataka', price: 749, mrp: 949, trending: 1, featured: 1, hsn: '6109',
    photos: ['karnataka-folk-map-tee.jpg'],
    description: `A map of Karnataka brought alive by its folk arts — dancers, drummers, performers and Kusti wrestlers from every corner of the state — with a small ಕನ್ನಡ heritage print on the chest.${TEE_DETAILS}`,
  },
  {
    name: 'Kannada Chest Print Tee', category: 'Round Neck', collection: 'Kannada Heritage', price: 599, mrp: 749, trending: 0, featured: 1, hsn: '6109',
    photos: ['kannada-chest-print-tee.jpg'],
    description: `Simple and easy to wear every day: our ಕನ್ನಡ heritage artwork as a small print on the left chest.${TEE_DETAILS}`,
  },
  {
    name: 'Ka Mysuru Dasara Tee', category: 'Round Neck', collection: 'Mysuru Dasara', price: 699, mrp: 899, trending: 1, featured: 0, hsn: '6109',
    photos: ['ka-mysuru-dasara-tee.jpg', 'ka-mysuru-dasara-tee-her.jpg'],
    description: `ಕ — the first letter of Kannada — lit up with Mysuru Palace at Dasara and the decorated elephant of the Jamboo Savari.${TEE_DETAILS}`,
  },
  {
    name: 'Kannada Folk Parade Tee', category: 'Round Neck', collection: 'Folk Karnataka', price: 799, mrp: 999, trending: 1, featured: 1, hsn: '6109',
    photos: ['kannada-folk-parade-tee-front.jpg', 'kannada-folk-parade-tee-back.jpg'],
    description: `Front and back print. ಕನ್ನಡ heritage lettering on the chest with a parade of folk performers along the hem, and more on the back — a sword-bearing performer, Kusti wrestlers and a Dollu Kunitha drummer.${TEE_DETAILS}`,
  },
  {
    name: 'Kannada Heritage Cap', category: 'Caps', collection: 'Kannada Heritage', price: 499, mrp: 649, trending: 1, featured: 1, hsn: '6505',
    photos: ['kannada-heritage-cap-black.jpg', 'kannada-heritage-cap-grey.jpg', 'kannada-heritage-cap-red.jpg'],
    // Colour options, each showing its own photo.
    variants: [['Black', 0], ['Grey', 1], ['Red', 2]],
    description: `Our ಕನ್ನಡ heritage artwork on a classic cap.

• Available in black, grey and red
• Full-colour printed artwork
• Adjustable strap — one size fits most`,
  },
];

// The store itself: categories, collections, products, banners. Loaded on every fresh install.
async function seedCatalog({ demo }) {
  const rand = mulberry32(42);
  const catId = {};
  for (const [i, [name, , img]] of CATEGORIES.entries()) {
    catId[name] = Number((await db.run('INSERT INTO categories(name, slug, image, sort) VALUES(?,?,?,?)', name, slugify(name), img ? photo(img) : null, i)).lastInsertRowid);
  }
  for (const [name, parents] of CATEGORIES) {
    for (const parent of parents) (await db.run('INSERT INTO category_parents(category_id, parent_id) VALUES(?, ?)', catId[name], catId[parent]));
  }
  const colId = {};
  for (const [i, [name, desc, img]] of COLLECTIONS.entries()) {
    colId[name] = Number((await db.run('INSERT INTO collections(name, slug, description, image, sort) VALUES(?,?,?,?,?)', name, slugify(name), desc, photo(img), i)).lastInsertRowid);
  }

  const variants = [];
  for (const [i, p] of PRODUCTS.entries()) {
    const images = p.photos.map(photo);
    const created = new Date(Date.now() - (PRODUCTS.length - i) * 864e5).toISOString().replace('T', ' ').slice(0, 19);
    const pid = Number((await db.run(`INSERT INTO products(name, slug, description, price, mrp, category_id, collection_id, images, tags, is_trending, is_featured, created_at, hsn)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, p.name, slugify(p.name), p.description, p.price, p.mrp, catId[p.category], colId[p.collection], JSON.stringify(images),
      `${p.category}, ${p.collection}, kannada, karnataka`, p.trending, p.featured, created, p.hsn)).lastInsertRowid);
    const opts = p.variants || SIZES.map((s) => [s, null]);
    for (const [label, imgIndex] of opts) {
      const stock = demo ? Math.floor(rand() * 40) + 2 : 20;
      const vid = Number((await db.run('INSERT INTO variants(product_id, label, sku, stock, image) VALUES(?,?,?,?,?)', pid, label, `JK-${pid}-${slugify(label)}`.toUpperCase(), stock, imgIndex == null ? null : images[imgIndex])).lastInsertRowid);
      variants.push({ vid, pid, name: p.name, label, price: p.price, image: imgIndex == null ? images[0] : images[imgIndex] });
    }
  }

  // Home page slides. The "For her" photos are mockups (see lib/seed-assets/CREDITS.md) — swap in your own shoot in Admin → Banners.
  const banners = [
    { theme: 'karnataka', kicker: 'ನವೆಂಬರ್ 1 · Kannada Rajyotsava', title: 'ಸಿರಿಗನ್ನಡಂ ಗೆಲ್ಗೆ',
      subtitle: 'Celebrate Rajyotsava in the colours of Karnataka — the Kannada Heritage tee, for him and for her, wherever in the world you are.',
      link: '/product/kannada-heritage-tee', btn: 'Shop the Heritage tee',
      image: 'kannada-heritage-tee.jpg', label: 'For him', image2: 'kannada-heritage-tee-her.jpg', label2: 'For her' },
    { theme: 'light', kicker: 'Mysuru Dasara edit', title: 'Wear the festival',
      subtitle: 'ಕ — the first letter of Kannada, lit up with Mysuru Palace and the Jamboo Savari. Made for him and her.',
      link: '/product/ka-mysuru-dasara-tee', btn: 'Shop the Dasara tee',
      image: 'ka-mysuru-dasara-tee.jpg', label: 'For him', image2: 'ka-mysuru-dasara-tee-her.jpg', label2: 'For her' },
    { theme: 'dark', kicker: 'New drop · Front & back print', title: 'Wear your roots',
      subtitle: 'The Folk Parade tee: ಕನ್ನಡ on the chest, and Karnataka’s drummers, dancers and wrestlers marching round the hem.',
      link: '/product/kannada-folk-parade-tee', btn: 'Shop the Folk Parade tee',
      image: 'kannada-folk-parade-tee-front.jpg', label: 'Front', image2: 'kannada-folk-parade-tee-back.jpg', label2: 'Back' },
    { theme: 'light', kicker: 'Teams · Events · Gifting', title: 'Bulk & corporate orders',
      subtitle: 'Kannada tees and caps for your team, college fest or Rajyotsava celebration — with your logo if you like.',
      link: '/bulk-order', btn: 'Get a quote',
      image: 'karnataka-folk-map-tee.jpg', label: 'Folk Map', image2: 'kannada-heritage-cap-red.jpg', label2: 'Heritage cap' },
  ];
  for (const [i, b] of banners.entries()) {
    (await db.run(`INSERT INTO banners(kicker, title, subtitle, theme, image, image_label, image2, image2_label, link, button_text, sort, active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`, b.kicker, b.title, b.subtitle, b.theme, photo(b.image), b.label, photo(b.image2), b.label2, b.link, b.btn, i));
  }
  return { variants, rand };
}

// Demo only: a coupon, testimonials, reviews, customers and ~60 days of orders so every screen has something to show.
async function seedDemoActivity({ variants, rand }) {
  (await db.run("INSERT INTO coupons(code, type, value, min_order, max_discount, active) VALUES('NAMMA10', 'percent', 10, 499, 300, 1)"));
  (await db.run("INSERT INTO coupons(code, type, value, min_order, active) VALUES('FLAT150', 'flat', 150, 1499, 1)"));
  // Written directly: setSettings opens its own transaction and we're already inside one.
  (await db.run("INSERT INTO settings(key, value) VALUES('announcement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", 'Free shipping across India on orders above ₹999 · Use code NAMMA10 for 10% off'));

  const TESTIMONIALS = [
    ['Ananya R.', 'Customer, Bengaluru', 'The print quality is amazing and the colours really pop. Got so many compliments on my Kannada Heritage tee!'],
    ['Karthik S.', 'Customer, Mysuru', 'Finally a brand that makes Kannada look this cool. The Dasara tee is my new favourite.'],
    ['Divya & Rohan', 'Customers, London', 'Ordered tees for the whole family for Rajyotsava. Feels like a piece of home, wherever we are.'],
  ];
  for (const [n, r, t] of TESTIMONIALS) await db.run('INSERT INTO testimonials(name, role, text, rating) VALUES(?,?,?,5)', n, r, t);

  const REVIEWS = [
    [1, 'Ananya R.', 5, 'The artwork is stunning — you can spot Hampi, the palace and even the storks.'],
    [1, 'Nikhil P.', 4, 'Great fit and the print is sharp. Would love a white version too.'],
    [2, 'Rakesh', 5, 'Everyone at office asked where I got it from 😄'],
    [6, 'Sneha', 5, 'Bought the red cap — the print looks premium.'],
    [5, 'Prajwal', 4, 'Love the back print. Size runs slightly large.'],
  ];
  for (const [pid, name, rating, text] of REVIEWS) {
    (await db.run('INSERT INTO reviews(product_id, name, rating, text, approved) VALUES(?,?,?,?,1)', pid, name, rating, text));
  }

  const names = ['Arjun Rao', 'Meghana K', 'Suresh Gowda', 'Pooja Hegde', 'Rahul Shetty', 'Shruthi N', 'Vikram B', 'Kavya M'];
  const custIds = [];
  for (const [i, n] of names.entries()) custIds.push(Number((await db.run("INSERT INTO users(name, email, phone, password_hash, role, created_at) VALUES(?,?,?,?, 'customer', datetime('now', ?))", n, `${slugify(n)}@example.com`, `98450${String(10000 + i * 731).slice(0, 5)}`, hashPassword('customer123'), `-${Math.floor(rand() * 60)} days`)).lastInsertRowid));
  const cities = [['Bengaluru', '560001'], ['Mysuru', '570001'], ['Mangaluru', '575001'], ['Hubballi', '580020']];
  for (let n = 0; n < 70; n++) {
    const daysAgo = Math.floor(rand() * 60);
    const ci = Math.floor(rand() * custIds.length);
    const [city, pin] = cities[Math.floor(rand() * cities.length)];
    const picks = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => variants[Math.floor(rand() * variants.length)]);
    const subtotal = picks.reduce((s, p) => s + p.price, 0);
    const shipping = subtotal >= 999 ? 0 : 79;
    const status = daysAgo > 7 ? (rand() < 0.08 ? 'cancelled' : 'delivered') : ['pending', 'confirmed', 'packed', 'shipped'][Math.floor(rand() * 4)];
    const method = rand() < 0.5 ? 'cod' : 'online';
    const paid = method === 'online' || status === 'delivered' ? 'paid' : 'pending';
    const created = `-${daysAgo} days`;
    const oid = Number((await db.run(`INSERT INTO orders(order_no, user_id, name, email, phone, address, city, state, pincode, subtotal, discount, shipping, total,
      payment_method, payment_status, status, courier, tracking_no, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?, 'Karnataka', ?,?,0,?,?,?,?,?,?,?, datetime('now', ?, '-' || ? || ' hours'), datetime('now', ?))`, `JK${String(240000 + n * 37)}`, custIds[ci], names[ci], `${slugify(names[ci])}@example.com`, `98450${String(10000 + ci * 731).slice(0, 5)}`,
      `${10 + n}, 4th Cross, ${['Jayanagar', 'Indiranagar', 'Malleshwaram', 'Kuvempunagar'][n % 4]}`, city, pin,
      subtotal, shipping, subtotal + shipping, method, paid, status,
      ['shipped', 'delivered'].includes(status) ? 'Delhivery' : null, ['shipped', 'delivered'].includes(status) ? `DLV${100000 + n}` : null,
      created, Math.floor(rand() * 12), created)).lastInsertRowid);
    for (const p of picks) {
      (await db.run('INSERT INTO order_items(order_id, product_id, variant_id, name, size, image, price, qty) VALUES(?,?,?,?,?,?,?,1)', oid, p.pid, p.vid, p.name, p.label, p.image, p.price));
    }
    (await db.run("INSERT INTO order_events(order_id, status, note, created_at) VALUES(?, 'pending', 'Order placed', datetime('now', ?))", oid, created));
    if (status !== 'pending') (await db.run("INSERT INTO order_events(order_id, status, created_at) VALUES(?, ?, datetime('now', ?))", oid, status, created));
  }
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Demo activity is loaded on first start unless NODE_ENV=production or SEED_DEMO=false. The catalogue always is.
const wantDemo = () => (process.env.SEED_DEMO ? process.env.SEED_DEMO !== 'false' : process.env.NODE_ENV !== 'production');

// Creates the first admin. Outside demo mode there is no default password: use ADMIN_PASSWORD or a random one.
async function createAdmin(demo) {
  const email = process.env.ADMIN_EMAIL || (demo ? 'admin@jinke.store' : 'jinke.wear@gmail.com');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) password = demo ? 'admin123' : crypto.randomBytes(9).toString('base64url');
  (await db.run("INSERT INTO users(name, email, password_hash, role) VALUES('Store Admin', ?, ?, 'admin')", email, hashPassword(password)));
  const line = '='.repeat(64);
  console.log(`\n${line}\n  Admin login: ${email}\n  Password:    ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : password}\n  ${demo ? 'Demo mode — change this password in Admin → Settings.' : 'Save this password now; it will not be shown again.'}\n${line}\n`);
}

async function seedIfEmpty() {
  if (await db.get('SELECT 1 AS ok FROM users LIMIT 1')) return;
  const demo = wantDemo();
  // The emptiness check is repeated inside the transaction: on Vercel two server instances can start at
  // the same moment, and only one of them may fill the database.
  const seeded = await tx(async () => {
    if (await db.get('SELECT 1 AS ok FROM users LIMIT 1')) return false;
    const catalog = await seedCatalog({ demo });
    if (demo) await seedDemoActivity(catalog);
    await createAdmin(demo);
    return true;
  }).catch((err) => {
    if (/SQLITE_BUSY|database is locked|UNIQUE constraint/i.test(err.message)) return false; // another instance is seeding
    throw err;
  });
  return seeded;
}

const ALL_TABLES = ['category_parents', 'bulk_enquiries', 'notification_log', 'invoice_counters', 'reviews', 'order_events', 'order_items', 'orders', 'wishlist', 'variants', 'products', 'categories', 'collections',
  'banners', 'testimonials', 'coupons', 'subscribers', 'password_resets', 'sessions', 'users', 'settings', 'pages'];

if (require.main === module) {
  (async () => {
    await migrate();
    const fresh = process.argv.includes('--empty');
    if (process.argv.includes('--reset') || fresh) {
      if (REMOTE_URL && !process.argv.includes('--yes')) {
        console.error('This would wipe the online (Turso) database. Run again with --yes if you really mean it.');
        process.exit(1);
      }
      for (const t of ALL_TABLES) await db.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name = '${t}';`);
      if (fresh) process.env.SEED_DEMO = 'false';
    }
    await seedIfEmpty();
    await require('./pages').seedPages();
    console.log(`Database ready at ${REMOTE_URL ? REMOTE_URL.replace(/\?.*/, '') : DB_PATH}${fresh ? ' (your catalogue, no demo orders or customers)' : ''}`);
  })().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seedIfEmpty };

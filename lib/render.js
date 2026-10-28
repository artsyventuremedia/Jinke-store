// Server-side page shells: fills in the <title>, description, social-preview tags and structured data
// for each URL, so search engines and WhatsApp/Instagram link previews see real content.
// The shells are built here (not read from public/) because on Vercel everything in public/ is served
// straight from the CDN, which would skip this step.
const { db, getSettings } = require('./db');
const { getPage } = require('./pages');
const { formatDate } = require('./time');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Page → its script in public/assets/js/. Every storefront page shares the same shell.
const SCRIPTS = {
  home: 'home', shop: 'shop', product: 'product', cart: 'cart', checkout: 'checkout', account: 'account', track: 'track',
  'order-success': 'success', help: 'help', reset: 'reset', bulk: 'bulk', page: null, 404: null,
};
const NOT_FOUND_MAIN = '<div class="wrap success"><h1>Page not found</h1><p class="muted">The page you are looking for does not exist.</p><a class="btn" href="/shop">Continue shopping</a></div>';

function shell({ page, title, head, main }) {
  const script = SCRIPTS[page];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+Tamma+2:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/store.css">
${head}
</head>
<body>
<div id="site-header"></div>
<main id="main">${main || (page === '404' ? NOT_FOUND_MAIN : '')}</main>
<footer id="site-footer"></footer>
<script src="/assets/js/store.js"></script>
${script ? `<script src="/assets/js/${script}.js"></script>` : ''}
</body>
</html>`;
}

function siteUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function abs(req, url) {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : siteUrl(req) + (url.startsWith('/') ? url : '/' + url);
}

const clip = (s, n = 160) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// meta: { title, description, image, noindex, jsonld, type, main }
async function render(req, res, page, meta = {}, status = 200) {
  const s = await getSettings();
  const title = meta.title || s.store_name;
  const description = clip(meta.description || s.tagline);
  const url = siteUrl(req) + req.originalUrl.split('#')[0];
  const canonical = siteUrl(req) + req.path;
  const image = abs(req, meta.image || '/assets/brand/og-default.jpg');
  const head = [
    `<meta name="description" content="${esc(description)}">`,
    meta.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`,
    '<meta name="theme-color" content="#161616">',
    `<meta property="og:site_name" content="${esc(s.store_name)}">`,
    `<meta property="og:type" content="${meta.type || 'website'}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    meta.jsonld ? `<script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n');
  res.status(status).type('html').set('Cache-Control', 'no-cache').send(shell({ page, title, head, main: meta.main }));
}

async function storeTitle(part) {
  const s = await getSettings();
  return part ? `${part} — ${s.store_name}` : `${s.store_name} — ${s.tagline}`;
}

async function product(req, res) {
  const p = await db.get(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ? AND p.status = 'active'`, req.params.slug);
  if (!p) return render(req, res, '404', { title: await storeTitle('Product not found'), noindex: true }, 404);
  const s = await getSettings();
  const images = JSON.parse(p.images || '[]').map((i) => abs(req, i));
  const inStock = (await db.get('SELECT COALESCE(SUM(stock), 0) AS n FROM variants WHERE product_id = ?', p.id)).n > 0;
  const rating = await db.get('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE product_id = ? AND approved = 1', p.id);
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: images,
    description: clip(p.description, 500),
    sku: `JK-${p.id}`,
    brand: { '@type': 'Brand', name: s.store_name },
    category: p.category_name || undefined,
    offers: {
      '@type': 'Offer',
      url: siteUrl(req) + `/product/${p.slug}`,
      priceCurrency: 'INR',
      price: p.price,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
  if (rating.count) jsonld.aggregateRating = { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.count };
  return render(req, res, 'product', {
    title: await storeTitle(p.name),
    description: `₹${p.price} · ${p.description}`,
    image: images[0],
    type: 'product',
    jsonld,
  });
}

async function shop(req, res) {
  const { category, collection, q } = req.query;
  const c = category && await db.get('SELECT name FROM categories WHERE slug = ?', String(category));
  const col = collection && await db.get('SELECT name, description FROM collections WHERE slug = ?', String(collection));
  const name = col?.name || c?.name;
  return render(req, res, 'shop', {
    title: await storeTitle(q ? `Search: ${q}` : name || 'Shop all'),
    description: col?.description || (name ? `Shop ${name} at ${(await getSettings()).store_name}.` : undefined),
    noindex: !!q,
  });
}

async function policyPage(req, res) {
  const page = await getPage(req.params.slug);
  if (!page) return render(req, res, '404', { title: await storeTitle('Page not found'), noindex: true }, 404);
  const main = `<div class="page-head"><div class="wrap"><h1>${esc(page.title)}</h1><p class="muted" style="margin:4px 0 0">Last updated ${esc(formatDate(page.updated_at, { dateStyle: 'long' }))}</p></div></div>
    <div class="wrap prose policy" style="padding-top:20px">${page.html}</div>`;
  return render(req, res, 'page', { title: await storeTitle(page.title), description: page.body.replace(/^##\s.*$/gm, ''), main });
}

async function sitemap(req, res) {
  const base = siteUrl(req);
  const urls = [
    { loc: '/', priority: '1.0' },
    { loc: '/shop', priority: '0.8' },
    { loc: '/bulk-order', priority: '0.7' },
    ...(await db.all('SELECT slug FROM categories')).map((c) => ({ loc: `/shop?category=${c.slug}`, priority: '0.7' })),
    ...(await db.all('SELECT slug FROM collections')).map((c) => ({ loc: `/shop?collection=${c.slug}`, priority: '0.7' })),
    ...(await db.all("SELECT slug, created_at FROM products WHERE status = 'active'")).map((p) => ({ loc: `/product/${p.slug}`, lastmod: p.created_at.slice(0, 10), priority: '0.9' })),
    ...(await db.all('SELECT slug, updated_at FROM pages')).map((p) => ({ loc: `/pages/${p.slug}`, lastmod: p.updated_at.slice(0, 10), priority: '0.3' })),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(base + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`);
}

function robots(req, res) {
  res.type('text/plain').send(`User-agent: *
Disallow: /admin
Disallow: /api/
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /order-success
Disallow: /reset

Sitemap: ${siteUrl(req)}/sitemap.xml
`);
}

function mountPages(app) {
  const s = getSettings;
  app.get('/', async (req, res) => render(req, res, 'home', { title: await storeTitle(), description: `${(await s()).tagline} T-shirts, caps and merchandise celebrating Kannada and Karnataka.` }));
  app.get('/shop', shop);
  app.get('/product/:slug', product);
  app.get('/pages/:slug', policyPage);
  app.get('/bulk-order', async (req, res) => render(req, res, 'bulk', { title: await storeTitle('Bulk & Corporate Orders'), description: `Custom T-shirts, hoodies, caps, bottles and merchandise in bulk for teams, events and corporate gifting — printed and delivered across India by ${(await s()).store_name}.` }));
  app.get('/help', async (req, res) => render(req, res, 'help', { title: await storeTitle('Help & FAQs'), description: `Shipping, returns, exchanges and answers to common questions about ${(await s()).store_name}.` }));
  app.get('/track', async (req, res) => render(req, res, 'track', { title: await storeTitle('Track your order') }));
  for (const [route, page, title] of [
    ['/cart', 'cart', 'Your cart'], ['/checkout', 'checkout', 'Checkout'], ['/account', 'account', 'My account'],
    ['/order-success', 'order-success', 'Order placed'], ['/reset', 'reset', 'Reset password'],
  ]) app.get(route, async (req, res) => render(req, res, page, { title: await storeTitle(title), noindex: true }));
  app.get('/sitemap.xml', sitemap);
  app.get('/robots.txt', robots);
  // Old-style .html links go to the clean URL.
  app.get(/^\/(index|shop|cart|checkout|account|track|order-success|help|reset)\.html$/, (req, res) => {
    const name = req.params[0];
    res.redirect(301, name === 'index' ? '/' : `/${name}`);
  });
}

async function notFound(req, res) {
  return render(req, res, '404', { title: await storeTitle('Page not found'), noindex: true }, 404);
}

module.exports = { mountPages, notFound };

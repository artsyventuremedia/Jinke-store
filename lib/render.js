// Server-side page shells: fills in the <title>, description, social-preview tags and structured data
// for each URL, so search engines and WhatsApp/Instagram link previews see real content.
const fs = require('fs');
const path = require('path');
const { db, getSettings } = require('./db');
const { getPage } = require('./pages');
const { formatDate } = require('./time');

const PUBLIC = path.join(__dirname, '..', 'public');
const cache = new Map();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function template(file) {
  if (process.env.NODE_ENV !== 'production' || !cache.has(file)) cache.set(file, fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
  return cache.get(file);
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
function render(req, res, file, meta = {}, status = 200) {
  const s = getSettings();
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
  let html = template(file)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('</head>', `${head}\n</head>`);
  if (meta.main) html = html.replace('<main id="main"></main>', `<main id="main">${meta.main}</main>`);
  res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
}

function storeTitle(part) {
  const s = getSettings();
  return part ? `${part} — ${s.store_name}` : `${s.store_name} — ${s.tagline}`;
}

function product(req, res) {
  const p = db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ? AND p.status = 'active'`).get(req.params.slug);
  if (!p) return render(req, res, '404.html', { title: storeTitle('Product not found'), noindex: true }, 404);
  const s = getSettings();
  const images = JSON.parse(p.images || '[]').map((i) => abs(req, i));
  const inStock = db.prepare('SELECT COALESCE(SUM(stock), 0) AS n FROM variants WHERE product_id = ?').get(p.id).n > 0;
  const rating = db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE product_id = ? AND approved = 1').get(p.id);
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
  render(req, res, 'product.html', {
    title: storeTitle(p.name),
    description: `₹${p.price} · ${p.description}`,
    image: images[0],
    type: 'product',
    jsonld,
  });
}

function shop(req, res) {
  const { category, collection, q } = req.query;
  const c = category && db.prepare('SELECT name FROM categories WHERE slug = ?').get(category);
  const col = collection && db.prepare('SELECT name, description FROM collections WHERE slug = ?').get(collection);
  const name = col?.name || c?.name;
  render(req, res, 'shop.html', {
    title: storeTitle(q ? `Search: ${q}` : name || 'Shop all'),
    description: col?.description || (name ? `Shop ${name} at ${getSettings().store_name}.` : undefined),
    noindex: !!q,
  });
}

function policyPage(req, res) {
  const page = getPage(req.params.slug);
  if (!page) return render(req, res, '404.html', { title: storeTitle('Page not found'), noindex: true }, 404);
  const main = `<div class="page-head"><div class="wrap"><h1>${esc(page.title)}</h1><p class="muted" style="margin:4px 0 0">Last updated ${esc(formatDate(page.updated_at, { dateStyle: 'long' }))}</p></div></div>
    <div class="wrap prose policy" style="padding-top:20px">${page.html}</div>`;
  render(req, res, 'page.html', { title: storeTitle(page.title), description: page.body.replace(/^##\s.*$/gm, ''), main });
}

function sitemap(req, res) {
  const base = siteUrl(req);
  const urls = [
    { loc: '/', priority: '1.0' },
    { loc: '/shop', priority: '0.8' },
    { loc: '/bulk-order', priority: '0.7' },
    ...db.prepare('SELECT slug FROM categories').all().map((c) => ({ loc: `/shop?category=${c.slug}`, priority: '0.7' })),
    ...db.prepare('SELECT slug FROM collections').all().map((c) => ({ loc: `/shop?collection=${c.slug}`, priority: '0.7' })),
    ...db.prepare("SELECT slug, created_at FROM products WHERE status = 'active'").all().map((p) => ({ loc: `/product/${p.slug}`, lastmod: p.created_at.slice(0, 10), priority: '0.9' })),
    ...db.prepare('SELECT slug, updated_at FROM pages').all().map((p) => ({ loc: `/pages/${p.slug}`, lastmod: p.updated_at.slice(0, 10), priority: '0.3' })),
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
  const s = () => getSettings();
  app.get('/', (req, res) => render(req, res, 'index.html', { title: storeTitle(), description: `${s().tagline} T-shirts, caps and merchandise celebrating Kannada and Karnataka.` }));
  app.get('/shop', shop);
  app.get('/product/:slug', product);
  app.get('/pages/:slug', policyPage);
  app.get('/bulk-order', (req, res) => render(req, res, 'bulk.html', { title: storeTitle('Bulk & Corporate Orders'), description: `Custom T-shirts, hoodies, caps, bottles and merchandise in bulk for teams, events and corporate gifting — printed and delivered across India by ${s().store_name}.` }));
  app.get('/help', (req, res) => render(req, res, 'help.html', { title: storeTitle('Help & FAQs'), description: `Shipping, returns, exchanges and answers to common questions about ${s().store_name}.` }));
  app.get('/track', (req, res) => render(req, res, 'track.html', { title: storeTitle('Track your order') }));
  for (const [route, file, title] of [
    ['/cart', 'cart.html', 'Your cart'], ['/checkout', 'checkout.html', 'Checkout'], ['/account', 'account.html', 'My account'],
    ['/order-success', 'order-success.html', 'Order placed'], ['/reset', 'reset.html', 'Reset password'],
  ]) app.get(route, (req, res) => render(req, res, file, { title: storeTitle(title), noindex: true }));
  app.get('/sitemap.xml', sitemap);
  app.get('/robots.txt', robots);
  // Old-style .html links go to the clean URL.
  app.get(/^\/(index|shop|cart|checkout|account|track|order-success|help|reset)\.html$/, (req, res) => {
    const name = req.params[0];
    res.redirect(301, name === 'index' ? '/' : `/${name}`);
  });
}

function notFound(req, res) {
  render(req, res, '404.html', { title: storeTitle('Page not found'), noindex: true }, 404);
}

module.exports = { mountPages, notFound };

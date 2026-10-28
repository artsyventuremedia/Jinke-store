(async function () {
  const { $, esc, api, productCard, ICON, toast, ready } = Store;
  const main = $('#main');
  main.innerHTML = '<div class="skeleton" style="height:460px;border-radius:0"></div>';
  const [state, home] = await Promise.all([ready, api('/home')]);

  const hero = home.banners.length ? `<section class="hero" aria-label="Featured">
    <div class="hero-track">${home.banners.map((b, i) => {
      const fig = (src, label, cls) => (src ? `<figure class="${cls}"><img src="${esc(src)}" alt="${esc(label || b.title)}" ${i ? 'loading="lazy"' : ''}>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>` : '');
      return `<div class="hero-slide theme-${esc(b.theme || 'light')}">
        <div class="hero-copy">${b.kicker ? `<div class="kicker">${esc(b.kicker)}</div>` : ''}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}
          ${b.link ? `<a class="btn ${b.theme === 'karnataka' ? '' : 'btn-brand'}" href="${esc(b.link)}">${esc(b.button_text || 'Shop now')}</a>` : ''}</div>
        <div class="hero-media${b.image2 ? ' duo' : ''}"><span class="blob" aria-hidden="true"></span>${fig(b.image, b.image_label, 'm1')}${fig(b.image2, b.image2_label, 'm2')}</div>
      </div>`;
    }).join('')}</div>
    ${home.banners.length > 1 ? `<div class="hero-dots">${home.banners.map((_, i) => `<button aria-label="Slide ${i + 1}" data-slide="${i}"></button>`).join('')}</div>` : ''}
  </section>` : '';

  // Tiles show the categories directly under each menu heading (Hoodies, Caps, Bottles…), each once.
  function tileCategories(st) {
    const seen = new Set();
    return Store.topCategories().flatMap((t) => Store.childrenOf(t.id)).filter((c) => c.product_count && !seen.has(c.id) && seen.add(c.id));
  }

  const section = (kicker, title, sub, body, link) => `<section class="block"><div class="wrap">
    <div class="section-head"><div><div class="kicker">${kicker}</div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${link || ''}</div>${body}</div></section>`;

  main.innerHTML = `${hero}
    <section class="block" style="padding-bottom:0"><div class="wrap usp">
      <div>${ICON.truck}<p style="margin:0"><b>Free shipping</b><span>On orders above ₹${esc(state.settings.free_shipping_above)}</span></p></div>
      <div>${ICON.cash}<p style="margin:0"><b>Cash on delivery</b><span>Pay when it arrives</span></p></div>
      <div>${ICON.swap}<p style="margin:0"><b>Easy exchange</b><span>7-day size exchange</span></p></div>
      <div>${ICON.shield}<p style="margin:0"><b>Secure checkout</b><span>Your data stays safe</span></p></div>
    </div></section>
    ${home.trending.length ? section('ಟ್ರೆಂಡಿಂಗ್', 'Trending now', 'Loved by Kannadigas, from Bengaluru to Boston', `<div class="rail">${home.trending.map(productCard).join('')}</div>`, '<a class="btn btn-outline btn-sm" href="/shop">View all</a>') : ''}
    ${section('ಏನೇನ್ ಸಿಗುತ್ತೆ..?', 'Shop by category', '', `<div class="cats">${tileCategories(state).map((c) => `<a class="cat" href="/shop?category=${esc(c.slug)}">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ''}<span>${esc(c.name)}</span></a>`).join('')}</div>`)}
    ${state.collections.length ? section('Collections', 'Find your vibe', 'Designs rooted in Karnataka, made for today', `<div class="collections">${state.collections.map((c) => `<a class="coll" href="/shop?collection=${esc(c.slug)}">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ''}<div><h3>${esc(c.name)}</h3><p>${esc(c.description || '')}</p></div></a>`).join('')}</div>`) : ''}
    <section class="block"><div class="wrap"><div class="story">
      <img src="/assets/brand/icon-512.png" alt="">
      <div><div class="kicker">Our story</div><h2>ಜಿಂಕೆ — Jinke means deer</h2>
        <p>Graceful, quick and at home in the forests of Karnataka. We make clothing and merchandise that carry Kannada with pride — our language, our landmarks and our folk arts — for Kannadigas in Karnataka and all over the world.</p>
        <p>Wear your roots, wherever you are.</p></div>
    </div></div></section>
    ${home.featured.length ? section('Handpicked', 'Featured products', '', `<div class="products">${home.featured.slice(0, 8).map(productCard).join('')}</div>`) : ''}
    ${home.newest.length ? section('Just in', 'New arrivals', '', `<div class="rail">${home.newest.map(productCard).join('')}</div>`, '<a class="btn btn-outline btn-sm" href="/shop?sort=newest">View all</a>') : ''}
    ${home.testimonials.length ? `<section class="block" style="background:var(--bg-soft)"><div class="wrap"><div class="section-head"><div><div class="kicker">Love from you</div><h2>We love you too!!!</h2></div></div>
      <div class="quotes">${home.testimonials.map((t) => `<figure class="quote" style="margin:0"><div class="stars" aria-label="${t.rating} out of 5">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div><p>“${esc(t.text)}”</p><figcaption><b>${esc(t.name)}</b><br><span class="muted" style="font-size:13px">${esc(t.role || '')}</span></figcaption></figure>`).join('')}</div></div></section>` : ''}
    <section class="block"><div class="wrap"><div class="newsletter">
      <div><h2>Join the ${esc(state.settings.store_name)} family</h2><p style="margin:0;opacity:.8">Be first to know about new drops, festive sales and exclusive offers.</p></div>
      <form id="news"><input type="email" name="email" required placeholder="Your email address" aria-label="Email"><button class="btn btn-accent">Subscribe</button></form>
    </div></div></section>`;

  // Hero carousel
  const track = $('.hero-track');
  if (track && home.banners.length > 1) {
    let i = 0;
    const dots = [...document.querySelectorAll('[data-slide]')];
    const go = (n) => {
      i = (n + home.banners.length) % home.banners.length;
      track.style.transform = `translateX(-${i * 100}%)`;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      track.parentElement.dataset.theme = home.banners[i].theme || 'light'; // dots stay visible on dark slides
    };
    let timer = setInterval(() => go(i + 1), 5500);
    dots.forEach((d) => d.addEventListener('click', () => { clearInterval(timer); go(Number(d.dataset.slide)); timer = setInterval(() => go(i + 1), 5500); }));
    go(0);
  }

  $('#news').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/subscribe', { body: { email: e.target.email.value } }); e.target.reset(); toast('Thanks for subscribing! 🎉'); } catch (err) { toast(err.message, true); }
  });
})();

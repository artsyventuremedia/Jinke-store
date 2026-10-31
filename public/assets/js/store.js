/* Shared storefront code: API helper, cart, header/footer, product cards, quick view. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_QTY = 20; // per item in one online order (the server enforces the same limit)
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const money2 = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2a3 3 0 0 0-2-2C18 5.7 12 5.7 12 5.7s-6 0-8 .5a3 3 0 0 0-2 2A31 31 0 0 0 1.7 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2 2c2 .5 8 .5 8 .5s6 0 8-.5a3 3 0 0 0 2-2 31 31 0 0 0 .3-3.8 31 31 0 0 0-.3-3.8zM10 15V9l5.2 3L10 15z"/></svg>',
  };

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
    return data;
  }

  function toast(msg, isErr) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---- Cart (stored locally, priced by the server) ----
  const CART_KEY = 'jinke_cart';
  const COUPON_KEY = 'jinke_coupon';
  const cart = {
    items() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
    save(items) {
      try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
      document.dispatchEvent(new CustomEvent('cart:change'));
    },
    add(variant_id, qty = 1) {
      const items = cart.items();
      const hit = items.find((i) => i.variant_id === variant_id);
      if (hit) hit.qty += qty; else items.push({ variant_id, qty });
      cart.save(items);
    },
    set(variant_id, qty) {
      cart.save(cart.items().map((i) => (i.variant_id === variant_id ? { ...i, qty } : i)).filter((i) => i.qty > 0));
    },
    remove(variant_id) { cart.save(cart.items().filter((i) => i.variant_id !== variant_id)); },
    clear() { cart.save([]); cart.coupon(''); },
    count() { return cart.items().reduce((s, i) => s + i.qty, 0); },
    coupon(v) {
      try {
        if (v === undefined) return localStorage.getItem(COUPON_KEY) || '';
        if (v) localStorage.setItem(COUPON_KEY, v); else localStorage.removeItem(COUPON_KEY);
      } catch { return ''; }
    },
    quote() { return api('/cart/quote', { body: { items: cart.items(), coupon: cart.coupon() } }); },
  };

  const state = { settings: {}, categories: [], collections: [], user: null, wish: new Set() };

  // ---- Razorpay Checkout ----
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
      document.head.appendChild(el);
    });
  }

  // Opens Razorpay for an order; resolves true once the payment is verified, false if the customer closes it.
  async function payOnline(orderNo, params) {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        ...params,
        theme: { color: '#c8102e' },
        handler: async (resp) => {
          try {
            await api('/orders/verify', { body: { order_no: orderNo, ...resp } });
            resolve(true);
          } catch (e) { reject(e); }
        },
        modal: { ondismiss: () => resolve(false) },
      });
      rzp.on('payment.failed', (r) => toast(r.error?.description || 'Payment failed. You can try again.', true));
      rzp.open();
    });
  }

  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  // ---- Product card ----
  function priceHtml(p) {
    const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
    return `<div class="price"><span class="now">${money(p.price)}</span>${off ? `<span class="was">${money(p.mrp)}</span><span class="off">${off}% off</span>` : ''}</div>`;
  }

  function productCard(p) {
    const off = p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
    const oos = p.stock === 0;
    return `<article class="card">
      <a class="thumb" href="/product/${esc(p.slug)}" aria-label="${esc(p.name)}">
        ${oos ? '<span class="tag oos">Sold out</span>' : off >= 15 ? `<span class="tag">-${off}%</span>` : ''}
        <img src="${esc(p.images[0] || '')}" alt="" loading="lazy">
        ${p.images[1] ? `<img class="alt" src="${esc(p.images[1])}" alt="" loading="lazy">` : ''}
      </a>
      <button class="icon-btn wish ${state.wish.has(p.id) ? 'on' : ''}" data-wish="${p.id}" aria-label="Add to wishlist">${ICON.heart}</button>
      ${oos ? '' : `<button class="btn btn-sm quick" data-quick="${esc(p.slug)}">Quick view</button>`}
      <div class="info">
        ${p.category_name ? `<div class="cat-name">${esc(p.category_name)}</div>` : ''}
        <a class="title" href="/product/${esc(p.slug)}">${esc(p.name)}</a>
        ${p.variants && p.variants.some((v) => v.image) ? `<div class="swatch-line">${p.variants.map((v) => esc(v.label)).join(' · ')}</div>` : ''}
        ${priceHtml(p)}
      </div>
    </article>`;
  }

  async function toggleWish(id, btn) {
    if (!state.user) {
      toast('Log in to save items to your wishlist');
      setTimeout(() => { location.href = '/account?next=' + encodeURIComponent(location.pathname + location.search); }, 900);
      return;
    }
    const on = state.wish.has(id);
    try {
      await api('/me/wishlist/' + id, { method: on ? 'DELETE' : 'POST' });
      on ? state.wish.delete(id) : state.wish.add(id);
      $$(`[data-wish="${id}"]`).forEach((b) => b.classList.toggle('on', !on));
      toast(on ? 'Removed from wishlist' : 'Saved to wishlist');
      updateBadges();
    } catch (e) { toast(e.message, true); }
    if (btn) btn.blur();
  }

  // ---- Variant picker used by quick view & product page ----
  function variantPicker(root, product, { onAdd, onImage } = {}) {
    let selected = product.variants.find((v) => v.stock > 0) || null;
    if (product.variants.length > 1) selected = null;
    let qty = 1;
    const SIZE = /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|Free Size)$/i;
    const COLOUR = /^(black|white|grey|gray|red|maroon|yellow|mustard|blue|navy|green|olive|pink|purple|orange|brown|beige|cream)$/i;
    const sizeLabel = product.variants.every((v) => SIZE.test(v.label)) ? 'Size'
      : product.variants.every((v) => COLOUR.test(v.label)) ? 'Colour' : 'Option';
    const hasChart = product.variants.some((v) => /^(S|M|L|XL)$/i.test(v.label));
    root.innerHTML = `
      ${product.variants.length > 1 || product.variants[0]?.label !== 'Standard' ? `
      <div class="opt-head"><span>${sizeLabel}: <span data-sel class="muted">${selected ? esc(selected.label) : 'Select'}</span></span>
        ${hasChart ? '<button class="link-btn" data-chart>Size chart</button>' : ''}</div>
      <div class="sizes">${product.variants.map((v) => `<button class="size ${selected && selected.id === v.id ? 'on' : ''}" data-v="${v.id}" ${v.stock ? '' : 'disabled'}>${esc(v.label)}</button>`).join('')}</div>` : ''}
      <div class="stock-note" data-note></div>
      <div class="buy-row">
        <div class="qty"><button data-q="-1" aria-label="Decrease">−</button><span data-qty>1</span><button data-q="1" aria-label="Increase">+</button></div>
        <button class="btn btn-brand" data-add ${product.stock ? '' : 'disabled'}>${product.stock ? 'Add to cart' : 'Sold out'}</button>
      </div>
      <button class="btn btn-outline btn-block" data-buy ${product.stock ? '' : 'disabled'}>Buy it now</button>`;
    const note = $('[data-note]', root);
    const refresh = () => {
      $$('.size', root).forEach((b) => b.classList.toggle('on', selected && Number(b.dataset.v) === selected.id));
      const sel = $('[data-sel]', root); if (sel) sel.textContent = selected ? selected.label : 'Select';
      note.textContent = selected && selected.stock <= 5 ? `Hurry, only ${selected.stock} left!` : '';
      $('[data-qty]', root).textContent = qty;
    };
    root.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]');
      if (v) {
        selected = product.variants.find((x) => x.id === Number(v.dataset.v));
        qty = Math.min(qty, selected.stock);
        if (selected.image && onImage) onImage(selected.image); // e.g. show the red cap when Red is picked
        refresh();
      }
      const q = e.target.closest('[data-q]');
      if (q) { qty = Math.max(1, Math.min(selected ? Math.min(selected.stock, MAX_QTY) : MAX_QTY, qty + Number(q.dataset.q))); refresh(); }
      if (e.target.closest('[data-chart]')) sizeChart();
      const add = e.target.closest('[data-add],[data-buy]');
      if (add) {
        if (!selected) { note.textContent = `Please select a ${sizeLabel.toLowerCase()}`; return; }
        const inCart = cart.items().find((i) => i.variant_id === selected.id)?.qty || 0;
        if (inCart + qty > selected.stock) { note.textContent = `Only ${selected.stock} available`; return; }
        if (inCart + qty > MAX_QTY) { note.textContent = `You can order up to ${MAX_QTY} of each item online — use Bulk Order for more`; return; }
        cart.add(selected.id, qty);
        if (onAdd) onAdd();
        if (add.dataset.buy !== undefined) location.href = '/checkout';
        else openCart();
      }
    });
    refresh();
  }

  function sizeChart() {
    modal(`<h3>Size chart (inches)</h3>
      <table class="size-chart"><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr>
      ${[['S', 38, 27, 17], ['M', 40, 28, 18], ['L', 42, 29, 19], ['XL', 44, 30, 20], ['XXL', 46, 31, 21]].map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
      </table><p class="muted">Measured flat, garment measurements. If you're between sizes, size up for a relaxed fit.</p>`, 520);
  }

  function modal(html, width) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${width ? `max-width:${width}px` : ''}"><button class="icon-btn close" aria-label="Close">${ICON.close}</button>${html}</div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => e.key === 'Escape' && close();
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('.close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    return { el: $('.modal', bg), close };
  }

  async function quickView(slug) {
    const m = modal('<div class="skeleton" style="height:360px"></div>');
    try {
      const { product: p } = await api('/products/' + encodeURIComponent(slug));
      m.el.innerHTML = `<button class="icon-btn close" aria-label="Close">${ICON.close}</button>
        <div class="qv"><img src="${esc(p.images[0])}" alt="${esc(p.name)}">
        <div><div class="kicker">${esc(p.category_name || '')}</div><h2>${esc(p.name)}</h2>${priceHtml(p)}
        <p class="muted" style="font-size:13px">Inclusive of GST</p><div data-picker></div>
        <p><a href="/product/${esc(p.slug)}" style="text-decoration:underline;font-size:14px">View full details</a></p></div></div>`;
      variantPicker($('[data-picker]', m.el), p, { onAdd: m.close, onImage: (src) => { $('.qv img', m.el).src = src; } });
    } catch (e) { m.el.innerHTML = `<p>${esc(e.message)}</p>`; }
  }

  // ---- Cart drawer ----
  async function renderCartDrawer() {
    const body = $('#cart-body');
    const foot = $('#cart-foot');
    if (!cart.items().length) {
      body.innerHTML = `<div class="empty"><h3>Your cart is empty</h3><p>Looks like you haven't added anything yet.</p><a class="btn" href="/shop">Start shopping</a></div>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = '<div class="skeleton" style="height:90px;margin:10px 0"></div>'.repeat(2);
    try {
      const q = await cart.quote();
      body.innerHTML = freeShipBar(q) + q.lines.map(cartLine(q)).join('');
      foot.innerHTML = `<div class="totals"><div class="row"><span>Subtotal</span><b>${money(q.subtotal)}</b></div>
        ${q.discount ? `<div class="row"><span>Discount (${esc(q.coupon)})</span><b style="color:var(--ok)">−${money(q.discount)}</b></div>` : ''}</div>
        <p class="muted" style="font-size:12px;margin:6px 0 12px">Prices include GST · Shipping & coupons calculated at checkout</p>
        <a class="btn btn-brand btn-block" href="/checkout">Checkout · ${money(q.subtotal - q.discount)}</a>
        <a class="btn btn-outline btn-block" style="margin-top:8px" href="/cart">View cart</a>`;
    } catch (e) { body.innerHTML = `<p>${esc(e.message)}</p>`; }
  }

  function freeShipBar(q) {
    if (!q.free_shipping_above) return '';
    const left = q.free_shipping_above - (q.subtotal - q.discount);
    const pct = Math.min(100, ((q.subtotal - q.discount) / q.free_shipping_above) * 100);
    return `<div style="font-size:13px;margin-top:4px">${left > 0 ? `Add <b>${money(left)}</b> more for <b>free shipping</b>` : '🎉 You\'ve unlocked <b>free shipping</b>'}</div><div class="progress"><div style="width:${pct}%"></div></div>`;
  }

  const cartLine = (q) => (l) => {
    const issue = q.issues.find((i) => i.variant_id === l.variant_id);
    return `<div class="cart-line">
      <a href="/product/${esc(l.slug)}"><img src="${esc(l.image || '')}" alt=""></a>
      <div><a class="name" href="/product/${esc(l.slug)}">${esc(l.name)}</a><div class="meta">${esc(l.size)} · ${money(l.price)}</div>
        ${issue ? `<div class="warn">${esc(issue.message)}</div>` : ''}
        <div class="qty"><button data-cq="${l.variant_id}" data-d="-1" aria-label="Decrease">−</button><span>${l.qty}</span><button data-cq="${l.variant_id}" data-d="1" aria-label="Increase" ${l.qty >= Math.min(l.stock, MAX_QTY) ? 'disabled' : ''}>+</button></div></div>
      <div style="text-align:right"><b>${money(l.line_total)}</b><br><button class="link-btn" data-rm="${l.variant_id}">Remove</button></div>
    </div>`;
  };

  function openCart() {
    $('#cart-drawer').classList.add('open');
    $('#drawer-bg').classList.add('open');
    renderCartDrawer();
  }
  function closeDrawers() {
    $$('.drawer.open, .drawer-bg.open').forEach((el) => el.classList.remove('open'));
  }

  function updateBadges() {
    const n = cart.count();
    $$('[data-cart-count]').forEach((b) => { b.textContent = n; b.classList.toggle('hidden', !n); });
    $$('[data-wish-count]').forEach((b) => { b.textContent = state.wish.size; b.classList.toggle('hidden', !state.wish.size); });
  }

  // ---- Layout ----
  // ---- Category tree helpers ----
  const childrenOf = (id) => state.categories.filter((c) => c.parent_ids.includes(id));
  const topCategories = () => state.categories.filter((c) => !c.parent_ids.length);
  // Path from a top-level category down to this one, e.g. Apparels › T-Shirts › Round Neck.
  function categoryPath(slug) {
    let c = state.categories.find((x) => x.slug === slug);
    const path = [];
    const seen = new Set();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      path.unshift(c);
      c = state.categories.find((x) => x.id === c.parent_ids[0]);
    }
    return path;
  }

  // Header menu, from the nav_menu setting: one "Label | link" per line (Admin → Settings).
  // A link to a category that has sub-categories opens a dropdown of them.
  function menuItems() {
    const items = String(state.settings.nav_menu || '').split('\n').map((line) => {
      const at = line.indexOf('|');
      const label = line.slice(0, at).trim();
      const url = line.slice(at + 1).trim();
      return at > 0 && label && /^(\/|https?:\/\/)/.test(url) ? { label, url } : null;
    }).filter(Boolean);
    if (!items.length) {
      items.push({ label: 'Home', url: '/' }, ...topCategories().map((c) => ({ label: c.name, url: `/shop?category=${c.slug}` })), { label: 'Bulk Order', url: '/bulk-order' });
    }
    return items.map((item) => {
      const slug = /^\/shop\?category=([\w-]+)$/.exec(item.url)?.[1];
      return { ...item, category: slug && state.categories.find((c) => c.slug === slug) };
    });
  }

  function isActive(item) {
    const here = new URLSearchParams(location.search);
    if (item.category) return here.get('category') && categoryPath(here.get('category'))[0]?.id === item.category.id;
    return item.url === location.pathname + location.search;
  }

  function navMenu() {
    const link = (c, cls = '') => `<a class="${cls}" href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`;
    return menuItems().map((item) => {
      const top = item.category;
      const kids = top ? childrenOf(top.id) : [];
      return `<div class="nav-item${isActive(item) ? ' active' : ''}">
        <a href="${esc(item.url)}" ${kids.length ? 'aria-haspopup="true"' : ''}>${esc(item.label)}${kids.length ? ' ▾' : ''}</a>
        ${kids.length ? `<div class="dropdown">${link(top, 'all')}${kids.map((k) => {
          const grand = childrenOf(k.id);
          return grand.length ? `<div class="sub">${link(k, 'sub-head')}${grand.map((g) => link(g, 'sub-item')).join('')}</div>` : link(k);
        }).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  function mobileMenu() {
    const item = (c, depth) => `<a href="/shop?category=${esc(c.slug)}" style="padding-left:${depth * 16}px">${esc(c.name)}</a>`
      + childrenOf(c.id).map((k) => item(k, depth + 1)).join('');
    return menuItems().map((m) => (m.category && childrenOf(m.category.id).length
      ? `<h4>${esc(m.label)}</h4><a href="${esc(m.url)}">All ${esc(m.label)}</a>${childrenOf(m.category.id).map((k) => item(k, 1)).join('')}`
      : `<a href="${esc(m.url)}">${esc(m.label)}</a>`)).join('')
      + '<h4>More</h4><a href="/bulk-order">Bulk Order</a>';
  }

  function renderHeader() {
    const s = state.settings;
    const header = document.createElement('div');
    header.innerHTML = `
      ${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
      <header class="header"><div class="wrap">
        <button class="icon-btn menu-toggle" data-open="menu-drawer" aria-label="Menu">${ICON.menu}</button>
        ${logoHtml(s)}
        <nav class="nav" aria-label="Main">${navMenu()}</nav>
        <div class="header-actions">
          <form class="search" action="/shop" role="search">${ICON.search}<input name="q" placeholder="Search tees, hoodies…" aria-label="Search" value="${esc(new URLSearchParams(location.search).get('q') || '')}"></form>
          <a class="icon-btn" href="/account" aria-label="Account">${ICON.user}</a>
          <a class="icon-btn" href="/account#wishlist" aria-label="Wishlist">${ICON.heart}<span class="badge hidden" data-wish-count></span></a>
          <button class="icon-btn" data-open="cart-drawer" aria-label="Cart">${ICON.bag}<span class="badge hidden" data-cart-count></span></button>
        </div>
      </div></header>
      <div class="drawer-bg" id="drawer-bg"></div>
      <aside class="drawer right" id="cart-drawer" aria-label="Cart">
        <div class="drawer-head"><h3>Your cart</h3><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="drawer-body" id="cart-body"></div><div class="drawer-foot" id="cart-foot"></div>
      </aside>
      <aside class="drawer left" id="menu-drawer" aria-label="Menu">
        <div class="drawer-head">${logoHtml(s)}<button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
        <div class="drawer-body mobile-nav">
          <form action="/shop" class="search" style="display:block;margin-bottom:10px">${ICON.search}<input name="q" placeholder="Search…" style="width:100%"></form>
          ${mobileMenu()}<h4>Help</h4>
          <a href="/track">Track order</a><a href="/account">My account</a><a href="/help">FAQs</a><a href="/pages/contact">Contact us</a>
        </div>
      </aside>`;
    const mount = $('#site-header');
    mount.replaceWith(...header.childNodes);
  }

  function logoHtml(s) {
    return s.logo
      ? `<a class="logo" href="/"><img src="${esc(s.logo)}" alt="${esc(s.store_name)}" style="height:40px;width:auto"></a>`
      : `<a class="logo" href="/"><span class="dot"></span>${esc(s.store_name || 'Store')}</a>`;
  }

  function renderFooter() {
    const s = state.settings;
    const f = $('#site-footer');
    f.className = 'footer';
    f.innerHTML = `<div class="wrap"><div class="footer-grid">
      <div>${logoHtml(s)}<p class="muted" style="max-width:300px">${esc(s.tagline)}</p>
        <div class="socials">${s.instagram ? `<a href="${esc(s.instagram)}" aria-label="Instagram" target="_blank" rel="noopener">${ICON.ig}</a>` : ''}${s.facebook ? `<a href="${esc(s.facebook)}" aria-label="Facebook" target="_blank" rel="noopener">${ICON.fb}</a>` : ''}${s.youtube ? `<a href="${esc(s.youtube)}" aria-label="YouTube" target="_blank" rel="noopener">${ICON.yt}</a>` : ''}</div></div>
      <div><h4>Shop</h4>${topCategories().map((c) => `<a href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('')}<a href="/shop">All products</a><a href="/bulk-order">Bulk & corporate orders</a></div>
      <div><h4>Help</h4><a href="/pages/about">About us</a><a href="/track">Track your order</a><a href="/help#faq">FAQs</a><a href="/pages/shipping-policy">Shipping policy</a><a href="/pages/refund-policy">Refunds & exchange</a><a href="/pages/contact">Contact us</a></div>
      <div><h4>Get in touch</h4><a href="tel:${esc((s.phone || '').replace(/\s/g, ''))}">${esc(s.phone)}</a><a href="mailto:${esc(s.email)}">${esc(s.email)}</a><p class="muted" style="margin:4px 0 0">${esc(s.address)}</p>${s.gstin ? `<p class="muted" style="margin:8px 0 0;font-size:13px">${esc(s.business_name || s.store_name)}<br>GSTIN: ${esc(s.gstin)}</p>` : ''}</div>
    </div><div class="bottom"><span>© ${new Date().getFullYear()} ${esc(s.store_name)}. All rights reserved.</span><span><a href="/pages/privacy-policy" style="display:inline">Privacy</a> · <a href="/pages/terms" style="display:inline">Terms</a> · <a href="/pages/refund-policy" style="display:inline">Refunds</a></span></div></div>`;
    if (s.whatsapp) {
      const wa = document.createElement('a');
      wa.className = 'wa'; wa.href = `https://wa.me/${encodeURIComponent(s.whatsapp)}`; wa.target = '_blank'; wa.rel = 'noopener';
      wa.setAttribute('aria-label', 'Chat on WhatsApp'); wa.innerHTML = ICON.wa;
      document.body.appendChild(wa);
    }
  }

  function bindGlobal() {
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) {
        if (open.dataset.open === 'cart-drawer') openCart();
        else { $('#' + open.dataset.open).classList.add('open'); $('#drawer-bg').classList.add('open'); }
      }
      if (e.target.closest('[data-close]') || e.target.id === 'drawer-bg') closeDrawers();
      const w = e.target.closest('[data-wish]');
      if (w) { e.preventDefault(); toggleWish(Number(w.dataset.wish), w); }
      const qv = e.target.closest('[data-quick]');
      if (qv) { e.preventDefault(); quickView(qv.dataset.quick); }
      const cq = e.target.closest('[data-cq]');
      if (cq) {
        const id = Number(cq.dataset.cq);
        const cur = cart.items().find((i) => i.variant_id === id);
        if (cur) cart.set(id, cur.qty + Number(cq.dataset.d));
      }
      const rm = e.target.closest('[data-rm]');
      if (rm) cart.remove(Number(rm.dataset.rm));
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawers());
    document.addEventListener('cart:change', () => {
      updateBadges();
      if ($('#cart-drawer')?.classList.contains('open')) renderCartDrawer();
    });
  }

  const ready = (async () => {
    const [store, me] = await Promise.all([api('/store'), api('/me')]);
    Object.assign(state, store);
    state.user = me.user;
    if (state.user) {
      api('/me/wishlist').then((w) => {
        state.wish = new Set(w.products.map((p) => p.id));
        $$('[data-wish]').forEach((b) => b.classList.toggle('on', state.wish.has(Number(b.dataset.wish))));
        updateBadges();
      }).catch(() => {});
    }
    renderHeader();
    renderFooter();
    bindGlobal();
    updateBadges();
    return state;
  })();

  window.Store = { $, $$, esc, money, money2, api, toast, cart, state, ready, ICON, payOnline, stars, childrenOf, topCategories, categoryPath, productCard, priceHtml, variantPicker, quickView, modal, openCart, freeShipBar, cartLine };
})();

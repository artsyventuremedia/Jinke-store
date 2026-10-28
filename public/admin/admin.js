/* Admin dashboard SPA (hash routing). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const date = (d, time) => d ? new Date(d.replace(' ', 'T') + (d.length <= 10 ? 'T00:00:00' : 'Z')).toLocaleString('en-IN', time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '—';
  const root = $('#root');
  let me = null;
  let settings = {};

  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    dashboard: I('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
    orders: I('<path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    products: I('<path d="M20 7 12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>'),
    categories: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    collections: I('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    coupons: I('<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3z"/><path d="M13 6v12" stroke-dasharray="2 2"/>'),
    banners: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>'),
    reviews: I('<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>'),
    testimonials: I('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    customers: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c1-4 4-6 7-6s6 2 7 6M16 4a4 4 0 0 1 0 8M22 21c-.5-2.5-2-4.3-4-5.2"/>'),
    subscribers: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    bulk: I('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'),
    integrations: I('<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0z"/><path d="M12 17v5"/>'),
    pages: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
    store: I('<path d="M3 9 5 4h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>'),
    menu: I('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    edit: I('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  };

  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch('/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) { if (me) { me = null; renderLogin(); } }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function toast(msg, err) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.toggle('err', !!err); el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function upload(files) {
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    const { urls } = await api('/admin/upload', { body: fd });
    if (!urls.length) throw new Error('Only image files up to 5 MB are allowed');
    return urls;
  }

  // ---------- Shell ----------
  const NAV = [
    ['dashboard', 'Dashboard'], ['orders', 'Orders'], ['bulk', 'Bulk enquiries'], ['products', 'Products'],
    ['group', 'Catalog'], ['categories', 'Categories'], ['collections', 'Collections'],
    ['group', 'Marketing'], ['coupons', 'Coupons'], ['banners', 'Banners'], ['reviews', 'Reviews'], ['testimonials', 'Testimonials'],
    ['group', 'People'], ['customers', 'Customers'], ['subscribers', 'Subscribers'],
    ['group', 'Store'], ['integrations', 'Integrations'], ['pages', 'Policy pages'], ['settings', 'Settings'],
  ];

  function renderShell() {
    root.innerHTML = `<div class="layout">
      <aside class="side" id="side">
        <div class="brand">${settings.logo ? `<img src="${esc(settings.logo)}" alt="${esc(settings.store_name)}">` : `<span class="dot"></span>${esc(settings.store_name || 'Store')}`} <small>admin</small></div>
        <nav>${NAV.map(([k, label]) => k === 'group' ? `<div class="group">${label}</div>` : `<a href="#/${k}" data-nav="${k}">${ICON[k]}${label}</a>`).join('')}
          <div class="group">&nbsp;</div><a href="/" target="_blank">${ICON.store}View store ↗</a></nav>
      </aside>
      <div class="main">
        <div class="topbar"><button class="icon-btn menu-btn" id="menu" aria-label="Menu">${ICON.menu}</button><b id="crumb"></b>
          <div class="who"><span class="muted">${esc(me.email)}</span><button class="btn ghost sm" id="logout">Log out</button></div></div>
        <div class="content" id="view"></div>
      </div>
    </div>`;
    $('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
    $('#logout').addEventListener('click', async () => { await api('/auth/logout', { body: {} }); location.href = '/admin/'; });
  }

  function renderLogin() {
    root.innerHTML = `<div class="login"><form class="card" id="lf">
      <h1 style="margin-bottom:4px">Admin login</h1><p class="muted" style="margin:0 0 20px">Sign in to manage your store.</p>
      <div class="field"><label for="le">Email</label><input class="input" id="le" name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="lp">Password</label><input class="input" id="lp" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn" style="width:100%;justify-content:center">Log in</button>
      <p style="text-align:center;font-size:13px;margin:12px 0 0"><a href="/reset" style="text-decoration:underline">Forgot password?</a></p>
      <p class="muted" id="lerr" style="color:var(--bad);min-height:20px;margin:10px 0 0"></p></form></div>`;
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/auth/login', { body: Object.fromEntries(new FormData(e.target)) });
        if (r.role !== 'admin') { await api('/auth/logout', { body: {} }); throw new Error('This account does not have admin access'); }
        boot();
      } catch (err) { $('#lerr').textContent = err.message; }
    });
  }

  // ---------- Router ----------
  const ROUTES = {};
  async function route() {
    if (!me) return;
    const [name = 'dashboard', ...rest] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    const page = ROUTES[name] ? name : 'dashboard';
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === page));
    $('#side').classList.remove('open');
    $$('.overlay').forEach((el) => el.remove()); // close any edit panel left open on the previous page
    $('#crumb').textContent = (NAV.find((n) => n[0] === page) || [])[1] || '';
    const view = $('#view');
    view.innerHTML = '<div class="skeleton"></div>';
    try { await ROUTES[page](view, ...rest); } catch (e) { view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  }

  // ---------- Dashboard ----------
  let dashDays = 30;
  let dashMetric = 'revenue';
  ROUTES.dashboard = async (view) => {
    const d = await api('/admin/dashboard?days=' + dashDays);
    const delta = (cur, prev) => {
      if (!prev) return cur ? '<span class="delta up">New this period</span>' : '<span class="delta muted">—</span>';
      const pct = Math.round(((cur - prev) / prev) * 100);
      return `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs previous ${d.days} days</span>`;
    };
    view.innerHTML = `<div class="page-title"><h1>Dashboard</h1>
        <div class="seg" id="range">${[7, 30, 90].map((n) => `<button class="${n === d.days ? 'on' : ''}" data-days="${n}">${n} days</button>`).join('')}</div></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Revenue</div><div class="value num">${money(d.revenue)}</div>${delta(d.revenue, d.prev_revenue)}</div>
        <div class="card kpi"><div class="label">Orders</div><div class="value num">${d.orders}</div>${delta(d.orders, d.prev_orders)}</div>
        <div class="card kpi"><div class="label">Avg. order value</div><div class="value num">${money(d.aov)}</div><span class="delta muted">Excludes cancelled & returned</span></div>
        <div class="card kpi"><div class="label">To fulfil</div><div class="value num">${d.pending}</div><a class="delta" style="color:var(--info)" href="#/orders">Pending, confirmed & packed →</a></div>
      </div>
      <div class="grid dash-2">
        <div class="card"><div class="card-head"><h2 id="chart-title"></h2>
          <div style="display:flex;gap:8px"><div class="seg" id="metric"><button data-m="revenue">Revenue</button><button data-m="orders">Orders</button></div>
          <button class="btn ghost sm" id="as-table">Table</button></div></div>
          <div id="chart"></div></div>
        <div class="card"><div class="card-head"><h2>Orders by status</h2><span class="muted">All time</span></div>
          ${statusList(d.by_status)}</div>
      </div>
      <div class="grid dash-2">
        <div class="card"><div class="card-head"><h2>Recent orders</h2><a class="btn ghost sm" href="#/orders">View all</a></div>
          <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>
          ${d.recent.map((o) => `<tr class="link" data-href="#/orders/${o.id}"><td><b>#${esc(o.order_no)}</b><br><span class="muted">${date(o.created_at, true)}</span></td><td>${esc(o.name)}</td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td class="r num">${money(o.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No orders yet</td></tr>'}
          </tbody></table></div></div>
        <div class="grid" style="align-content:start">
          <div class="card"><div class="card-head"><h2>Top products</h2><span class="muted">${d.days} days</span></div>
            ${d.top_products.map((p, i) => `<div class="list-row"><span class="muted num">${i + 1}</span><span class="grow">${esc(p.name)}</span><span class="num">${p.units} sold</span></div>`).join('') || '<p class="muted">No sales yet</p>'}</div>
          <div class="card"><div class="card-head"><h2>Low stock</h2><a class="btn ghost sm" href="#/products">Manage</a></div>
            ${d.low_stock.map((v) => `<a class="list-row" href="#/products/${v.id}"><span class="grow">${esc(v.name)} <span class="muted">· ${esc(v.label)}</span></span><span class="pill ${v.stock === 0 ? 'bad' : 'warn'}" style="text-transform:none">${v.stock === 0 ? 'Out of stock' : v.stock + ' left'}</span></a>`).join('') || '<p class="muted">All variants are well stocked</p>'}</div>
        </div>
      </div>`;
    $$('[data-days]').forEach((b) => b.addEventListener('click', () => { dashDays = Number(b.dataset.days); route(); }));
    let asTable = false;
    const draw = () => {
      $$('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === dashMetric));
      $('#chart-title').textContent = `${dashMetric === 'revenue' ? 'Revenue' : 'Orders'} per day`;
      $('#as-table').textContent = asTable ? 'Chart' : 'Table';
      if (asTable) {
        $('#chart').innerHTML = `<div class="table-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>Date</th><th class="r">Orders</th><th class="r">Revenue</th></tr></thead><tbody>
          ${[...d.series].reverse().map((s) => `<tr><td>${date(s.day)}</td><td class="r num">${s.orders}</td><td class="r num">${money(s.revenue)}</td></tr>`).join('')}</tbody></table></div>`;
      } else barChart($('#chart'), d.series, dashMetric);
    };
    $$('[data-m]').forEach((b) => b.addEventListener('click', () => { dashMetric = b.dataset.m; draw(); }));
    $('#as-table').addEventListener('click', () => { asTable = !asTable; draw(); });
    draw();
  };

  function statusList(rows) {
    const order = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
    const total = rows.reduce((s, r) => s + r.n, 0) || 1;
    return order.map((s) => {
      const n = rows.find((r) => r.status === s)?.n || 0;
      return `<a class="list-row" href="#/orders?status=${s}"><span class="pill ${s}" style="min-width:96px">${s}</span>
        <span class="grow"><span style="display:block;height:6px;border-radius:3px;background:var(--grid)"><span style="display:block;height:6px;border-radius:3px;width:${(n / total) * 100}%;background:var(--series-1)"></span></span></span>
        <span class="num" style="min-width:32px;text-align:right">${n}</span></a>`;
    }).join('');
  }

  // Single-series bar chart with hover tooltip. One measure at a time — no dual axis.
  function barChart(el, series, metric) {
    const W = el.clientWidth || 600;
    const H = 260;
    const pad = { t: 10, r: 4, b: 26, l: metric === 'revenue' ? 56 : 32 };
    const vals = series.map((s) => s[metric]);
    // Five equal intervals with round tick values (1/2/5 × 10^n per step).
    const niceMax = (v) => {
      const raw = Math.max(v, metric === 'orders' ? 5 : 1000) / 5;
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      return [1, 2, 5, 10].find((k) => k * p >= raw) * p * 5;
    };
    const max = niceMax(Math.max(...vals));
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const step = iw / series.length;
    const bw = Math.max(2, step - 2); // 2px surface gap between adjacent bars
    const y = (v) => pad.t + ih - (v / max) * ih;
    const fmt = (v) => metric === 'revenue' ? (v >= 1000 ? '₹' + (v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + 'k' : '₹' + v) : String(v);
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => max * k);
    const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(iw / 70)));
    const r = Math.min(4, bw / 2);
    const barPath = (x, top, w) => {
      const h = pad.t + ih - top;
      if (h <= 0) return '';
      const rr = Math.min(r, h);
      return `M${x},${pad.t + ih}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${pad.t + ih}Z`;
    };
    el.innerHTML = `<div class="viz"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric} per day bar chart">
      <g class="axis">${ticks.map((t) => `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(Math.round(t))}</text>`).join('')}
      ${series.map((s, i) => i % labelEvery === 0 ? `<text x="${pad.l + i * step + step / 2}" y="${H - 6}" text-anchor="middle">${new Date(s.day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</text>` : '').join('')}</g>
      ${series.map((s, i) => `<g><rect class="hit" data-i="${i}" x="${pad.l + i * step}" y="${pad.t}" width="${step}" height="${ih}"/><path class="bar" d="${barPath(pad.l + i * step + 1, y(s[metric]), bw)}"/></g>`).join('')}
    </svg><div class="tooltip hidden" id="tip"></div></div>`;
    const tip = $('#tip', el);
    const svg = $('svg', el);
    svg.addEventListener('mousemove', (e) => {
      const hit = e.target.closest('.hit');
      $$('.bar.hover', el).forEach((b) => b.classList.remove('hover'));
      if (!hit) { tip.classList.add('hidden'); return; }
      const s = series[Number(hit.dataset.i)];
      hit.nextElementSibling.classList.add('hover');
      const box = svg.getBoundingClientRect();
      const scale = box.width / W;
      tip.innerHTML = `<span class="muted">${date(s.day)}</span><b class="num">${metric === 'revenue' ? money(s.revenue) : s.orders + ' orders'}</b><span class="muted">${metric === 'revenue' ? s.orders + ' orders' : money(s.revenue)}</span>`;
      tip.style.left = `${(Number(hit.getAttribute('x')) + step / 2) * scale}px`;
      tip.style.top = `${Math.max(40, y(s[metric]) * scale)}px`;
      tip.classList.remove('hidden');
    });
    svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); $$('.bar.hover', el).forEach((b) => b.classList.remove('hover')); });
  }

  // ---------- Orders ----------
  ROUTES.orders = async (view, id) => {
    if (id) return orderDetail(view, id.split('?')[0]);
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const status = params.get('status') || '';
    const q = params.get('q') || '';
    const { orders, statuses } = await api(`/admin/orders?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    view.innerHTML = `<div class="page-title"><h1>Orders</h1><button class="btn ghost" id="csv">Export CSV</button></div>
      <div class="filters"><input class="input" id="q" placeholder="Search order #, name, phone, email" value="${esc(q)}">
        <select class="input" id="st"><option value="">All statuses</option>${statuses.map((s) => `<option ${s === status ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>
      ${orders.map((o) => `<tr class="link" data-href="#/orders/${o.id}"><td><b>#${esc(o.order_no)}</b></td><td>${date(o.created_at, true)}</td><td>${esc(o.name)}${o.buyer_gstin ? ' <span class="pill info" style="text-transform:none" title="Business order with GSTIN">B2B</span>' : ''}<br><span class="muted">${esc(o.phone)}</span></td><td class="num">${o.units}</td>
        <td><span class="pill ${esc(o.payment_status)}">${o.payment_method === 'cod' ? 'COD' : 'Online'} · ${esc(o.payment_status)}</span></td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td><td class="r num"><b>${money(o.total)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No orders match these filters</td></tr>'}
      </tbody></table></div></div>`;
    const apply = () => { location.hash = `#/orders?status=${$('#st').value}&q=${encodeURIComponent($('#q').value.trim())}`; };
    $('#st').addEventListener('change', apply);
    $('#q').addEventListener('keydown', (e) => e.key === 'Enter' && apply());
    $('#csv').addEventListener('click', () => downloadCsv('orders.csv', orders, ['order_no', 'created_at', 'name', 'email', 'phone', 'city', 'state', 'pincode', 'subtotal', 'discount', 'shipping', 'total', 'coupon_code', 'payment_method', 'payment_status', 'status', 'courier', 'tracking_no', 'invoice_no', 'buyer_company', 'buyer_gstin']));
  };

  async function orderDetail(view, id) {
    const { order: o, statuses, notifications, shiprocket: srOn } = await api('/admin/orders/' + id);
    const canShip = srOn && !o.tracking_no && !['cancelled', 'returned', 'delivered'].includes(o.status);
    view.innerHTML = `<div class="page-title"><div><a class="muted" href="#/orders">← Orders</a><h1>Order #${esc(o.order_no)}</h1><span class="muted">${date(o.created_at, true)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="pill ${esc(o.status)}">${esc(o.status)}</span><span class="pill ${esc(o.payment_status)}">${esc(o.payment_status)}</span>
          <a class="btn ghost sm" href="/admin/invoice/${o.id}" target="_blank">${o.invoice_no ? 'Invoice ' + esc(o.invoice_no) : 'Create invoice'} ↗</a>
          ${o.label_url ? `<a class="btn ghost sm" href="${esc(o.label_url)}" target="_blank" rel="noopener">Shipping label ↗</a>` : ''}
          ${canShip ? '<button class="btn sm" id="ship">Ship with Shiprocket</button>' : ''}</div></div>
      <div class="edit-layout"><div>
        <div class="card"><h2 style="margin-bottom:10px">Items</h2><div class="table-wrap"><table><tbody>
          ${o.items.map((i) => `<tr><td style="width:56px"><img class="thumb" src="${esc(i.image || '')}" alt=""></td><td><b>${esc(i.name)}</b><br><span class="muted">${esc(i.size)}</span></td><td class="num">${money(i.price)} × ${i.qty}</td><td class="r num"><b>${money(i.price * i.qty)}</b></td></tr>`).join('')}
          <tr><td colspan="3" class="muted">Subtotal</td><td class="r num">${money(o.subtotal)}</td></tr>
          ${o.discount ? `<tr><td colspan="3" class="muted">Discount ${o.coupon_code ? `(${esc(o.coupon_code)})` : ''}</td><td class="r num">−${money(o.discount)}</td></tr>` : ''}
          <tr><td colspan="3" class="muted">Shipping</td><td class="r num">${o.shipping ? money(o.shipping) : 'Free'}</td></tr>
          <tr><td colspan="3"><b>Total</b></td><td class="r num"><b>${money(o.total)}</b></td></tr>
        </tbody></table></div></div>
        ${o.tracking_no ? `<div class="card"><div class="card-head"><h2>Shipment</h2>${o.shiprocket_shipment_id ? '<button class="btn ghost sm" id="sync">Refresh tracking</button>' : ''}</div>
          <dl class="kv"><dt>Courier</dt><dd>${esc(o.courier || '—')}</dd><dt>AWB</dt><dd>${esc(o.tracking_no)}</dd>
          ${o.tracking_status ? `<dt>Latest</dt><dd>${esc(o.tracking_status)}</dd>` : ''}${o.shiprocket_order_id ? `<dt>Shiprocket</dt><dd>Order ${esc(o.shiprocket_order_id)}</dd>` : ''}</dl></div>` : ''}
        <div class="card"><h2 style="margin-bottom:12px">Timeline</h2><ul class="timeline">${[...o.events].reverse().map((e) => `<li><b style="text-transform:capitalize">${esc(e.status)}</b> <span class="muted">· ${date(e.created_at, true)}</span>${e.note ? `<br>${esc(e.note)}` : ''}</li>`).join('')}</ul></div>
      </div><div>
        <form class="card" id="of"><h2 style="margin-bottom:12px">Update order</h2>
          <div class="field"><label>Order status</label><select class="input" name="status">${statuses.map((s) => `<option ${s === o.status ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
            <span class="hint">Cancelling or returning puts the items back in stock.</span></div>
          <div class="field"><label>Payment status</label><select class="input" name="payment_status">${['pending', 'paid', 'refunded', 'failed'].map((s) => `<option ${s === o.payment_status ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
          <div class="form-grid"><div class="field"><label>Courier</label><input class="input" name="courier" value="${esc(o.courier || '')}" placeholder="Delhivery"></div>
          <div class="field"><label>Tracking / AWB</label><input class="input" name="tracking_no" value="${esc(o.tracking_no || '')}"></div></div>
          <div class="field"><label>Note for timeline <span class="muted">(visible to customer)</span></label><input class="input" name="note" placeholder="e.g. Dispatched from Bengaluru"></div>
          <label class="check" style="margin-bottom:14px"><input type="checkbox" name="notify" checked> Email the customer when the status changes</label>
          <button class="btn">Save changes</button></form>
        <div class="card"><h2 style="margin-bottom:10px">Customer</h2><dl class="kv">
          ${o.buyer_gstin ? `<dt>Business</dt><dd>${esc(o.buyer_company)}</dd><dt>GSTIN</dt><dd><b>${esc(o.buyer_gstin)}</b></dd>` : ''}
          <dt>Name</dt><dd>${esc(o.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a style="color:var(--good)" target="_blank" rel="noopener" href="https://wa.me/${esc(o.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1'))}">WhatsApp</a></dd>
          <dt>Email</dt><dd><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></dd>
          <dt>Address</dt><dd>${esc(o.address)}<br>${esc(o.city)}, ${esc(o.state)} ${esc(o.pincode)}</dd>
          <dt>Payment</dt><dd>${o.payment_method === 'cod' ? 'Cash on delivery' : 'Online'}${o.payment_id ? `<br><span class="muted">${esc(o.payment_id)}</span>` : ''}</dd>
          ${o.notes ? `<dt>Notes</dt><dd>${esc(o.notes)}</dd>` : ''}</dl></div>
        <div class="card"><div class="card-head"><h2>Messages sent</h2><button class="btn ghost sm" id="resend">Resend latest</button></div>
          ${notifications.length ? notifications.map((n) => `<div class="list-row"><span class="pill ${n.ok ? 'good' : 'bad'}" style="text-transform:none">${n.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</span>
            <span class="grow" style="white-space:normal">${esc(n.event)} → ${esc(n.recipient || '')}${n.ok ? '' : `<br><span class="muted">${esc(n.detail)}</span>`}<br><span class="muted" style="font-size:12px">${date(n.created_at, true)}</span></span></div>`).join('')
            : '<p class="muted" style="margin:0">No WhatsApp or SMS messages yet. Emails are sent when email is set up.</p>'}</div>
      </div></div>`;
    $('#ship')?.addEventListener('click', async (e) => {
      if (!confirm('Create the shipment in Shiprocket, assign the recommended courier and schedule pickup?')) return;
      e.target.disabled = true; e.target.textContent = 'Booking courier…';
      try { const r = await api(`/admin/orders/${id}/ship`, { body: {} }); toast(`Shipped with ${r.order.courier} · AWB ${r.order.tracking_no}`); route(); } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Ship with Shiprocket'; }
    });
    $('#sync')?.addEventListener('click', async () => {
      try { const r = await api(`/admin/orders/${id}/track`, { body: {} }); toast(r.moved ? `Order marked ${r.moved}` : `Latest: ${r.status}`); route(); } catch (err) { toast(err.message, true); }
    });
    $('#resend')?.addEventListener('click', async () => {
      try { await api(`/admin/orders/${id}/resend`, { body: {} }); toast('Sending… refresh in a moment to see the result'); setTimeout(route, 2500); } catch (err) { toast(err.message, true); }
    });
    $('#of').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { ...Object.fromEntries(fd), notify: fd.has('notify') };
      try { await api('/admin/orders/' + id, { method: 'PUT', body }); toast('Order updated'); route(); } catch (err) { toast(err.message, true); }
    });
  }

  function downloadCsv(name, rows, cols) {
    // A leading = + - @ would make Excel/Sheets treat customer-typed text as a formula.
    const cell = (v) => {
      let t = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
      return `"${t.replace(/"/g, '""')}"`;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Category tree helpers ----------
  const catKids = (cats, id) => cats.filter((c) => c.parent_ids.includes(id));
  // Every place a category appears in the tree, as "Apparels › T-Shirts › Round Neck".
  function catPaths(cats) {
    const out = [];
    const walk = (c, trail) => {
      const path = [...trail, c.name];
      out.push({ c, depth: trail.length, label: path.join(' › ') });
      catKids(cats, c.id).forEach((k) => walk(k, path));
    };
    cats.filter((c) => !c.parent_ids.length).forEach((t) => walk(t, []));
    return out;
  }
  // One <option> per category, labelled with its first full path.
  const catOptions = (cats, selected) => {
    const seen = new Set();
    return catPaths(cats).filter(({ c }) => !seen.has(c.id) && seen.add(c.id))
      .map(({ c, label }) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  };

  ROUTES.categories = async (view) => {
    const { items: cats } = await api('/admin/categories');
    view.innerHTML = `<div class="page-title"><h1>Categories</h1><button class="btn" id="add">+ Add category</button></div>
      <div class="card" style="margin-bottom:16px"><p class="muted" style="margin:0">Top-level categories (no parent) become the menu headings on your store, e.g. <b>Apparels</b> and <b>Merchandise</b>.
        Put a category under one or more parents to show it in those menus — a parent's page lists the products of everything below it.</p></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th></th><th>Category</th><th>Shown under</th><th class="r">Products</th><th class="r">Sort</th><th></th></tr></thead><tbody>
      ${catPaths(cats).map(({ c, depth }) => `<tr class="link" data-edit="${c.id}"><td style="width:58px">${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="">` : '<div class="thumb"></div>'}</td>
        <td><span style="padding-left:${depth * 22}px;display:inline-block">${depth ? '<span class="muted">└ </span>' : ''}<b>${esc(c.name)}</b></span>${depth ? '' : ' <span class="pill info" style="text-transform:none">menu heading</span>'}</td>
        <td class="muted">${c.parent_ids.map((id) => esc(cats.find((x) => x.id === id)?.name || '')).join(', ') || '—'}</td>
        <td class="r num">${c.products}</td><td class="r num">${c.sort}</td>
        <td class="r"><button class="icon-btn" data-delete="${c.id}" aria-label="Delete">${ICON.trash}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No categories yet</td></tr>'}
      </tbody></table></div></div>`;
    $('#add').addEventListener('click', () => categoryPanel(cats, null));
    view.querySelector('tbody').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-delete]');
      if (del) {
        e.stopPropagation();
        const c = cats.find((x) => x.id === Number(del.dataset.delete));
        if (!confirm(`Delete “${c.name}”? Its sub-categories move up a level, and its ${c.products} product(s) will have no category.`)) return;
        await api('/admin/categories/' + c.id, { method: 'DELETE' });
        toast('Category deleted'); route(); return;
      }
      const row = e.target.closest('[data-edit]');
      if (row) categoryPanel(cats, cats.find((x) => x.id === Number(row.dataset.edit)));
    });
  };

  function categoryPanel(cats, item) {
    // A category can't go under itself or anything below it.
    const blocked = new Set();
    if (item) { const mark = (id) => { blocked.add(id); catKids(cats, id).forEach((k) => mark(k.id)); }; mark(item.id); }
    const seen = new Set();
    const choices = catPaths(cats).filter(({ c }) => !blocked.has(c.id) && !seen.has(c.id) && seen.add(c.id));
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="drawer-bg"></div><form class="panel"><div class="panel-head"><h2>${item ? 'Edit' : 'Add'} category</h2><button type="button" class="icon-btn" data-x aria-label="Close">${ICON.close}</button></div>
      <div class="panel-body">
        <div class="field"><label>Name</label><input class="input" name="name" required value="${esc(item?.name || '')}"></div>
        <div class="field"><label>Show under</label>
          <div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;max-height:240px;overflow:auto">
            ${choices.map(({ c, label }) => `<label class="check" style="font-weight:400;padding:3px 0"><input type="checkbox" name="parent_ids" value="${c.id}" ${item?.parent_ids.includes(c.id) ? 'checked' : ''}> ${esc(label)}</label>`).join('') || '<span class="muted">No other categories yet</span>'}
          </div><span class="hint">Leave all unticked to make it a menu heading. Tick more than one to show it in several menus (like Caps).</span></div>
        <div class="field"><label>Image</label><div style="display:flex;gap:10px;align-items:center"><img class="thumb" data-prev src="${esc(item?.image || '')}" alt="" style="${item?.image ? '' : 'visibility:hidden'}"><input class="input" name="image" value="${esc(item?.image || '')}" placeholder="Image URL"><label class="btn ghost sm">Upload<input type="file" accept="image/*" hidden data-up></label></div></div>
        <div class="field"><label>Sort order</label><input class="input" name="sort" type="number" value="${item?.sort ?? 0}"><span class="hint">Lower numbers show first in menus</span></div>
      </div>
      <div class="panel-foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn">Save</button></div></form>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $$('[data-x]', wrap).forEach((b) => b.addEventListener('click', close));
    $('.drawer-bg', wrap).addEventListener('click', close);
    $('[data-up]', wrap).addEventListener('change', async (e) => {
      try { const [url] = await upload(e.target.files); $('[name=image]', wrap).value = url; const p = $('[data-prev]', wrap); p.src = url; p.style.visibility = ''; } catch (err) { toast(err.message, true); }
    });
    $('form', wrap).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { ...Object.fromEntries(fd), parent_ids: fd.getAll('parent_ids').map(Number) };
      try {
        await api('/admin/categories' + (item ? '/' + item.id : ''), { method: item ? 'PUT' : 'POST', body });
        toast('Category saved'); close(); route();
      } catch (err) { toast(err.message, true); }
    });
    $('[name=name]', wrap).focus();
  }

  // ---------- Bulk enquiries ----------
  ROUTES.bulk = async (view) => {
    const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
    const { items, counts, statuses } = await api('/admin/bulk?status=' + status);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const pill = { new: 'warn', contacted: 'info', quoted: 'info', won: 'good', lost: 'bad' };
    view.innerHTML = `<div class="page-title"><h1>Bulk enquiries</h1><button class="btn ghost" id="csv">Export CSV</button></div>
      <div class="filters"><div class="seg">${[['', `All (${total})`], ...statuses.map((x) => [x, `${x[0].toUpperCase() + x.slice(1)} (${counts[x] || 0})`])].map(([k, l]) => `<button data-st="${k}" class="${k === status ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${items.length ? items.map((e) => `<div class="card" style="margin-bottom:12px" data-id="${e.id}">
        <div class="card-head" style="margin-bottom:8px"><div><b style="font-size:15px">${esc(e.company || e.name)}</b> <span class="muted">· ${date(e.created_at, true)}</span></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="pill ${pill[e.status]}">${esc(e.status)}</span>
            <select class="input" data-status style="width:auto;padding:5px 8px">${statuses.map((x) => `<option ${x === e.status ? 'selected' : ''} value="${x}">${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:6px 24px">
          <dl class="kv"><dt>Contact</dt><dd>${esc(e.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(e.phone)}">${esc(e.phone)}</a> · <a style="color:var(--good)" target="_blank" rel="noopener" href="https://wa.me/${esc(String(e.phone).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1'))}">WhatsApp</a></dd>
            <dt>Email</dt><dd><a href="mailto:${esc(e.email)}">${esc(e.email)}</a></dd>${e.city ? `<dt>City</dt><dd>${esc(e.city)}</dd>` : ''}${e.gstin ? `<dt>GSTIN</dt><dd>${esc(e.gstin)}</dd>` : ''}</dl>
          <dl class="kv"><dt>Products</dt><dd>${esc(e.products)}</dd><dt>Quantity</dt><dd><b>${esc(e.quantity)}</b> pcs</dd>
            ${e.customization ? `<dt>Customisation</dt><dd>${esc(e.customization)}</dd>` : ''}${e.needed_by ? `<dt>Needed by</dt><dd>${date(e.needed_by)}</dd>` : ''}</dl>
        </div>
        ${e.message ? `<p style="background:var(--surface-2);padding:10px 12px;border-radius:8px;margin:10px 0 0">${esc(e.message)}</p>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px"><input class="input" data-notes placeholder="Internal notes (quote sent, price agreed…)" value="${esc(e.notes || '')}">
          <button class="btn ghost sm" data-save>Save note</button><button class="icon-btn" data-del aria-label="Delete">${ICON.trash}</button></div>
      </div>`).join('') : '<div class="card empty">No enquiries yet. They arrive from the Bulk Order page on your store.</div>'}`;
    $$('[data-st]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/bulk?status=' + b.dataset.st; }));
    view.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-status]')) return;
      const id = e.target.closest('[data-id]').dataset.id;
      await api('/admin/bulk/' + id, { method: 'PUT', body: { status: e.target.value } });
      toast('Status updated'); route();
    });
    view.addEventListener('click', async (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      if (e.target.closest('[data-save]')) { await api('/admin/bulk/' + card.dataset.id, { method: 'PUT', body: { notes: $('[data-notes]', card).value } }); toast('Note saved'); }
      if (e.target.closest('[data-del]') && confirm('Delete this enquiry?')) { await api('/admin/bulk/' + card.dataset.id, { method: 'DELETE' }); toast('Deleted'); route(); }
    });
    $('#csv').addEventListener('click', () => downloadCsv('bulk-enquiries.csv', items, ['created_at', 'status', 'name', 'company', 'gstin', 'phone', 'email', 'city', 'products', 'quantity', 'customization', 'needed_by', 'message', 'notes']));
  };

  // ---------- Products ----------
  let catalog = { categories: [], collections: [] };
  async function loadCatalog() {
    const [c, col] = await Promise.all([api('/admin/categories'), api('/admin/collections')]);
    catalog = { categories: c.items, collections: col.items };
  }

  ROUTES.products = async (view, id) => {
    await loadCatalog();
    if (id) return productEditor(view, id);
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const q = params.get('q') || '';
    const cat = params.get('category_id') || '';
    const status = params.get('status') || '';
    const { products } = await api(`/admin/products?q=${encodeURIComponent(q)}&category_id=${cat}&status=${status}`);
    view.innerHTML = `<div class="page-title"><h1>Products <span class="muted" style="font-weight:500">(${products.length})</span></h1><a class="btn" href="#/products/new">+ Add product</a></div>
      <div class="filters"><input class="input" id="q" placeholder="Search products" value="${esc(q)}">
        <select class="input" id="cat"><option value="">All categories</option>${catOptions(catalog.categories, Number(cat))}</select>
        <select class="input" id="status"><option value="">Any status</option><option value="active" ${status === 'active' ? 'selected' : ''}>Active</option><option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option></select></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Stock</th><th>Status</th><th></th></tr></thead><tbody>
      ${products.map((p) => `<tr class="link" data-href="#/products/${p.id}"><td style="width:58px"><img class="thumb" src="${esc(p.images[0] || '')}" alt=""></td>
        <td><b>${esc(p.name)}</b><br><span class="muted">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}${p.is_trending ? ' · Trending' : ''}${p.is_featured ? ' · Featured' : ''}</span></td>
        <td>${esc(p.category_name || '—')}<br><span class="muted">${esc(p.collection_name || '')}</span></td>
        <td class="r num">${money(p.price)}${p.mrp > p.price ? `<br><s class="muted">${money(p.mrp)}</s>` : ''}</td>
        <td class="r num">${p.stock === 0 ? '<span class="pill bad">Out</span>' : p.variants.some((v) => v.stock <= 5) ? `<span class="pill warn">${p.stock}</span>` : p.stock}</td>
        <td><span class="pill ${p.status === 'active' ? 'active' : ''}">${esc(p.status)}</span></td>
        <td class="r"><a class="icon-btn" href="/product/${esc(p.slug)}" target="_blank" title="View in store" data-stop>↗</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No products found</td></tr>'}
      </tbody></table></div></div>`;
    const apply = () => { location.hash = `#/products?q=${encodeURIComponent($('#q').value.trim())}&category_id=${$('#cat').value}&status=${$('#status').value}`; };
    $('#cat').addEventListener('change', apply);
    $('#status').addEventListener('change', apply);
    $('#q').addEventListener('keydown', (e) => e.key === 'Enter' && apply());
  };

  const SIZE_PRESETS = { 'Sizes S–XXL': ['S', 'M', 'L', 'XL', 'XXL'], Colours: ['Black', 'Grey', 'Red'], Bottle: ['750 ml', '1 litre'], 'Free size': ['Free Size'], Single: ['Standard'] };

  async function productEditor(view, id) {
    const isNew = id === 'new';
    const p = isNew ? { name: '', description: '', price: '', mrp: '', images: [], tags: '', status: 'active', variants: [{ label: 'Standard', stock: 10 }] }
      : (await api('/admin/products/' + id)).product;
    let images = [...p.images];
    let variants = p.variants.map((v) => ({ ...v }));
    view.innerHTML = `<form id="pf"><div class="page-title"><div><a class="muted" href="#/products">← Products</a><h1>${isNew ? 'Add product' : esc(p.name)}</h1></div>
        <div style="display:flex;gap:8px">${isNew ? '' : `<a class="btn ghost" href="/product/${esc(p.slug)}" target="_blank">View ↗</a><button type="button" class="btn danger" id="del">Delete</button>`}<button class="btn">Save product</button></div></div>
      <div class="edit-layout"><div>
        <div class="card">
          <div class="field"><label for="pn">Name</label><input class="input" id="pn" name="name" required value="${esc(p.name)}"></div>
          <div class="field"><label for="pd">Description</label><textarea class="input" id="pd" name="description" rows="8">${esc(p.description)}</textarea></div>
        </div>
        <div class="card"><div class="card-head"><h2>Images</h2><span class="muted">First image is the cover. Drag files onto the tile or click.</span></div><div class="images" id="imgs"></div></div>
        <div class="card"><div class="card-head"><h2>Variants & stock</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.keys(SIZE_PRESETS).map((k) => `<button type="button" class="btn ghost sm" data-preset="${k}">${k}</button>`).join('')}</div></div>
          <div class="table-wrap"><table class="variants"><thead><tr><th>Size / option</th><th>SKU</th><th style="width:110px">Stock</th><th style="width:130px" title="Shown when the customer picks this option, e.g. the red cap for Red">Photo</th><th></th></tr></thead><tbody id="vars"></tbody></table></div>
          <button type="button" class="btn ghost sm" id="addv" style="margin-top:8px">+ Add variant</button></div>
      </div><div>
        <div class="card">
          <div class="field"><label>Status</label><select class="input" name="status"><option value="active" ${p.status === 'active' ? 'selected' : ''}>Active (visible in store)</option><option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft (hidden)</option></select></div>
          <div class="form-grid"><div class="field"><label for="pp">Selling price ₹</label><input class="input" id="pp" name="price" type="number" min="0" required value="${esc(p.price)}"></div>
          <div class="field"><label for="pm">MRP ₹ <span class="muted">(optional)</span></label><input class="input" id="pm" name="mrp" type="number" min="0" value="${esc(p.mrp || '')}"></div></div>
          <label class="check"><input type="checkbox" name="is_trending" ${p.is_trending ? 'checked' : ''}> Show in “Trending now”</label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="is_featured" ${p.is_featured ? 'checked' : ''}> Featured on home page</label>
        </div>
        <div class="card">
          <div class="field"><label>Category</label><select class="input" name="category_id"><option value="">None</option>${catOptions(catalog.categories, p.category_id)}</select></div>
          <div class="field"><label>Collection</label><select class="input" name="collection_id"><option value="">None</option>${catalog.collections.map((c) => `<option value="${c.id}" ${c.id === p.collection_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="form-grid"><div class="field"><label for="ph">HSN code</label><input class="input" id="ph" name="hsn" value="${esc(p.hsn || '')}" placeholder="Store default"></div>
          <div class="field"><label for="pg">GST rate %</label><input class="input" id="pg" name="gst_rate" type="number" min="0" max="28" step="0.01" value="${p.gst_rate ?? ''}" placeholder="Store default"></div></div>
          <div class="field"><label for="pt">Search tags</label><input class="input" id="pt" name="tags" value="${esc(p.tags || '')}" placeholder="kannada, bengaluru, cotton"></div>
          <div class="field"><label for="ps">URL slug</label><input class="input" id="ps" name="slug" value="${esc(p.slug || '')}" placeholder="auto from name"></div>
        </div>
      </div></div></form>`;

    const drawImages = () => {
      $('#imgs').innerHTML = images.map((src, i) => `<div class="im"><img src="${esc(src)}" alt="">${i === 0 ? '<span class="first">Cover</span>' : ''}
        <div class="tools"><button type="button" data-left="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move left">←</button><button type="button" data-rmimg="${i}" aria-label="Remove">✕</button></div></div>`).join('')
        + '<label class="upload-tile" id="drop">+ Upload images<input type="file" accept="image/*" multiple hidden id="file"></label>';
      $('#file').addEventListener('change', (e) => addFiles(e.target.files));
      const drop = $('#drop');
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--text)'; });
      drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
      drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
    };
    const addFiles = async (files) => {
      try { images.push(...await upload(files)); drawImages(); drawVariants(); } catch (e) { toast(e.message, true); }
    };
    $('#imgs').addEventListener('click', (e) => {
      const l = e.target.closest('[data-left]');
      if (l) { const i = Number(l.dataset.left); [images[i - 1], images[i]] = [images[i], images[i - 1]]; drawImages(); drawVariants(); }
      const r = e.target.closest('[data-rmimg]');
      if (r) {
        const [gone] = images.splice(Number(r.dataset.rmimg), 1);
        variants.forEach((v) => { if (v.image === gone) v.image = null; });
        drawImages(); drawVariants();
      }
    });

    const drawVariants = () => {
      $('#vars').innerHTML = variants.map((v, i) => `<tr><td><input class="input" data-vf="label" data-i="${i}" value="${esc(v.label)}" placeholder="e.g. M"></td>
        <td><input class="input" data-vf="sku" data-i="${i}" value="${esc(v.sku || '')}" placeholder="optional"></td>
        <td><input class="input" type="number" min="0" data-vf="stock" data-i="${i}" value="${v.stock}"></td>
        <td><select class="input" data-vf="image" data-i="${i}"><option value="">Same as product</option>${images.map((src, k) => `<option value="${esc(src)}" ${v.image === src ? 'selected' : ''}>Photo ${k + 1}</option>`).join('')}</select></td>
        <td><button type="button" class="icon-btn" data-rmv="${i}" aria-label="Remove variant">${ICON.trash}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Add at least one variant so customers can buy this product.</td></tr>';
    };
    const setField = (e) => { const f = e.target.dataset.vf; if (f) variants[Number(e.target.dataset.i)][f] = e.target.value || (f === 'image' ? null : ''); };
    $('#vars').addEventListener('input', setField);
    $('#vars').addEventListener('change', setField);
    $('#vars').addEventListener('click', (e) => { const r = e.target.closest('[data-rmv]'); if (r) { variants.splice(Number(r.dataset.rmv), 1); drawVariants(); } });
    $('#addv').addEventListener('click', () => { variants.push({ label: '', stock: 0 }); drawVariants(); });
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const keep = Object.fromEntries(variants.map((v) => [v.label, v]));
      variants = SIZE_PRESETS[b.dataset.preset].map((label) => keep[label] || { label, stock: 10 });
      drawVariants();
    }));
    drawImages();
    drawVariants();

    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.is_trending = fd.has('is_trending');
      body.is_featured = fd.has('is_featured');
      body.images = images;
      body.variants = variants;
      if (!variants.some((v) => String(v.label).trim())) return toast('Add at least one variant', true);
      try {
        const r = await api(isNew ? '/admin/products' : '/admin/products/' + id, { method: isNew ? 'POST' : 'PUT', body });
        toast('Product saved');
        if (isNew) location.hash = '#/products/' + r.product.id; else route();
      } catch (err) { toast(err.message, true); }
    });
    $('#del')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”? This cannot be undone. Past orders keep their own copy of the item.`)) return;
      await api('/admin/products/' + id, { method: 'DELETE' });
      toast('Product deleted');
      location.hash = '#/products';
    });
  }

  // ---------- Generic CRUD pages ----------
  const imgCell = (v) => v ? `<img class="thumb" src="${esc(v)}" alt="">` : '<div class="thumb"></div>';
  const RESOURCES = {
    collections: {
      title: 'Collections', singular: 'collection',
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'sort', label: 'Sort order', type: 'number' }],
      columns: [['', (r) => imgCell(r.image)], ['Name', (r) => `<b>${esc(r.name)}</b><br><span class="muted">${esc(r.description || '')}</span>`], ['Sort', (r) => r.sort]],
    },
    coupons: {
      title: 'Coupons', singular: 'coupon',
      fields: [
        { name: 'code', label: 'Code', required: true, hint: 'Customers type this at checkout' },
        { name: 'type', label: 'Discount type', type: 'select', options: [['percent', 'Percentage (%)'], ['flat', 'Flat amount (₹)']] },
        { name: 'value', label: 'Value', type: 'number', required: true },
        { name: 'min_order', label: 'Minimum order ₹', type: 'number' },
        { name: 'max_discount', label: 'Max discount ₹', type: 'number', hint: 'For percentage coupons; leave blank for no cap' },
        { name: 'usage_limit', label: 'Usage limit', type: 'number', hint: 'Leave blank for unlimited' },
        { name: 'expires_at', label: 'Expires on', type: 'date' },
        { name: 'active', label: 'Active', type: 'bool', default: true },
      ],
      columns: [['Code', (r) => `<b>${esc(r.code)}</b>`], ['Discount', (r) => r.type === 'percent' ? `${r.value}%${r.max_discount ? ` (max ${money(r.max_discount)})` : ''}` : money(r.value)],
        ['Min order', (r) => r.min_order ? money(r.min_order) : '—'], ['Used', (r) => `${r.used_count}${r.usage_limit ? ' / ' + r.usage_limit : ''}`],
        ['Expires', (r) => r.expires_at ? date(r.expires_at) : 'Never'], ['Status', (r) => {
          const expired = r.expires_at && new Date(r.expires_at + 'T23:59:59') < new Date();
          return `<span class="pill ${r.active && !expired ? 'active' : ''}">${expired ? 'expired' : r.active ? 'active' : 'inactive'}</span>`;
        }]],
    },
    banners: {
      title: 'Home banners', singular: 'banner',
      fields: [{ name: 'kicker', label: 'Small line above the headline', hint: 'e.g. ನವೆಂಬರ್ 1 · Kannada Rajyotsava' }, { name: 'title', label: 'Headline', required: true }, { name: 'subtitle', label: 'Text' },
        { name: 'theme', label: 'Colour theme', type: 'select', options: [['light', 'Light (cream)'], ['karnataka', 'Karnataka (yellow & red)'], ['dark', 'Dark']] },
        { name: 'image', label: 'Photo 1', type: 'image', hint: 'Portrait photos (3:4) look best, e.g. 1200 × 1600' }, { name: 'image_label', label: 'Photo 1 label', hint: 'Optional, e.g. For him' },
        { name: 'image2', label: 'Photo 2 (optional)', type: 'image', hint: 'Add a second photo to show two side by side, e.g. him and her' }, { name: 'image2_label', label: 'Photo 2 label', hint: 'Optional, e.g. For her' },
        { name: 'link', label: 'Button link', hint: 'e.g. /shop?category=hoodies' }, { name: 'button_text', label: 'Button text' },
        { name: 'sort', label: 'Sort order', type: 'number' }, { name: 'active', label: 'Show on home page', type: 'bool', default: true }],
      columns: [['', (r) => `<div style="display:flex;gap:4px">${imgCell(r.image)}${r.image2 ? imgCell(r.image2) : ''}</div>`], ['Banner', (r) => `${r.kicker ? `<span class="muted" style="font-size:12px">${esc(r.kicker)}</span><br>` : ''}<b>${esc(r.title)}</b><br><span class="muted">${esc(r.subtitle || '')}</span>`],
        ['Theme', (r) => esc(r.theme || 'light')], ['Link', (r) => esc(r.link || '—')], ['Sort', (r) => r.sort],
        ['Status', (r) => `<span class="pill ${r.active ? 'active' : ''}">${r.active ? 'live' : 'hidden'}</span>`]],
    },
    testimonials: {
      title: 'Testimonials', singular: 'testimonial',
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'role', label: 'Subtitle', hint: 'e.g. Customer, Mysuru' }, { name: 'text', label: 'Quote', type: 'textarea', required: true },
        { name: 'rating', label: 'Rating', type: 'select', options: [[5, '★★★★★'], [4, '★★★★'], [3, '★★★']] }, { name: 'active', label: 'Show on home page', type: 'bool', default: true }],
      columns: [['Name', (r) => `<b>${esc(r.name)}</b><br><span class="muted">${esc(r.role || '')}</span>`], ['Quote', (r) => esc(r.text.slice(0, 90)) + (r.text.length > 90 ? '…' : '')], ['Rating', (r) => '★'.repeat(r.rating)],
        ['Status', (r) => `<span class="pill ${r.active ? 'active' : ''}">${r.active ? 'live' : 'hidden'}</span>`]],
    },
  };

  for (const [key, cfg] of Object.entries(RESOURCES)) {
    ROUTES[key] = async (view) => {
      const { items } = await api('/admin/' + key);
      view.innerHTML = `<div class="page-title"><h1>${cfg.title}</h1><button class="btn" id="add">+ Add ${cfg.singular}</button></div>
        <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr>${cfg.columns.map(([h]) => `<th>${h}</th>`).join('')}<th></th></tr></thead><tbody>
        ${items.map((r) => `<tr class="link" data-edit="${r.id}">${cfg.columns.map(([, fn]) => `<td>${fn(r)}</td>`).join('')}<td class="r"><button class="icon-btn" data-delete="${r.id}" aria-label="Delete">${ICON.trash}</button></td></tr>`).join('') || `<tr><td colspan="${cfg.columns.length + 1}" class="empty">No ${cfg.title.toLowerCase()} yet</td></tr>`}
        </tbody></table></div></div>`;
      $('#add').addEventListener('click', () => editPanel(key, cfg, null));
      view.querySelector('tbody').addEventListener('click', async (e) => {
        const del = e.target.closest('[data-delete]');
        if (del) {
          e.stopPropagation();
          if (!confirm(`Delete this ${cfg.singular}?`)) return;
          await api(`/admin/${key}/${del.dataset.delete}`, { method: 'DELETE' });
          toast('Deleted'); route(); return;
        }
        const row = e.target.closest('[data-edit]');
        if (row) editPanel(key, cfg, items.find((i) => i.id === Number(row.dataset.edit)));
      });
    };
  }

  function editPanel(key, cfg, item) {
    const val = (f) => item ? item[f.name] ?? '' : f.default ?? '';
    const input = (f) => {
      const v = val(f);
      if (f.type === 'textarea') return `<textarea class="input" name="${f.name}" rows="4" ${f.required ? 'required' : ''}>${esc(v)}</textarea>`;
      if (f.type === 'select') return `<select class="input" name="${f.name}">${f.options.map(([o, l]) => `<option value="${o}" ${String(o) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      if (f.type === 'bool') return `<label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${f.label}</label>`;
      if (f.type === 'image') return `<div style="display:flex;gap:10px;align-items:center"><img class="thumb" data-prev src="${esc(v)}" alt="" style="${v ? '' : 'visibility:hidden'}"><input class="input" name="${f.name}" value="${esc(v)}" placeholder="Image URL"><label class="btn ghost sm">Upload<input type="file" accept="image/*" hidden data-up="${f.name}"></label></div>`;
      return `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
    };
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="drawer-bg"></div><form class="panel"><div class="panel-head"><h2>${item ? 'Edit' : 'Add'} ${cfg.singular}</h2><button type="button" class="icon-btn" data-x aria-label="Close">${ICON.close}</button></div>
      <div class="panel-body">${cfg.fields.map((f) => f.type === 'bool' ? `<div class="field">${input(f)}</div>` : `<div class="field"><label>${f.label}</label>${input(f)}${f.hint ? `<span class="hint">${f.hint}</span>` : ''}</div>`).join('')}</div>
      <div class="panel-foot"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn">Save</button></div></form>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $$('[data-x]', wrap).forEach((b) => b.addEventListener('click', close));
    $('.drawer-bg', wrap).addEventListener('click', close);
    $$('[data-up]', wrap).forEach((inp) => inp.addEventListener('change', async () => {
      try {
        const [url] = await upload(inp.files);
        const field = $(`[name="${inp.dataset.up}"]`, wrap);
        field.value = url;
        const prev = $('[data-prev]', field.parentElement); prev.src = url; prev.style.visibility = '';
      } catch (e) { toast(e.message, true); }
    }));
    $('form', wrap).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      for (const f of cfg.fields) if (f.type === 'bool') body[f.name] = fd.has(f.name);
      try {
        await api(`/admin/${key}${item ? '/' + item.id : ''}`, { method: item ? 'PUT' : 'POST', body });
        toast('Saved'); close(); route();
      } catch (err) { toast(err.message, true); }
    });
    $('input, textarea', wrap)?.focus();
  }

  // ---------- Reviews ----------
  ROUTES.reviews = async (view) => {
    const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
    const { reviews, pending } = await api('/admin/reviews?status=' + status);
    view.innerHTML = `<div class="page-title"><h1>Product reviews</h1>
        <div class="seg">${[['', 'All'], ['pending', `Awaiting approval (${pending})`], ['approved', 'Published']].map(([k, l]) => `<button data-st="${k}" class="${k === status ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>Customer</th><th>Status</th><th></th></tr></thead><tbody>
      ${reviews.map((r) => `<tr><td><a href="/product/${esc(r.product_slug)}" target="_blank"><b>${esc(r.product_name)}</b></a><br><span class="muted">${date(r.created_at)}</span></td>
        <td style="color:#c98500;white-space:nowrap" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
        <td style="max-width:380px">${esc(r.text || '—')}</td><td>${esc(r.name)}<br><span class="muted">${esc(r.email || '')}</span></td>
        <td><span class="pill ${r.approved ? 'active' : 'pending'}">${r.approved ? 'published' : 'pending'}</span></td>
        <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-approve="${r.id}" data-to="${r.approved ? 0 : 1}">${r.approved ? 'Hide' : 'Approve'}</button>
          <button class="icon-btn" data-del="${r.id}" aria-label="Delete">${ICON.trash}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No reviews here</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-st]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/reviews?status=' + b.dataset.st; }));
    view.querySelector('tbody').addEventListener('click', async (e) => {
      const a = e.target.closest('[data-approve]');
      if (a) { await api('/admin/reviews/' + a.dataset.approve, { method: 'PUT', body: { approved: a.dataset.to === '1' } }); toast(a.dataset.to === '1' ? 'Review published' : 'Review hidden'); route(); }
      const d = e.target.closest('[data-del]');
      if (d && confirm('Delete this review?')) { await api('/admin/reviews/' + d.dataset.del, { method: 'DELETE' }); toast('Review deleted'); route(); }
    });
  };

  // ---------- Customers & subscribers ----------
  ROUTES.customers = async (view) => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
    const { customers } = await api('/admin/customers?q=' + encodeURIComponent(q));
    view.innerHTML = `<div class="page-title"><h1>Customers <span class="muted" style="font-weight:500">(${customers.length})</span></h1><button class="btn ghost" id="csv">Export CSV</button></div>
      <div class="filters"><input class="input" id="q" placeholder="Search name, email, phone" value="${esc(q)}"></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th class="r">Orders</th><th class="r">Total spent</th></tr></thead><tbody>
      ${customers.map((c) => `<tr class="link" data-href="#/orders?q=${encodeURIComponent(c.email)}"><td><b>${esc(c.name)}</b></td><td>${esc(c.email)}</td><td>${esc(c.phone || '—')}</td><td>${date(c.created_at)}</td><td class="r num">${c.orders}</td><td class="r num">${money(c.spent)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No customers yet</td></tr>'}
      </tbody></table></div></div>`;
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = '#/customers?q=' + encodeURIComponent(e.target.value.trim()); });
    $('#csv').addEventListener('click', () => downloadCsv('customers.csv', customers, ['name', 'email', 'phone', 'created_at', 'orders', 'spent']));
  };

  ROUTES.subscribers = async (view) => {
    const { subscribers } = await api('/admin/subscribers');
    view.innerHTML = `<div class="page-title"><h1>Newsletter subscribers <span class="muted" style="font-weight:500">(${subscribers.length})</span></h1><button class="btn ghost" id="csv">Export CSV</button></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Email</th><th>Subscribed on</th></tr></thead><tbody>
      ${subscribers.map((s) => `<tr><td>${esc(s.email)}</td><td>${date(s.created_at, true)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No subscribers yet</td></tr>'}</tbody></table></div></div>`;
    $('#csv').addEventListener('click', () => downloadCsv('subscribers.csv', subscribers, ['email', 'created_at']));
  };

  // ---------- Integrations ----------
  ROUTES.integrations = async (view) => {
    const [{ settings: s }, info] = await Promise.all([api('/admin/settings'), api('/admin/integrations')]);
    const st = info.status;
    const on = (k, label = 'connected') => `<span class="pill ${st[k] ? 'active' : 'warn'}">${st[k] ? label : 'not set up'}</span>`;
    const f = (name, label, hint, type = 'text', ph = '') => `<div class="field"><label for="i-${name}">${label}</label><input class="input" id="i-${name}" name="${name}" type="${type}" value="${esc(s[name])}" placeholder="${esc(ph)}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const secret = (name, label, hint) => `<div class="field"><label for="i-${name}">${label}</label>
      <input class="input" id="i-${name}" name="${name}" type="password" autocomplete="off" placeholder="${s.secrets_set[name] ? '•••••••• saved — type to replace' : 'Not set'}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const toggle = (name, label) => `<label class="check" style="margin-bottom:12px"><input type="checkbox" name="${name}" ${s[name] === '1' ? 'checked' : ''}> ${label}</label>`;
    const vars = (ev) => info.variables[ev].map((v, i) => `<code>{{${i + 1}}}</code> ${esc(v)}`).join(' · ');
    const EVENTS = [['order', 'Order placed'], ['shipped', 'Order shipped'], ['delivered', 'Order delivered'], ['cancelled', 'Order cancelled']];
    const steps = (items) => `<details style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600">How to set this up</summary><ol style="padding-left:18px;color:var(--text-2)">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join('')}</ol></details>`;

    view.innerHTML = `<div class="page-title"><h1>Integrations</h1></div>
      <div class="card" style="margin-bottom:16px"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${[['razorpay', 'Razorpay payments', '#/settings'], ['email', 'Order emails', '#/settings'], ['gst', 'GST invoices', '#gst'], ['shiprocket', 'Shiprocket', '#sr'], ['whatsapp', 'WhatsApp', '#wa'], ['sms', 'SMS', '#sms']]
          .map(([k, l, href]) => `<a href="${href}" data-jump="${href}" class="list-row" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px"><span class="grow"><b>${l}</b></span>${on(k, k === 'gst' ? 'on' : 'connected')}</a>`).join('')}
      </div></div>
      <form id="intf">
      <div class="card" id="gst"><div class="card-head"><h2>GST invoices</h2>${on('gst', 'on')}</div>
        <p class="muted" style="margin-top:0">A printable tax invoice (save as PDF from the print window) is created for every order when it ships. Customers can open theirs from the tracking page. Prices in the store include GST; the invoice works out the taxable value and splits CGST + SGST (same state) or IGST (other states).</p>
        ${toggle('gst_enabled', 'Issue GST tax invoices')}
        <div class="form-grid">${f('gst_rate', 'Default GST rate %', 'Used when a product has no rate of its own. Check the current rate for your products with your CA.', 'number')}${f('hsn_default', 'Default HSN code', 'e.g. 6109 for T-shirts. Products can override it.')}</div>
        <div class="form-grid">${f('business_state', 'Your registered state', 'Decides CGST+SGST vs IGST')}${f('invoice_prefix', 'Invoice number prefix', 'Numbers look like INV/2026-27/0001')}</div>
        <p class="muted" style="margin:0">Your GSTIN and business name are set in <a href="#/settings" style="text-decoration:underline">Settings → Business details</a>${s.gstin ? ` (GSTIN ${esc(s.gstin)})` : ' — <b>add your GSTIN there to turn on tax invoices</b>'}. Without GST, a plain invoice is still available.</p>
      </div>

      <div class="card" id="sr"><div class="card-head"><h2>Shiprocket</h2>${on('shiprocket')}</div>
        <p class="muted" style="margin-top:0">Book a courier with one click from any order: the shipment is created, the recommended courier assigned, pickup scheduled and the label generated. Tracking updates move orders to Delivered automatically and notify the customer.</p>
        ${steps([
          'Sign up at <a href="https://www.shiprocket.in" target="_blank" rel="noopener" style="text-decoration:underline">shiprocket.in</a>, complete KYC and recharge your wallet.',
          'In Shiprocket → Settings → Pickup Addresses, add your warehouse. Copy its <b>nickname</b> into "Pickup location" below.',
          'In Shiprocket → Settings → API → <b>Configure</b>, create an API user (use a different email from your login). Paste its email and password below.',
          `In Shiprocket → Settings → API → Webhooks, add the URL <code>${esc(info.webhooks.shiprocket)}</code> with token <code>${esc(info.webhooks.shiprocket_token)}</code>.`,
          'Save, then click <b>Test connection</b>.'])}
        <div class="form-grid">${f('shiprocket_email', 'API user email', '', 'email')}${secret('shiprocket_password', 'API user password')}</div>
        ${f('shiprocket_pickup', 'Pickup location nickname', 'Exactly as named in Shiprocket, e.g. Primary')}
        <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">${f('pkg_weight', 'Weight per item (kg)', '', 'number')}${f('pkg_length', 'Length (cm)', '', 'number')}${f('pkg_breadth', 'Breadth (cm)', '', 'number')}${f('pkg_height', 'Height (cm)', '', 'number')}</div>
        <button type="button" class="btn ghost sm" data-test="shiprocket">Test connection</button>
      </div>

      <div class="card" id="wa"><div class="card-head"><h2>WhatsApp (Meta Cloud API)</h2>${on('whatsapp')}</div>
        <p class="muted" style="margin-top:0">Sends order updates to customers on WhatsApp, and new-order alerts to you. Uses the official WhatsApp Business Platform; messages must use templates approved by Meta.</p>
        ${steps([
          'Go to <a href="https://developers.facebook.com" target="_blank" rel="noopener" style="text-decoration:underline">developers.facebook.com</a> → Create app → Business → add the <b>WhatsApp</b> product, and connect your business phone number.',
          'Copy the <b>Phone number ID</b>. Create a <b>System User</b> in Business Settings with a permanent access token (permission: whatsapp_business_messaging) and paste it below.',
          'In WhatsApp Manager → Message templates, create a <b>Utility</b> template for each event, using the variables in the order listed below. Paste the template names here.',
          'Save, tick "Send WhatsApp messages", and send yourself a test.'])}
        ${toggle('whatsapp_enabled', 'Send WhatsApp messages')}
        <div class="form-grid">${f('whatsapp_phone_id', 'Phone number ID')}${f('whatsapp_lang', 'Template language code', 'e.g. en, en_US, kn')}</div>
        ${secret('whatsapp_token', 'Permanent access token')}
        ${EVENTS.map(([k, l]) => f(`wa_tpl_${k}`, `${l} — template name`, `Variables: ${vars(k)}`, 'text', 'Leave empty to skip')).join('')}
        ${f('wa_tpl_admin', 'New-order alert to you — template name', `Variables: ${vars('admin')}`, 'text', 'Leave empty to skip')}
        ${f('wa_admin_numbers', 'Your WhatsApp numbers for alerts', 'Comma-separated, e.g. 9876543210, 9123456789')}
        <details style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:600">Suggested template wording</summary><div style="color:var(--text-2);font-size:13px">
          <p><b>Order placed:</b> Hi {{1}}, thank you for shopping with ${esc(s.store_name)}! Your order #{{2}} of {{3}} is confirmed. Track it here: {{4}}</p>
          <p><b>Shipped:</b> Hi {{1}}, your order #{{2}} is on its way with {{3}} (AWB {{4}}). Track it here: {{5}}</p>
          <p><b>Delivered:</b> Hi {{1}}, your order #{{2}} has been delivered. We hope you love it!</p>
          <p><b>Cancelled:</b> Hi {{1}}, your order #{{2}} has been cancelled. Any prepaid amount will be refunded in 5–7 business days.</p>
          <p><b>Alert to you:</b> New order #{{1}} for {{2}} from {{3}} ({{4}}).</p></div></details>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="wa-to" placeholder="Your mobile number" style="width:200px"><select class="input" id="wa-ev" style="width:auto">${EVENTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="admin">New-order alert</option></select><button type="button" class="btn ghost sm" data-test="whatsapp">Send test</button></div>
      </div>

      <div class="card" id="sms"><div class="card-head"><h2>SMS (MSG91)</h2>${on('sms')}</div>
        <p class="muted" style="margin-top:0">Sends order updates by SMS. In India every SMS template must be registered on the DLT portal; MSG91 helps with this.</p>
        ${steps([
          'Sign up at <a href="https://msg91.com" target="_blank" rel="noopener" style="text-decoration:underline">msg91.com</a> and complete DLT registration (entity, sender ID, and a template for each message below).',
          'In MSG91 → SMS → <b>Flows</b>, create a flow per message using variables <code>##var1##</code>, <code>##var2##</code> … in the order listed below. Copy each flow\'s <b>template ID</b>.',
          'Copy your <b>Auth key</b> from MSG91 → API. Paste everything below, tick "Send SMS", save and test.'])}
        ${toggle('sms_enabled', 'Send SMS')}
        ${secret('msg91_authkey', 'MSG91 auth key')}
        ${EVENTS.map(([k, l]) => f(`msg91_tpl_${k}`, `${l} — flow template ID`, `Variables: ${info.variables[k].map((v, i) => `<code>var${i + 1}</code> ${esc(v)}`).join(' · ')}`, 'text', 'Leave empty to skip')).join('')}
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="sms-to" placeholder="Your mobile number" style="width:200px"><select class="input" id="sms-ev" style="width:auto">${EVENTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-test="sms">Send test</button></div>
      </div>
      <div style="position:sticky;bottom:0;padding:12px 0;background:var(--bg)"><button class="btn">Save integrations</button> <span class="muted">Save before testing.</span></div>
      </form>

      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Recent WhatsApp & SMS messages</h2></div>
        ${info.recent.length ? info.recent.map((n) => `<div class="list-row"><span class="pill ${n.ok ? 'good' : 'bad'}" style="text-transform:none">${n.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</span><span class="grow">${esc(n.event)} · #${esc(n.order_no || '—')} → ${esc(n.recipient || '')}${n.ok ? '' : ` — <span style="color:var(--bad)">${esc(n.detail)}</span>`}</span><span class="muted">${date(n.created_at, true)}</span></div>`).join('') : '<p class="muted" style="margin:0">Nothing sent yet.</p>'}
      </div>`;

    $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
      const h = a.dataset.jump;
      if (h.startsWith('#') && !h.startsWith('#/')) { e.preventDefault(); $(h).scrollIntoView({ behavior: 'smooth' }); }
    }));
    $('#intf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      for (const k of ['gst_enabled', 'whatsapp_enabled', 'sms_enabled']) body[k] = fd.has(k) ? '1' : '0';
      try { await api('/admin/settings', { method: 'PUT', body }); toast('Integrations saved'); route(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      const channel = b.dataset.test;
      const body = { channel };
      if (channel === 'whatsapp') Object.assign(body, { to: $('#wa-to').value.trim(), event: $('#wa-ev').value });
      if (channel === 'sms') Object.assign(body, { to: $('#sms-to').value.trim(), event: $('#sms-ev').value });
      b.disabled = true;
      try { toast((await api('/admin/integrations/test', { body })).message); } catch (err) { toast(err.message, true); }
      b.disabled = false;
    }));
  };

  // ---------- Policy pages ----------
  ROUTES.pages = async (view, slug) => {
    const { pages } = await api('/admin/pages');
    if (!slug) {
      view.innerHTML = `<div class="page-title"><h1>Policy pages</h1></div>
        <div class="card" style="margin-bottom:16px"><p style="margin:0">These pages are linked from the footer and checkout. Payment providers like Razorpay check for them before activating your account.
          They start from a template — <b>read each one, adjust it to how your business really works, and have it reviewed by a lawyer or CA</b>.
          Text like <code>{email}</code> is filled in from Settings automatically.</p></div>
        <div class="card" style="padding:0"><table><thead><tr><th>Page</th><th>Address</th><th>Last updated</th><th></th></tr></thead><tbody>
        ${pages.map((p) => `<tr class="link" data-href="#/pages/${esc(p.slug)}"><td><b>${esc(p.title)}</b></td><td class="muted">/pages/${esc(p.slug)}</td><td>${date(p.updated_at)}</td><td class="r"><a class="btn ghost sm" href="/pages/${esc(p.slug)}" target="_blank" data-stop>View ↗</a></td></tr>`).join('')}
        </tbody></table></div>`;
      return;
    }
    const page = pages.find((p) => p.slug === slug);
    if (!page) throw new Error('Page not found');
    view.innerHTML = `<form id="pgf"><div class="page-title"><div><a class="muted" href="#/pages">← Policy pages</a><h1>${esc(page.title)}</h1></div>
        <div style="display:flex;gap:8px"><a class="btn ghost" href="/pages/${esc(page.slug)}" target="_blank">View ↗</a><button class="btn">Save page</button></div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
        <div class="card"><div class="field"><label for="pt">Title</label><input class="input" id="pt" name="title" value="${esc(page.title)}" required></div>
          <div class="field"><label for="pb">Content</label><textarea class="input" id="pb" name="body" rows="28" style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(page.body)}</textarea>
          <span class="hint">Start a line with <code>## </code> for a heading and <code>- </code> for a bullet point. Leave a blank line between paragraphs.
          Placeholders: <code>{store_name}</code> <code>{business_name}</code> <code>{email}</code> <code>{phone}</code> <code>{address}</code> <code>{gstin}</code> <code>{grievance_officer}</code> <code>{jurisdiction}</code> <code>{shipping_fee}</code> <code>{free_shipping_above}</code></span></div></div>
        <div class="card"><div class="card-head"><h2>Preview</h2></div><div id="pv" class="policy-preview"></div></div>
      </div></form>`;
    let t;
    const preview = async () => { $('#pv').innerHTML = (await api('/admin/pages/preview', { body: { body: $('#pb').value } })).html; };
    $('#pb').addEventListener('input', () => { clearTimeout(t); t = setTimeout(preview, 300); });
    preview();
    $('#pgf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/admin/pages/' + slug, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Page saved'); } catch (err) { toast(err.message, true); }
    });
  };

  // ---------- Settings ----------
  ROUTES.settings = async (view) => {
    const { settings: s } = await api('/admin/settings');
    const secret = (name, label, hint) => `<div class="field"><label for="s-${name}">${label}</label>
      <input class="input" id="s-${name}" name="${name}" type="password" autocomplete="off" placeholder="${s.secrets_set[name] ? '•••••••• saved — type to replace' : 'Not set'}">
      ${s.secrets_set[name] ? `<label class="check" style="font-weight:400;font-size:13px"><input type="checkbox" name="clear_${name}"> Remove saved value</label>` : ''}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const f = (name, label, hint, type = 'text') => `<div class="field"><label for="s-${name}">${label}</label><input class="input" id="s-${name}" name="${name}" type="${type}" value="${esc(s[name])}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    view.innerHTML = `<div class="page-title"><h1>Settings</h1></div>
      <div class="edit-layout"><form id="sf"><div class="card"><h2 style="margin-bottom:14px">Store</h2>
          ${f('store_name', 'Store name')}${f('tagline', 'Tagline', 'Shown in the footer and in Google search results')}${f('announcement', 'Announcement bar', 'Leave empty to hide the bar')}
          <div class="field"><label for="s-logo">Logo</label><div style="display:flex;gap:10px;align-items:center">
            <img class="thumb" id="logo-prev" src="${esc(s.logo)}" alt="" style="width:auto;max-width:120px;${s.logo ? '' : 'visibility:hidden'}">
            <input class="input" id="s-logo" name="logo" value="${esc(s.logo)}" placeholder="Leave empty to show the store name">
            <label class="btn ghost sm">Upload<input type="file" accept="image/png,image/jpeg,image/webp" hidden id="logo-file"></label></div>
            <span class="hint">PNG with a transparent background works best, about 400 × 120 px. Also used when your site is shared on WhatsApp or social media.</span></div></div>
        <div class="card"><h2 style="margin-bottom:6px">Business details</h2><p class="muted" style="margin-top:0">Shown on your Contact and policy pages.</p>
          <div class="form-grid">${f('business_name', 'Registered business name', 'Defaults to the store name')}${f('gstin', 'GSTIN', 'Leave empty if not registered')}</div>
          <div class="form-grid">${f('grievance_officer', 'Grievance officer name', 'Required for Indian e-commerce sites')}${f('jurisdiction', 'Courts / jurisdiction', 'City for legal disputes, e.g. Bengaluru, Karnataka')}</div></div>
        <div class="card"><h2 style="margin-bottom:14px">Contact</h2><div class="form-grid">${f('phone', 'Phone')}${f('email', 'Email', '', 'email')}</div>
          ${f('whatsapp', 'WhatsApp number', 'Country code + number, digits only (e.g. 919876543210). Leave empty to hide the chat button.')}${f('address', 'Address')}</div>
        <div class="card"><h2 style="margin-bottom:14px">Shipping & payments</h2><div class="form-grid">${f('shipping_fee', 'Shipping fee ₹', '', 'number')}${f('free_shipping_above', 'Free shipping above ₹', 'Set 0 to always charge shipping', 'number')}</div>
          <label class="check"><input type="checkbox" name="cod_enabled" ${s.cod_enabled === '1' ? 'checked' : ''}> Cash on delivery</label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="online_enabled" ${s.online_enabled === '1' ? 'checked' : ''}> Online payment <span class="muted">(demo — connect a gateway before going live)</span></label></div>
        <div class="card"><div class="card-head" style="margin-bottom:6px"><h2>Razorpay (online payments)</h2>
            <span class="pill ${s.razorpay_key_id && s.secrets_set.razorpay_key_secret ? 'active' : 'warn'}">${s.razorpay_key_id && s.secrets_set.razorpay_key_secret ? 'connected' : 'demo mode'}</span></div>
          <p class="muted" style="margin-top:0">Find your keys in the Razorpay Dashboard → Account & Settings → API Keys. Use test keys (rzp_test_…) until you're ready to take real money.</p>
          ${f('razorpay_key_id', 'Key ID', '', 'text')}
          ${secret('razorpay_key_secret', 'Key secret')}
          ${secret('razorpay_webhook_secret', 'Webhook secret', `Recommended. Add a webhook at <b>${location.origin}/api/razorpay/webhook</b> for the events <b>payment.captured</b> and <b>order.paid</b>, using this secret.`)}</div>
        <div class="card"><div class="card-head" style="margin-bottom:6px"><h2>Order emails (SMTP)</h2>
            <span class="pill ${s.smtp_host ? 'active' : 'warn'}">${s.smtp_host ? 'on' : 'off'}</span></div>
          <p class="muted" style="margin-top:0">Sends order confirmations and shipping updates to customers, and new-order alerts to your store email. Works with Gmail (an App Password), Zoho, Brevo, Amazon SES and others.</p>
          <div class="form-grid">${f('smtp_host', 'SMTP host', 'e.g. smtp.gmail.com')}${f('smtp_port', 'Port', '587 (STARTTLS) or 465 (SSL)', 'number')}</div>
          <div class="form-grid">${f('smtp_user', 'Username')}${secret('smtp_pass', 'Password')}</div>
          ${f('mail_from', 'From address', `e.g. ${esc(s.store_name)} &lt;orders@yourdomain.com&gt;. Defaults to the username.`)}
          <button type="button" class="btn ghost sm" id="test-mail">Send a test email to ${esc(me.email)}</button></div>
        <div class="card"><h2 style="margin-bottom:14px">Social links</h2>${f('instagram', 'Instagram URL')}${f('facebook', 'Facebook URL')}${f('youtube', 'YouTube URL')}</div>
        <div style="margin-top:16px"><button class="btn">Save settings</button></div></form>
      <form class="card" id="pw"><h2 style="margin-bottom:14px">Change admin password</h2>
        <div class="field"><label>Current password</label><input class="input" type="password" name="current" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="next" minlength="8" required autocomplete="new-password"><span class="hint">At least 8 characters</span></div>
        <button class="btn">Update password</button></form></div>`;
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.cod_enabled = fd.has('cod_enabled') ? '1' : '0';
      body.online_enabled = fd.has('online_enabled') ? '1' : '0';
      for (const k of Object.keys(s.secrets_set)) body[`clear_${k}`] = fd.has(`clear_${k}`);
      try { settings = (await api('/admin/settings', { method: 'PUT', body })).settings; toast('Settings saved'); route(); } catch (err) { toast(err.message, true); }
    });
    $('#logo-file').addEventListener('change', async (e) => {
      try {
        const [url] = await upload(e.target.files);
        $('#s-logo').value = url; $('#logo-prev').src = url; $('#logo-prev').style.visibility = '';
        toast('Logo uploaded — click Save settings to apply it');
      } catch (err) { toast(err.message, true); }
    });
    $('#test-mail').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api('/admin/settings/test-email', { body: {} }); toast('Test email sent — check your inbox'); } catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    });
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/admin/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password updated'); } catch (err) { toast(err.message, true); }
    });
  };

  // Row links
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button')) location.hash = row.dataset.href;
  });

  async function boot() {
    const r = await api('/me');
    me = r.user && r.user.role === 'admin' ? r.user : null;
    if (!me) return renderLogin();
    settings = (await api('/store')).settings;
    renderShell();
    route();
  }
  window.addEventListener('hashchange', route);
  boot();
})();

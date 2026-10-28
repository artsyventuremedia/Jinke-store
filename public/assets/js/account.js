(async function () {
  const { $, $$, esc, money, api, toast, productCard, state: st, ready } = Store;
  await ready;
  const main = $('#main');
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  if (!st.user) return renderAuth('login');
  if (st.user.role === 'admin' && !safeNext) {
    main.innerHTML = `<div class="wrap success"><h1>Hi ${esc(st.user.name)}</h1><p class="muted">You're logged in as an administrator.</p><a class="btn btn-brand" href="/admin">Open admin dashboard</a> <button class="btn btn-outline" id="lo">Log out</button></div>`;
    $('#lo').addEventListener('click', logout);
    return;
  }
  renderAccount();

  function renderAuth(mode) {
    main.innerHTML = `<div class="wrap auth-box"><div class="panel">
      <div class="tabs"><button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Log in</button><button class="${mode === 'register' ? 'on' : ''}" data-mode="register">Create account</button></div>
      <form id="auth">
        ${mode === 'register' ? '<div class="field"><label for="n">Full name</label><input class="input" id="n" name="name" required autocomplete="name"></div>' : ''}
        <div class="field"><label for="e">Email</label><input class="input" id="e" name="email" type="email" required autocomplete="email"></div>
        ${mode === 'register' ? '<div class="field"><label for="p2">Mobile (optional)</label><input class="input" id="p2" name="phone" inputmode="tel" autocomplete="tel"></div>' : ''}
        <div class="field"><label for="pw">Password</label><input class="input" id="pw" name="password" type="password" required minlength="${mode === 'login' ? 1 : 8}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
        ${mode === 'login' ? '<p style="text-align:right;margin:-6px 0 14px;font-size:13px"><a href="/reset" style="text-decoration:underline">Forgot password?</a></p>' : ''}
        <button class="btn btn-brand btn-block">${mode === 'login' ? 'Log in' : 'Create account'}</button>
        ${mode === 'register' ? '<p class="muted" style="font-size:12px;margin-bottom:0">By creating an account you agree to our <a href="/pages/terms" style="text-decoration:underline">Terms</a> and <a href="/pages/privacy-policy" style="text-decoration:underline">Privacy Policy</a>.</p>' : ''}
      </form>
      <p class="muted" style="font-size:13px;text-align:center;margin-bottom:0">Just want to check an order? <a href="/track" style="text-decoration:underline">Track without logging in</a></p>
    </div></div>`;
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
    $('#auth').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api(mode === 'login' ? '/auth/login' : '/auth/register', { body: Object.fromEntries(new FormData(e.target)) });
        location.href = safeNext || (r.role === 'admin' ? '/admin' : '/account');
      } catch (err) { toast(err.message, true); }
    });
  }

  async function logout() {
    await api('/auth/logout', { body: {} });
    location.href = '/';
  }

  function renderAccount() {
    main.innerHTML = `<div class="page-head"><div class="wrap"><h1>Namaskara, ${esc(st.user.name.split(' ')[0])}!</h1><p class="muted" style="margin:4px 0 0">${esc(st.user.email)}</p></div></div>
      <div class="wrap" style="padding-top:24px">
        <div class="tabs"><button data-tab="orders">My orders</button><button data-tab="wishlist">Wishlist</button><button data-tab="profile">Profile</button><button id="lo">Log out</button></div>
        <div id="tab"></div>
      </div>`;
    $('#lo').addEventListener('click', logout);
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab; }));
    window.addEventListener('hashchange', show);
    show();
  }

  function show() {
    const tab = ['orders', 'wishlist', 'profile'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'orders';
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ({ orders, wishlist, profile })[tab]();
  }

  async function orders() {
    const el = $('#tab');
    el.innerHTML = '<div class="skeleton" style="height:140px"></div>';
    const { orders: list } = await api('/me/orders');
    el.innerHTML = list.length ? list.map((o) => `<div class="order-card">
      <div class="top"><div><b>#${esc(o.order_no)}</b> <span class="pill ${esc(o.status)}">${esc(o.status)}</span><br><span class="muted" style="font-size:13px">${new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { dateStyle: 'medium' })} · ${o.items.length} item${o.items.length === 1 ? '' : 's'}</span></div>
      <div style="text-align:right"><b>${money(o.total)}</b><br><a class="link-btn" href="/track?order=${encodeURIComponent(o.order_no)}&phone=${encodeURIComponent(o.phone)}">Track order</a>${o.invoice_url ? ` · <a class="link-btn" href="${esc(o.invoice_url)}" target="_blank">Invoice</a>` : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${o.items.map((i) => `<img src="${esc(i.image || '')}" alt="${esc(i.name)}" title="${esc(i.name)} (${esc(i.size)}) × ${i.qty}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;background:var(--bg-soft)">`).join('')}</div>
    </div>`).join('') : '<div class="empty"><h3>No orders yet</h3><p>When you place an order it will show up here.</p><a class="btn" href="/shop">Start shopping</a></div>';
  }

  async function wishlist() {
    const el = $('#tab');
    el.innerHTML = '<div class="skeleton" style="height:140px"></div>';
    const { products } = await api('/me/wishlist');
    el.innerHTML = products.length ? `<div class="products">${products.map(productCard).join('')}</div>` : '<div class="empty"><h3>Your wishlist is empty</h3><p>Tap the heart on any product to save it here.</p></div>';
  }

  function profile() {
    const el = $('#tab');
    el.innerHTML = `<form class="panel" id="pf" style="max-width:520px">
      <div class="field"><label for="pn">Full name</label><input class="input" id="pn" name="name" value="${esc(st.user.name)}" required></div>
      <div class="field"><label for="pp">Mobile</label><input class="input" id="pp" name="phone" value="${esc(st.user.phone || '')}"></div>
      <div class="field"><label for="pw">New password <span class="muted">(leave blank to keep)</span></label><input class="input" id="pw" name="password" type="password" minlength="8" autocomplete="new-password"></div>
      <button class="btn">Save changes</button></form>`;
    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(e.target));
        await api('/me', { method: 'PUT', body });
        Object.assign(st.user, { name: body.name, phone: body.phone });
        e.target.password.value = '';
        toast('Profile updated');
      } catch (err) { toast(err.message, true); }
    });
  }
})();

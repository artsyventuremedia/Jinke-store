(async function () {
  const { $, esc, money, api, cart, toast, ready } = Store;
  const st = await ready;
  const main = $('#main');
  if (!cart.items().length) { location.href = '/cart'; return; }

  const STATES = ['Karnataka', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Kerala', 'Ladakh', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
  const saved = (() => { try { return JSON.parse(localStorage.getItem('jinke_address')) || {}; } catch { return {}; } })();
  const u = st.user || {};
  const v = (k) => esc(saved[k] || u[k] || '');
  const s = st.settings;

  main.innerHTML = `<div class="page-head"><div class="wrap"><div class="crumbs"><a href="/cart">Cart</a> / Checkout</div><h1>Checkout</h1></div></div>
    <form class="wrap two-col" id="form" novalidate>
      <div>
        ${st.user ? `<p class="muted">Logged in as <b>${esc(u.email)}</b></p>` : '<p class="muted">Have an account? <a href="/account?next=/checkout" style="text-decoration:underline">Log in</a> for faster checkout and order history.</p>'}
        <div class="panel"><h3>Contact</h3>
          <div class="grid-2"><div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" required autocomplete="name" value="${v('name')}"></div>
          <div class="field"><label for="phone">Mobile number</label><input class="input" id="phone" name="phone" required inputmode="tel" autocomplete="tel" value="${v('phone')}"></div></div>
          <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" required autocomplete="email" value="${v('email')}"></div>
        </div>
        <div class="panel" style="margin-top:18px"><h3>Shipping address</h3>
          <div class="field"><label for="address">Address (house no, street, area)</label><textarea class="input" id="address" name="address" rows="2" required autocomplete="street-address">${v('address')}</textarea></div>
          <div class="grid-2"><div class="field"><label for="city">City</label><input class="input" id="city" name="city" required autocomplete="address-level2" value="${v('city')}"></div>
          <div class="field"><label for="pincode">Pincode</label><input class="input" id="pincode" name="pincode" required inputmode="numeric" maxlength="6" autocomplete="postal-code" value="${v('pincode')}"></div></div>
          <div class="field"><label for="state">State</label><select class="input" id="state" name="state">${STATES.map((x) => `<option ${x === (saved.state || 'Karnataka') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="notes">Order notes (optional)</label><input class="input" id="notes" name="notes" placeholder="Landmark, delivery instructions…"></div>
          <label class="check-line"><input type="checkbox" id="biz"> I need a GST invoice for my business</label>
          <div class="grid-2 hidden" id="biz-fields" style="margin-top:12px">
            <div class="field"><label for="company">Registered business name</label><input class="input" id="company" name="company" autocomplete="organization"></div>
            <div class="field"><label for="gstin">GSTIN</label><input class="input" id="gstin" name="gstin" maxlength="15" placeholder="29ABCDE1234F1Z5" style="text-transform:uppercase"></div>
          </div>
        </div>
        <div class="panel" style="margin-top:18px"><h3>Payment</h3>
          ${s.cod_enabled === '1' ? `<label class="pay-opt"><input type="radio" name="payment_method" value="cod" checked><div><b>Cash on delivery</b><span>Pay in cash or UPI when your order arrives</span></div></label>` : ''}
          ${s.online_enabled === '1' ? `<label class="pay-opt"><input type="radio" name="payment_method" value="online" ${s.cod_enabled !== '1' ? 'checked' : ''}><div><b>Pay online — UPI / Cards / Netbanking</b><span>${s.payment_mode === 'razorpay' ? 'Secure payment via Razorpay' : 'Demo mode: payment is simulated'}</span></div></label>` : ''}
        </div>
      </div>
      <aside class="panel sticky" id="summary"><div class="skeleton" style="height:200px"></div></aside>
    </form>`;

  let q;
  async function renderSummary() {
    q = await cart.quote();
    if (q.coupon_error && cart.coupon()) { cart.coupon(''); q = await cart.quote(); }
    if (!q.lines.length) { location.href = '/cart'; return; }
    $('#summary').innerHTML = `<h3>Order summary</h3>
      ${q.lines.map((l) => `<div class="mini-line"><div class="q"><img src="${esc(l.image || '')}" alt=""><i>${l.qty}</i></div><div class="n">${esc(l.name)}<br><span class="muted" style="font-size:12px">${esc(l.size)}</span></div><b>${money(l.line_total)}</b></div>`).join('')}
      ${q.issues.map((i) => `<p style="color:var(--brand);font-size:13px;margin:4px 0">${esc(i.message)}</p>`).join('')}
      <div class="coupon"><input class="input" id="code" placeholder="Coupon code" value="${esc(q.coupon || '')}" aria-label="Coupon code">
        <button type="button" class="btn btn-sm ${q.coupon ? 'btn-outline' : ''}" id="apply">${q.coupon ? 'Remove' : 'Apply'}</button></div>
      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? `<div class="row"><span>Discount (${esc(q.coupon)})</span><span style="color:var(--ok)">−${money(q.discount)}</span></div>` : ''}
        <div class="row"><span>Shipping</span><span>${q.shipping ? money(q.shipping) : 'Free'}</span></div>
        <div class="row grand"><span>Total</span><span>${money(q.total)}</span></div>
        ${q.gst != null ? `<div class="row gst-row"><span>Includes GST</span><span>${Store.money2(q.gst)}</span></div>` : ''}
      </div>
      <button class="btn btn-brand btn-block" style="margin-top:16px" id="place" ${q.issues.length ? 'disabled' : ''}>Place order · ${money(q.total)}</button>
      <p class="muted" style="font-size:12px;text-align:center;margin-bottom:0">By placing this order you agree to our <a href="/pages/terms" target="_blank" style="text-decoration:underline">Terms</a>, <a href="/pages/refund-policy" target="_blank" style="text-decoration:underline">Refund Policy</a> and <a href="/pages/privacy-policy" target="_blank" style="text-decoration:underline">Privacy Policy</a>.</p>`;
    $('#apply').addEventListener('click', async () => {
      if (q.coupon) { cart.coupon(''); return renderSummary(); }
      const code = $('#code').value.trim();
      if (!code) return;
      cart.coupon(code);
      const r = await cart.quote();
      if (r.coupon_error) { cart.coupon(''); toast(r.coupon_error, true); } else toast(`Coupon applied — you saved ${money(r.discount)}`);
      renderSummary();
    });
  }
  renderSummary();
  $('#biz').addEventListener('change', (e) => $('#biz-fields').classList.toggle('hidden', !e.target.checked));

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    if (!$('#biz').checked) { delete data.company; delete data.gstin; }
    else if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(data.gstin).trim().toUpperCase())) { $('#gstin').focus(); toast('Enter a valid 15-character GSTIN', true); return; }
    else if (!String(data.company).trim()) { $('#company').focus(); toast('Enter the registered business name', true); return; }
    for (const el of form.querySelectorAll('[required]')) {
      if (!el.value.trim()) { el.focus(); toast(`Please fill in ${el.labels[0]?.textContent.toLowerCase() || el.name}`, true); return; }
    }
    if (!/^\d{6}$/.test(data.pincode)) { $('#pincode').focus(); toast('Pincode must be 6 digits', true); return; }
    const btn = $('#place');
    btn.disabled = true; btn.textContent = 'Placing order…';
    try {
      const { notes, payment_method, ...customer } = data;
      try { localStorage.setItem('jinke_address', JSON.stringify(customer)); } catch { /* ignore */ }
      const r = await api('/orders', { body: { items: cart.items(), coupon: cart.coupon(), customer, payment_method, notes } });
      // The order now holds the stock, so the cart is done with even if payment is still to come.
      cart.clear();
      const done = `/order-success?order=${encodeURIComponent(r.order_no)}&phone=${encodeURIComponent(r.phone)}`;
      if (r.razorpay) {
        btn.textContent = 'Waiting for payment…';
        try { await Store.payOnline(r.order_no, r.razorpay); } catch (payErr) { toast(payErr.message, true); }
      }
      location.href = done;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      renderSummary();
    }
  });
})();

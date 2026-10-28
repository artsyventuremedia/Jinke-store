(async function () {
  const { $, $$, esc, api, toast, ICON, ready, topCategories, childrenOf } = Store;
  const st = await ready;
  const s = st.settings;
  const min = parseInt(s.bulk_min_qty, 10) || 25;
  // Product types to choose from: everything directly under each menu heading (Hoodies, Caps, Bottles…), each once.
  const seen = new Set();
  const types = topCategories().flatMap((t) => childrenOf(t.id)).filter((c) => !seen.has(c.id) && seen.add(c.id));

  $('#main').innerHTML = `
    <section class="bulk-hero"><div class="wrap">
      <div><div class="kicker">Teams · Events · Corporate gifting</div>
        <h1>Bulk &amp; custom orders</h1>
        <p>Matching tees for your team, caps and bottles for an event, or Kannada-themed gifts for clients — we print, pack and ship across India.</p>
        <div class="bulk-cta"><a class="btn btn-brand" href="#enquiry">Get a quote</a>
          ${s.whatsapp ? `<a class="btn btn-outline" target="_blank" rel="noopener" href="https://wa.me/${esc(s.whatsapp)}?text=${encodeURIComponent('Hi! I would like a quote for a bulk order.')}">${ICON.wa.replace('<svg', '<svg width="18" height="18"')} WhatsApp us</a>` : ''}</div></div>
      <ul class="bulk-points">
        <li>${ICON.check}<span><b>From ${min} pieces</b>Mix sizes and colours within an order</span></li>
        <li>${ICON.check}<span><b>Your logo or our designs</b>Screen print, DTF or embroidery</span></li>
        <li>${ICON.check}<span><b>Volume pricing</b>The more you order, the less you pay per piece</span></li>
        <li>${ICON.check}<span><b>GST invoice</b>Input tax credit for registered businesses</span></li>
      </ul>
    </div></section>

    <section class="block"><div class="wrap bulk-grid">
      <div>
        <h2>How it works</h2>
        <ol class="steps">
          <li><b>Tell us what you need</b><span>Products, quantity, sizes and your artwork or idea.</span></li>
          <li><b>Get a quote and mock-up</b><span>Usually within one business day.</span></li>
          <li><b>Approve and pay</b><span>50% advance to start production.</span></li>
          <li><b>Delivered to your door</b><span>Typically 7–12 days after approval, anywhere in India.</span></li>
        </ol>
        <p class="muted">Questions? Call <a href="tel:${esc((s.phone || '').replace(/\s/g, ''))}" style="text-decoration:underline">${esc(s.phone)}</a> or email <a href="mailto:${esc(s.email)}" style="text-decoration:underline">${esc(s.email)}</a>.</p>
      </div>
      <form class="panel" id="enquiry" novalidate>
        <h3>Request a quote</h3>
        <div class="grid-2">
          <div class="field"><label for="b-name">Your name *</label><input class="input" id="b-name" name="name" required autocomplete="name"></div>
          <div class="field"><label for="b-company">Company / organisation</label><input class="input" id="b-company" name="company" autocomplete="organization"></div>
          <div class="field"><label for="b-gstin">GSTIN <span class="muted">(for a GST invoice)</span></label><input class="input" id="b-gstin" name="gstin" maxlength="15" placeholder="Optional" style="text-transform:uppercase"></div>
          <div class="field"><label for="b-city0">&nbsp;</label><p class="muted" style="margin:6px 0 0;font-size:13px">Registered businesses can claim input tax credit on our GST invoice.</p></div>
          <div class="field"><label for="b-phone">Mobile *</label><input class="input" id="b-phone" name="phone" required inputmode="tel" autocomplete="tel"></div>
          <div class="field"><label for="b-email">Email *</label><input class="input" id="b-email" name="email" type="email" required autocomplete="email"></div>
        </div>
        <div class="field"><label>What would you like? *</label><div class="chips" id="b-types">
          ${types.map((c) => `<label class="chip"><input type="checkbox" name="products" value="${esc(c.name)}" hidden> ${esc(c.name)}</label>`).join('')}
          <label class="chip"><input type="checkbox" name="products" value="Other" hidden> Other</label></div></div>
        <div class="grid-2">
          <div class="field"><label for="b-qty">Approx. quantity *</label><input class="input" id="b-qty" name="quantity" type="number" min="1" placeholder="e.g. ${min * 2}" required></div>
          <div class="field"><label for="b-date">Needed by</label><input class="input" id="b-date" name="needed_by" type="date"></div>
          <div class="field"><label for="b-cust">Customisation</label><select class="input" id="b-cust" name="customization">
            <option>Print our logo / design</option><option>Use your existing designs</option><option>Need help with design</option><option>Not sure yet</option></select></div>
          <div class="field"><label for="b-city">Delivery city</label><input class="input" id="b-city" name="city" autocomplete="address-level2"></div>
        </div>
        <div class="field"><label for="b-msg">Anything else?</label><textarea class="input" id="b-msg" name="message" rows="3" placeholder="Sizes, colours, occasion, budget…"></textarea></div>
        <button class="btn btn-brand btn-block">Send enquiry</button>
        <p class="muted" style="font-size:12px;margin-bottom:0">We'll only use your details to respond to this enquiry. See our <a href="/pages/privacy-policy" style="text-decoration:underline">Privacy Policy</a>.</p>
      </form>
    </div></section>`;

  $('#b-date').min = new Date().toISOString().slice(0, 10);
  $('#b-types').addEventListener('change', (e) => e.target.closest('.chip')?.classList.toggle('on', e.target.checked));
  $('#enquiry').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = Object.fromEntries(fd);
    body.products = fd.getAll('products');
    for (const el of $$('[required]', form)) {
      if (!el.value.trim()) { el.focus(); return toast(`Please fill in ${el.labels[0].textContent.replace(' *', '').toLowerCase()}`, true); }
    }
    if (!body.products.length) return toast('Choose at least one product type', true);
    const btn = $('button.btn-brand', form);
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/bulk-enquiry', { body });
      form.innerHTML = `<div class="success" style="margin:20px auto"><div class="tick">${ICON.check}</div><h3>Thanks, ${esc(body.name.split(' ')[0])}!</h3>
        <p>We've received your enquiry for about <b>${esc(body.quantity)} pieces</b> and will get back to you within one business day${s.phone ? ` — or call us now at ${esc(s.phone)}` : ''}.</p>
        <a class="btn btn-outline" href="/shop">Browse our designs</a></div>`;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Send enquiry';
    }
  });
})();

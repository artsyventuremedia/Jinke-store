(async function () {
  const { $, esc, money, api, ready } = Store;
  await ready;
  const p = new URLSearchParams(location.search);
  const main = $('#main');
  main.innerHTML = `<div class="page-head"><div class="wrap"><h1>Track your order</h1><p class="muted" style="margin:4px 0 0">Enter your order number and the mobile number used at checkout.</p></div></div>
    <div class="wrap" style="max-width:720px;padding-top:30px">
      <form class="panel" id="f"><div class="grid-2">
        <div class="field"><label for="o">Order number</label><input class="input" id="o" name="order_no" placeholder="e.g. JK2610281234" required value="${esc(p.get('order') || '')}"></div>
        <div class="field"><label for="ph">Mobile number</label><input class="input" id="ph" name="phone" inputmode="tel" required value="${esc(p.get('phone') || '')}"></div>
      </div><button class="btn btn-brand">Track</button></form>
      <div id="out"></div>
    </div>`;

  const FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
  const LABEL = { pending: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned' };
  const fmt = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  async function track(order_no, phone) {
    const out = $('#out');
    out.innerHTML = '<div class="skeleton" style="height:200px;margin-top:20px"></div>';
    try {
      const o = await api(`/track?order_no=${encodeURIComponent(order_no)}&phone=${encodeURIComponent(phone)}`);
      const stopped = ['cancelled', 'returned'].includes(o.status);
      const reached = FLOW.indexOf(o.status);
      const steps = stopped ? [...new Set(o.events.map((e) => e.status))] : FLOW;
      out.innerHTML = `<div class="panel" style="margin-top:20px">
        <div class="order-card" style="border:0;padding:0;margin:0"><div class="top"><div><b>Order #${esc(o.order_no)}</b><br><span class="muted" style="font-size:13px">Placed ${fmt(o.created_at)}</span></div><span class="pill ${esc(o.status)}">${esc(LABEL[o.status] || o.status)}</span></div></div>
        ${o.can_pay ? `<p style="background:var(--bg-soft);padding:12px;border-radius:10px;margin:12px 0">Payment of <b>${money(o.total)}</b> is pending. <button class="btn btn-brand btn-sm" id="pay">Pay now</button></p>` : ''}
        ${o.tracking_no ? `<p style="margin:0">Courier: <b>${esc(o.courier || '—')}</b> · AWB: <b>${esc(o.tracking_no)}</b>${o.tracking_status && o.status === 'shipped' ? `<br><span class="muted">Latest update: ${esc(o.tracking_status)}</span>` : ''}</p>` : ''}
        ${o.invoice_url ? `<p style="margin:8px 0 0"><a href="${esc(o.invoice_url)}" target="_blank" style="text-decoration:underline">Download invoice</a></p>` : ''}
        <ul class="timeline">${steps.map((s, i) => {
          const ev = [...o.events].reverse().find((e) => e.status === s);
          const done = stopped ? true : i <= reached;
          return `<li class="${done ? 'done' : ''}"><span class="dot"></span><b>${esc(LABEL[s] || s)}</b>${ev ? `<small>${fmt(ev.created_at)}${ev.note ? ' · ' + esc(ev.note) : ''}</small>` : ''}</li>`;
        }).join('')}</ul>
        ${o.items.map((i) => `<div class="mini-line"><div class="q"><img src="${esc(i.image || '')}" alt=""><i>${i.qty}</i></div><div class="n">${esc(i.name)}<br><span class="muted" style="font-size:12px">${esc(i.size)}</span></div><b>${money(i.price * i.qty)}</b></div>`).join('')}
        <div class="totals" style="margin-top:10px"><div class="row grand"><span>Total</span><span>${money(o.total)}</span></div></div>
      </div>`;
      $('#pay')?.addEventListener('click', async () => {
        try {
          const r = await api(`/orders/pay?order_no=${encodeURIComponent(o.order_no)}&phone=${encodeURIComponent(phone)}`);
          if (await Store.payOnline(r.order_no, r.razorpay)) track(order_no, phone);
        } catch (err) { Store.toast(err.message, true); }
      });
    } catch (e) {
      out.innerHTML = `<div class="empty"><h3>${esc(e.message)}</h3><p>Check the order number in your confirmation email.</p></div>`;
    }
  }

  $('#f').addEventListener('submit', (e) => { e.preventDefault(); track(e.target.order_no.value.trim(), e.target.phone.value.trim()); });
  if (p.get('order') && p.get('phone')) track(p.get('order'), p.get('phone'));
})();

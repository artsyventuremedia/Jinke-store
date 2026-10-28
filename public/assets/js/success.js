async function retryPayment(orderNo, phone) {
  try {
    const r = await Store.api(`/orders/pay?order_no=${encodeURIComponent(orderNo)}&phone=${encodeURIComponent(phone)}`);
    if (await Store.payOnline(r.order_no, r.razorpay)) location.reload();
  } catch (e) { Store.toast(e.message, true); }
}

(async function () {
  const { $, esc, money, api, ICON, ready } = Store;
  await ready;
  const p = new URLSearchParams(location.search);
  const main = $('#main');
  let o = null;
  try { o = await api(`/track?order_no=${encodeURIComponent(p.get('order') || '')}&phone=${encodeURIComponent(p.get('phone') || '')}`); } catch { /* show generic */ }
  if (o && o.can_pay) {
    main.innerHTML = `<div class="wrap success">
      <h1>Complete your payment</h1>
      <p>Order <b>#${esc(o.order_no)}</b> is reserved for you, but we haven't received the payment of <b>${money(o.total)}</b> yet.
      Unpaid orders are released after 30 minutes.</p>
      <button class="btn btn-brand" id="pay">Pay ${money(o.total)} now</button>
      <p class="muted" style="font-size:13px">Money deducted but seeing this? Don't pay again — refresh in a minute, or contact us with your order number.</p></div>`;
    $('#pay').addEventListener('click', () => retryPayment(o.order_no, p.get('phone')));
    return;
  }
  main.innerHTML = `<div class="wrap success">
    <div class="tick">${ICON.check}</div>
    <h1>Thank you for your order!</h1>
    ${o ? `<p>Your order <b>#${esc(o.order_no)}</b> has been placed. Order updates will be sent to <b>${esc(o.email)}</b>.</p>
      <div class="panel" style="text-align:left;margin:24px 0">
        ${o.items.map((i) => `<div class="mini-line"><div class="q"><img src="${esc(i.image || '')}" alt=""><i>${i.qty}</i></div><div class="n">${esc(i.name)}<br><span class="muted" style="font-size:12px">${esc(i.size)}</span></div><b>${money(i.price * i.qty)}</b></div>`).join('')}
        <div class="totals" style="margin-top:10px"><div class="row grand"><span>Total ${o.payment_method === 'cod' ? '(pay on delivery)' : o.payment_status === 'paid' ? '(paid)' : ''}</span><span>${money(o.total)}</span></div></div>
        <p class="muted" style="font-size:13px;margin-bottom:0">Shipping to ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)} ${esc(o.pincode)}</p>
      </div>
      <a class="btn" href="/track?order=${encodeURIComponent(o.order_no)}&phone=${encodeURIComponent(p.get('phone'))}">Track order</a>` : '<p>Your order has been placed.</p>'}
    <a class="btn btn-outline" href="/shop">Continue shopping</a>
  </div>`;
})();

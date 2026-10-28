(async function () {
  const { $, esc, money, cart, freeShipBar, cartLine, toast, ready } = Store;
  await ready;
  const main = $('#main');

  async function render() {
    if (!cart.items().length) {
      main.innerHTML = '<div class="wrap success"><h1>Your cart is empty</h1><p class="muted">Explore our latest drops and find something you love.</p><a class="btn btn-brand" href="/shop">Start shopping</a></div>';
      return;
    }
    const q = await cart.quote();
    if (q.coupon_error && cart.coupon()) { toast(q.coupon_error, true); cart.coupon(''); }
    main.innerHTML = `<div class="page-head"><div class="wrap"><h1>Your cart</h1></div></div>
      <div class="wrap two-col">
        <div>${freeShipBar(q)}${q.lines.map(cartLine(q)).join('')}<p><a href="/shop" style="text-decoration:underline">← Continue shopping</a></p></div>
        <aside class="panel sticky"><h3>Order summary</h3>
          <form class="coupon" id="coupon"><input class="input" name="code" placeholder="Coupon code" value="${esc(q.coupon || '')}" aria-label="Coupon code">
            ${q.coupon ? '<button type="button" class="btn btn-outline btn-sm" id="rmc">Remove</button>' : '<button class="btn btn-sm">Apply</button>'}</form>
          <div class="totals">
            <div class="row"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
            ${q.discount ? `<div class="row"><span>Discount (${esc(q.coupon)})</span><span style="color:var(--ok)">−${money(q.discount)}</span></div>` : ''}
            <div class="row"><span>Shipping</span><span>${q.shipping ? money(q.shipping) : 'Free'}</span></div>
            <div class="row grand"><span>Total</span><span>${money(q.total)}</span></div>
            ${q.gst != null ? `<div class="row gst-row"><span>Includes GST</span><span>${Store.money2(q.gst)}</span></div>` : ''}
          </div>
          <a class="btn btn-brand btn-block" style="margin-top:16px" href="/checkout" ${q.issues.length ? 'aria-disabled="true" onclick="return false" title="Fix the items marked above"' : ''}>Proceed to checkout</a>
          ${q.issues.length ? '<p class="warn" style="color:var(--brand);font-size:13px">Some items need your attention before checkout.</p>' : ''}
        </aside>
      </div>`;
    $('#coupon').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      if (!code) return;
      cart.coupon(code);
      const r = await cart.quote();
      if (r.coupon_error) { cart.coupon(''); toast(r.coupon_error, true); } else toast(`Coupon applied — you saved ${money(r.discount)}`);
      render();
    });
    $('#rmc')?.addEventListener('click', () => { cart.coupon(''); render(); });
  }

  document.addEventListener('cart:change', render);
  render();
})();

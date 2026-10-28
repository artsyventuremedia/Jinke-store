(async function () {
  const { $, esc, ready } = Store;
  const st = await ready;
  const s = st.settings;
  const faqs = [
    ['How long does delivery take?', 'Orders are dispatched within 1–2 business days and usually arrive in 3–7 days, depending on your pincode.'],
    ['Is cash on delivery available?', 'Yes, COD is available across India. You can pay the delivery partner in cash or via UPI.'],
    ['How do I choose my size?', 'Each apparel product page has a size chart. Our tees are a regular fit — size up if you prefer a relaxed look.'],
    ['Do you ship internationally?', `Yes! Write to ${s.email} or message us on WhatsApp with your address and we'll share a shipping quote.`],
    ['Do you take bulk or corporate orders?', `Absolutely. Call us at ${s.phone} or email ${s.email} for custom prints and bulk pricing.`],
  ];
  $('#main').innerHTML = `<div class="page-head"><div class="wrap"><h1>Help & policies</h1></div></div>
    <div class="wrap prose" style="padding-top:20px">
      <h2 id="shipping">Shipping</h2>
      <p>We ship across India. Shipping is free on orders above ₹${esc(s.free_shipping_above)}; a flat ₹${esc(s.shipping_fee)} applies otherwise. You'll get a tracking number as soon as your order ships, and you can follow it on our <a href="/track" style="text-decoration:underline">order tracking page</a>.</p>
      <h2 id="returns">Returns & exchange</h2>
      <p>Size exchanges are accepted within 7 days of delivery for unused products with tags intact. Stickers, magnets and customised items are not eligible for return. To request an exchange, contact us with your order number.</p>
      <h2 id="faq">Frequently asked questions</h2>
      <div class="details">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="body">${esc(a)}</div></details>`).join('')}</div>
      <h2>Policies</h2>
      <p><a href="/pages/shipping-policy" style="text-decoration:underline">Shipping Policy</a> · <a href="/pages/refund-policy" style="text-decoration:underline">Refund & Cancellation Policy</a> · <a href="/pages/terms" style="text-decoration:underline">Terms & Conditions</a> · <a href="/pages/privacy-policy" style="text-decoration:underline">Privacy Policy</a></p>
      <h2 id="contact">Contact us</h2>
      <p>Phone: <a href="tel:${esc(s.phone.replace(/\s/g, ''))}">${esc(s.phone)}</a><br>Email: <a href="mailto:${esc(s.email)}">${esc(s.email)}</a><br>${esc(s.address)}</p>
    </div>`;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();

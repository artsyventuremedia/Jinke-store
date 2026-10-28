(async function () {
  const { $, $$, esc, api, toast, productCard, priceHtml, variantPicker, stars, ICON, state: st, ready } = Store;
  await ready;
  const main = $('#main');
  const slug = decodeURIComponent(location.pathname.split('/').pop());
  let data;
  try {
    data = await api('/products/' + encodeURIComponent(slug));
  } catch {
    main.innerHTML = '<div class="wrap success"><h1>Product not found</h1><p class="muted">It may have been removed or renamed.</p><a class="btn" href="/shop">Continue shopping</a></div>';
    return;
  }
  const p = data.product;
  document.title = `${p.name} — ${st.settings.store_name}`;

  main.innerHTML = `<div class="wrap">
    <div class="crumbs" style="margin-top:20px"><a href="/">Home</a>${Store.categoryPath(p.category_slug).map((c) => ` / <a href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('')} / ${esc(p.name)}</div>
    <div class="pdp">
      <div class="gallery">
        <div class="thumbs">${p.images.map((src, i) => `<button class="${i ? '' : 'on'}" data-img="${i}" aria-label="Image ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>
        <div class="main"><img id="main-img" src="${esc(p.images[0] || '')}" alt="${esc(p.name)}"></div>
      </div>
      <div>
        ${p.collection_name ? `<a class="kicker" href="/shop?collection=${esc(p.collection_slug)}">${esc(p.collection_name)}</a>` : ''}
        <h1>${esc(p.name)}</h1>
        ${p.rating.count ? `<a href="#reviews" class="rating-line"><span class="stars" aria-hidden="true">${stars(p.rating.average)}</span> ${Number(p.rating.average).toFixed(1)} · ${p.rating.count} review${p.rating.count === 1 ? '' : 's'}</a>` : ''}
        ${priceHtml(p)}<div class="tax">Inclusive of GST · Free shipping above ₹${esc(st.settings.free_shipping_above)}</div>
        <div id="picker"></div>
        <button class="btn btn-outline btn-sm" data-wish="${p.id}" style="margin-top:12px">${ICON.heart.replace('<svg', '<svg width="16" height="16"')} Add to wishlist</button>
        <div class="details">
          <details open><summary>Description</summary><div class="body">${esc(p.description)}</div></details>
          <details><summary>Shipping & delivery</summary><div class="body">Orders are dispatched within 1–2 business days. Delivery takes 3–7 days across India. Cash on delivery available.</div></details>
          <details><summary>Returns & exchange</summary><div class="body">Size exchange within 7 days of delivery for unused items with tags intact. See our <a href="/help#returns" style="text-decoration:underline">returns policy</a>.</div></details>
        </div>
      </div>
    </div>
    <section class="block" id="reviews"><div class="section-head"><div><div class="kicker">Reviews</div><h2>What customers say</h2></div></div>
      <div class="reviews">
        <div class="review-summary panel">
          ${p.rating.count ? `<div class="big">${Number(p.rating.average).toFixed(1)}</div><div class="stars" aria-label="${p.rating.average} out of 5">${stars(p.rating.average)}</div><p class="muted">Based on ${p.rating.count} review${p.rating.count === 1 ? '' : 's'}</p>` : '<p class="muted" style="margin-top:0">No reviews yet. Be the first to share your thoughts!</p>'}
          <div id="review-form"></div>
        </div>
        <div>${data.reviews.map((r) => `<article class="review">
          <div class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</div>
          ${r.text ? `<p>${esc(r.text)}</p>` : ''}
          <small><b>${esc(r.name)}</b>${r.verified ? ' · <span class="verified">✓ Verified buyer</span>' : ''} · ${new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { dateStyle: 'medium' })}</small>
        </article>`).join('')}</div>
      </div>
    </section>
    ${data.related.length ? `<section class="block"><div class="section-head"><div><div class="kicker">You may also like</div><h2>Related products</h2></div></div><div class="rail">${data.related.map(productCard).join('')}</div></section>` : ''}
  </div>`;

  const showImage = (src) => {
    $('#main-img').src = src;
    $$('[data-img]').forEach((x) => x.classList.toggle('on', p.images[Number(x.dataset.img)] === src));
  };
  variantPicker($('#picker'), p, { onImage: showImage });
  renderReviewForm();

  function renderReviewForm() {
    const box = $('#review-form');
    if (!st.user) {
      box.innerHTML = `<a class="btn btn-outline btn-block" href="/account?next=${encodeURIComponent(location.pathname + '#reviews')}">Log in to write a review</a>`;
      return;
    }
    const mine = data.my_review;
    if (mine && !box.dataset.editing) {
      box.innerHTML = `<p style="font-size:14px">${mine.approved ? 'Thanks for your review!' : 'Thanks! Your review will appear once it has been approved.'}</p><button class="link-btn" id="edit-review">Edit your review</button>`;
      $('#edit-review').addEventListener('click', () => { box.dataset.editing = '1'; renderReviewForm(); });
      return;
    }
    let rating = mine ? mine.rating : 0;
    box.innerHTML = `<form id="rf"><p style="font-weight:600;margin-bottom:6px">${mine ? 'Edit your review' : 'Write a review'}</p>
      <div class="star-input" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === rating}" aria-label="${n} star${n > 1 ? 's' : ''}" data-star="${n}">★</button>`).join('')}</div>
      <textarea class="input" name="text" rows="3" maxlength="1000" placeholder="How was the fit, fabric and print?">${esc(mine?.text || '')}</textarea>
      <button class="btn btn-block" style="margin-top:10px">Submit review</button></form>`;
    const paint = () => $$('[data-star]', box).forEach((b) => { b.classList.toggle('on', Number(b.dataset.star) <= rating); b.setAttribute('aria-checked', Number(b.dataset.star) === rating); });
    $$('[data-star]', box).forEach((b) => b.addEventListener('click', () => { rating = Number(b.dataset.star); paint(); }));
    paint();
    $('#rf').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!rating) return toast('Tap the stars to choose a rating', true);
      try {
        await api(`/products/${p.id}/reviews`, { body: { rating, text: e.target.text.value } });
        data.my_review = { rating, text: e.target.text.value, approved: 0 };
        delete box.dataset.editing;
        renderReviewForm();
        toast('Review submitted — thank you!');
      } catch (err) { toast(err.message, true); }
    });
  }
  const wishBtn = $(`.pdp [data-wish]`);
  wishBtn.classList.toggle('on', st.wish.has(p.id));
  $$('[data-img]').forEach((b) => b.addEventListener('click', () => showImage(p.images[Number(b.dataset.img)])));
})();

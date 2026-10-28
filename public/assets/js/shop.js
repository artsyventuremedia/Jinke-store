(async function () {
  const { $, $$, esc, api, productCard, ready, childrenOf, topCategories, categoryPath } = Store;
  const state = await ready;
  const main = $('#main');
  const params = new URLSearchParams(location.search);
  const f = {
    q: params.get('q') || '', category: params.get('category') || '', collection: params.get('collection') || '',
    size: params.get('size') || '', min: params.get('min') || '', max: params.get('max') || '',
    sort: params.get('sort') || 'newest', in_stock: params.get('in_stock') || '', page: Number(params.get('page')) || 1,
  };

  const title = () => {
    if (f.q) return `Results for “${esc(f.q)}”`;
    const c = state.categories.find((x) => x.slug === f.category);
    const col = state.collections.find((x) => x.slug === f.collection);
    return esc(col?.name || c?.name || 'Shop all');
  };

  // Category radios as an indented tree. A category under two parents (Caps) appears under each.
  function categoryOptions() {
    const opt = (c, depth, key) => `<label class="opt" style="padding-left:${depth * 18}px"><input type="radio" name="category" value="${esc(c.slug)}" data-key="${key}" ${f.category === c.slug ? 'checked' : ''}> ${esc(c.name)}</label>`
      + childrenOf(c.id).map((k) => opt(k, depth + 1, `${key}-${k.id}`)).join('');
    return topCategories().map((t) => opt(t, 0, t.id)).join('');
  }

  main.innerHTML = `<div class="page-head"><div class="wrap"><div class="crumbs" id="crumbs"></div><h1 id="title"></h1><p class="muted" id="sub" style="margin:4px 0 0"></p></div></div>
    <div class="wrap shop">
      <aside class="filters" id="filters">
        <h4>Category</h4><label class="opt"><input type="radio" name="category" value="" ${!f.category ? 'checked' : ''}> All products</label>
        ${categoryOptions()}
        <h4>Collection</h4><label class="opt"><input type="radio" name="collection" value="" ${!f.collection ? 'checked' : ''}> All</label>
        ${state.collections.map((c) => `<label class="opt"><input type="radio" name="collection" value="${esc(c.slug)}" ${f.collection === c.slug ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
        <h4>Size</h4><div class="chips" id="sizes"></div>
        <h4>Price</h4><div style="display:flex;gap:8px"><input class="input" name="min" type="number" min="0" placeholder="Min ₹" value="${esc(f.min)}"><input class="input" name="max" type="number" min="0" placeholder="Max ₹" value="${esc(f.max)}"></div>
        <h4>Availability</h4><label class="opt"><input type="checkbox" name="in_stock" ${f.in_stock ? 'checked' : ''}> In stock only</label>
        <button class="btn btn-outline btn-sm" id="clear" style="margin-top:16px">Clear all filters</button>
      </aside>
      <div>
        <div class="toolbar"><button class="btn btn-outline btn-sm filter-toggle" id="ftoggle">Filters</button><span class="muted" id="count"></span>
          <select class="input" id="sort" aria-label="Sort by">
            <option value="newest">Newest first</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="discount">Biggest discount</option><option value="name">Name A–Z</option>
          </select></div>
        <div class="products" id="grid"></div><div class="pager" id="pager"></div>
      </div>
    </div>`;
  $('#sort').value = f.sort;

  async function load() {
    $('#title').innerHTML = title();
    $('#crumbs').innerHTML = ['<a href="/">Home</a>', f.category ? '<a href="/shop">Shop</a>' : 'Shop',
      ...categoryPath(f.category).map((c, i, arr) => (i === arr.length - 1 ? esc(c.name) : `<a href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`))].join(' / ');
    // Only one radio per category should look selected, even when it appears twice in the tree.
    let marked = false;
    $$('input[name=category]', filters).forEach((r) => { r.checked = !marked && r.value === f.category; if (r.checked) marked = true; });
    const col = state.collections.find((x) => x.slug === f.collection);
    $('#sub').textContent = col?.description || '';
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'newest')));
    history.replaceState(null, '', '/shop' + (qs.toString() ? '?' + qs : ''));
    $('#grid').innerHTML = '<div class="skeleton" style="aspect-ratio:3/4"></div>'.repeat(8);
    const data = await api('/products?' + qs);
    $('#count').textContent = `${data.total} product${data.total === 1 ? '' : 's'}`;
    $('#sizes').innerHTML = data.sizes.filter((s) => /^(XS|S|M|L|XL|XXL|3XL)$/.test(s)).map((s) => `<button class="chip ${f.size === s ? 'on' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('') || '<span class="muted">—</span>';
    const onlyCategory = f.category && !f.q && !f.collection && !f.size && !f.min && !f.max && !f.in_stock;
    $('#grid').innerHTML = data.products.length ? data.products.map(productCard).join('')
      : onlyCategory
        ? `<div class="coming-soon"><img src="/assets/brand/icon-512.png" alt=""><h3>New designs coming soon</h3><p class="muted">We're working on ${esc(title().toLowerCase())}. Meanwhile, explore our other designs — or order in bulk with your own artwork.</p>
            <a class="btn" href="/shop">Shop all</a> <a class="btn btn-outline" href="/bulk-order">Bulk order</a></div>`
        : '<div class="empty" style="grid-column:1/-1"><h3>No products found</h3><p>Try removing some filters or searching for something else.</p></div>';
    $('#pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) => `<button class="${i + 1 === data.page ? 'on' : ''}" data-page="${i + 1}">${i + 1}</button>`).join('') : '';
  }

  const filters = $('#filters');
  filters.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'in_stock') f.in_stock = t.checked ? '1' : '';
    else if (t.name in f) f[t.name] = t.value;
    f.page = 1;
    load();
  });
  filters.addEventListener('click', (e) => {
    const s = e.target.closest('[data-size]');
    if (s) { f.size = f.size === s.dataset.size ? '' : s.dataset.size; f.page = 1; load(); }
  });
  $('#clear').addEventListener('click', () => {
    Object.assign(f, { q: '', category: '', collection: '', size: '', min: '', max: '', in_stock: '', page: 1 });
    $$('input[type=radio][value=""]', filters).forEach((r) => { r.checked = true; });
    $$('input[type=number]', filters).forEach((i) => { i.value = ''; });
    $('input[name=in_stock]', filters).checked = false;
    load();
  });
  $('#sort').addEventListener('change', (e) => { f.sort = e.target.value; f.page = 1; load(); });
  $('#ftoggle').addEventListener('click', () => filters.classList.toggle('open'));
  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) { f.page = Number(b.dataset.page); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  load();
})();

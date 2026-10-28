// GST tax invoices. Prices in the store include GST; the invoice works backwards to the taxable value.
// Same state as the business → CGST + SGST; other states → IGST.
const { db, tx, getSettings } = require('./db');
const { localYearMonth, formatDate } = require('./time');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;
const inr = (n) => '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATE_CODES = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22',
  'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36',
  'Andhra Pradesh': '37', Ladakh: '38',
};

async function gstActive(s) {
  s = s || await getSettings();
  return s.gst_enabled === '1' && !!s.gstin;
}

// Indian financial year (April–March), e.g. "2026-27".
function financialYear(d = new Date()) {
  const { year, month } = localYearMonth(d);
  const y = month >= 4 ? year : year - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// Gives the order the next invoice number for this financial year (once; later calls return the same number).
async function ensureInvoiceNumber(orderId) {
  return tx(async () => {
    const o = (await db.get('SELECT invoice_no FROM orders WHERE id = ?', orderId));
    if (!o) return null;
    if (o.invoice_no) return o.invoice_no;
    const fy = financialYear();
    (await db.run('INSERT INTO invoice_counters(fy, last) VALUES(?, 0) ON CONFLICT(fy) DO NOTHING', fy));
    (await db.run('UPDATE invoice_counters SET last = last + 1 WHERE fy = ?', fy));
    const n = (await db.get('SELECT last FROM invoice_counters WHERE fy = ?', fy)).last;
    const prefix = ((await getSettings()).invoice_prefix || 'INV').replace(/[^A-Za-z0-9-]/g, '').slice(0, 5) || 'INV';
    const no = `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
    (await db.run("UPDATE orders SET invoice_no = ?, invoice_date = datetime('now') WHERE id = ?", no, orderId));
    return no;
  });
}

// Splits every line (and shipping) into taxable value + tax. The order-level discount is spread across lines by value.
async function computeInvoice(order, s) {
  s = s || await getSettings();
  const active = await gstActive(s);
  const intra = (order.state || '').trim().toLowerCase() === (s.business_state || '').trim().toLowerCase();
  const defaultRate = parseFloat(s.gst_rate) || 0;
  const lines = order.items.map((it) => {
    const gross = it.price * it.qty;
    const discount = order.subtotal ? (order.discount * gross) / order.subtotal : 0;
    const net = gross - discount;
    const rate = active ? (it.gst_rate ?? defaultRate) : 0;
    const taxable = net / (1 + rate / 100);
    return { name: it.name, size: it.size, hsn: it.hsn || s.hsn_default || '', qty: it.qty, unit: it.price, gross, discount, taxable, rate, tax: net - taxable, total: net };
  });
  if (order.shipping) {
    // Delivery is part of the same supply, so it takes the highest rate among the goods.
    const rate = active ? Math.max(defaultRate, ...lines.map((l) => l.rate)) : 0;
    const taxable = order.shipping / (1 + rate / 100);
    lines.push({ name: 'Shipping & handling', size: '', hsn: '9965', qty: 1, unit: order.shipping, gross: order.shipping, discount: 0, taxable, rate, tax: order.shipping - taxable, total: order.shipping });
  }
  const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
  return { active, intra, lines, taxable: sum('taxable'), tax: sum('tax'), discount: sum('discount'), total: order.total };
}

function amountInWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`);
  const three = (n) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n));
  const words = (n) => {
    if (!n) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return parts.join(' ');
  };
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

async function renderInvoice(order, { forAdmin } = {}) {
  const s = await getSettings();
  const inv = await computeInvoice(order, s);
  const seller = s.business_name || s.store_name;
  const stateCode = (st) => (STATE_CODES[st] ? ` (${STATE_CODES[st]})` : '');
  const date = (d) => formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
  const taxCols = inv.active
    ? (inv.intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>')
    : '';
  const taxCells = (l) => {
    if (!inv.active) return '';
    return inv.intra
      ? `<td class="r">${inr(l.tax / 2)}<small>${l.rate / 2}%</small></td><td class="r">${inr(l.tax / 2)}<small>${l.rate / 2}%</small></td>`
      : `<td class="r">${inr(l.tax)}<small>${l.rate}%</small></td>`;
  };
  // GST summary by rate (required on tax invoices)
  const byRate = {};
  for (const l of inv.lines) {
    const k = l.rate;
    byRate[k] ||= { taxable: 0, tax: 0 };
    byRate[k].taxable += l.taxable;
    byRate[k].tax += l.tax;
  }
  const title = inv.active ? 'Tax Invoice' : 'Invoice';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} ${esc(order.invoice_no)} — ${esc(seller)}</title>
<style>
  :root { --ink:#161616; --muted:#6b6a66; --line:#dcd8cf; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 'Helvetica Neue', Arial, sans-serif; color: var(--ink); background: #f3f1ec; }
  .sheet { max-width: 820px; margin: 24px auto; background: #fff; padding: 36px 40px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .bar { max-width: 820px; margin: 16px auto 0; display: flex; gap: 8px; justify-content: flex-end; padding: 0 16px; }
  .bar button, .bar a { font: inherit; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--ink); background: var(--ink); color: #fff; cursor: pointer; text-decoration: none; }
  .bar a { background: #fff; color: var(--ink); }
  header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid var(--ink); padding-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .5px; text-transform: uppercase; }
  .seller b { font-size: 16px; }
  .muted { color: var(--muted); }
  .meta { text-align: right; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 18px 0; }
  .parties h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 6px; vertical-align: top; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); border-bottom: 1.5px solid var(--ink); }
  .r { text-align: right; white-space: nowrap; }
  td small { display: block; color: var(--muted); font-size: 11px; }
  .totals { margin-left: auto; width: 320px; margin-top: 10px; }
  .totals td { border: 0; padding: 4px 6px; }
  .totals .grand td { border-top: 2px solid var(--ink); font-size: 15px; font-weight: 700; padding-top: 8px; }
  .words { margin: 14px 0; padding: 10px 12px; background: #f7f5f0; }
  .summary { width: auto; margin-top: 14px; font-size: 12px; }
  footer { margin-top: 28px; display: flex; justify-content: space-between; gap: 20px; align-items: end; font-size: 12px; }
  .sign { text-align: right; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    @page { size: A4; margin: 14mm; }
  }
  @media (max-width: 640px) {
    .sheet { padding: 20px 16px; margin: 0; }
    header, .parties, footer { display: block; }
    .meta, .sign { text-align: left; margin-top: 12px; }
    .table-wrap { overflow-x: auto; }
    .totals { width: 100%; }
  }
</style></head><body>
<div class="bar"><a href="${forAdmin ? `/admin/#/orders/${order.id}` : `/track?order=${encodeURIComponent(order.order_no)}&phone=${encodeURIComponent(order.phone)}`}">← Back</a><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="sheet">
  <header>
    <div class="seller">
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" style="height:38px;margin-bottom:8px;display:block">` : ''}
      <b>${esc(seller)}</b><br>
      <span class="muted">${esc(s.address)}</span><br>
      ${inv.active ? `GSTIN: <b>${esc(s.gstin)}</b><br>` : ''}
      State: ${esc(s.business_state)}${stateCode(s.business_state)}<br>
      ${esc(s.email)} · ${esc(s.phone)}
    </div>
    <div class="meta">
      <h1>${title}</h1>
      <div>Invoice no: <b>${esc(order.invoice_no)}</b></div>
      <div>Invoice date: ${date(order.invoice_date || order.created_at)}</div>
      <div>Order no: #${esc(order.order_no)}</div>
      <div>Order date: ${date(order.created_at)}</div>
      <div>Payment: ${order.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid (online)'}</div>
    </div>
  </header>
  <div class="parties">
    <div><h3>Bill to / Ship to</h3>${order.buyer_gstin ? `<b>${esc(order.buyer_company)}</b><br>GSTIN: <b>${esc(order.buyer_gstin)}</b><br>Attn: ` : ''}<b>${esc(order.name)}</b><br>${esc(order.address)}<br>${esc(order.city)}, ${esc(order.state)} ${esc(order.pincode)}<br>${esc(order.phone)} · ${esc(order.email)}</div>
    <div><h3>Place of supply</h3>${esc(order.state)}${stateCode(order.state)}<br>${inv.active ? `<span class="muted">${inv.intra ? 'Intra-state supply (CGST + SGST)' : 'Inter-state supply (IGST)'}</span>` : ''}</div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th>${order.discount ? '<th class="r">Discount</th>' : ''}${inv.active ? '<th class="r">Taxable</th>' : ''}${taxCols}<th class="r">Amount</th></tr></thead>
    <tbody>${inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.size ? `<small>${esc(l.size)}</small>` : ''}</td><td>${esc(l.hsn)}</td><td class="r">${l.qty}</td><td class="r">${inr(l.unit)}</td>
      ${order.discount ? `<td class="r">${l.discount ? '−' + inr(l.discount) : '—'}</td>` : ''}${inv.active ? `<td class="r">${inr(l.taxable)}</td>` : ''}${taxCells(l)}<td class="r">${inr(l.total)}</td></tr>`).join('')}</tbody>
  </table></div>
  <table class="totals">
    ${order.discount ? `<tr><td>Order value</td><td class="r">${inr(order.subtotal + order.shipping)}</td></tr>
      <tr><td>Discount${order.coupon_code ? ` (${esc(order.coupon_code)})` : ''}</td><td class="r">−${inr(order.discount)}</td></tr>` : ''}
    ${inv.active ? `<tr><td${order.discount ? ' style="border-top:1px solid var(--line);padding-top:8px"' : ''}>Taxable value</td><td class="r"${order.discount ? ' style="border-top:1px solid var(--line);padding-top:8px"' : ''}>${inr(inv.taxable)}</td></tr>
      ${inv.intra ? `<tr><td>CGST</td><td class="r">${inr(inv.tax / 2)}</td></tr><tr><td>SGST</td><td class="r">${inr(inv.tax / 2)}</td></tr>` : `<tr><td>IGST</td><td class="r">${inr(inv.tax)}</td></tr>`}` : ''}
    <tr class="grand"><td>Total</td><td class="r">${inr(inv.total)}</td></tr>
  </table>
  <div class="words"><b>Amount in words:</b> ${amountInWords(inv.total)}</div>
  ${inv.active ? `<table class="summary"><thead><tr><th>GST rate</th><th class="r">Taxable value</th>${inv.intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}<th class="r">Total tax</th></tr></thead><tbody>
    ${Object.entries(byRate).sort((a, b) => a[0] - b[0]).map(([rate, v]) => `<tr><td>${rate}%</td><td class="r">${inr(v.taxable)}</td>${inv.intra ? `<td class="r">${inr(v.tax / 2)}</td><td class="r">${inr(v.tax / 2)}</td>` : `<td class="r">${inr(v.tax)}</td>`}<td class="r">${inr(v.tax)}</td></tr>`).join('')}
  </tbody></table>` : `<p class="muted">${s.gstin ? '' : 'Supplier not registered under GST.'}</p>`}
  <footer>
    <div class="muted">All prices include applicable taxes. Tax is not payable on reverse charge.<br>This is a computer-generated invoice and does not require a signature.</div>
    <div class="sign">For <b>${esc(seller)}</b><br><br><span class="muted">Authorised signatory</span></div>
  </footer>
</div></body></html>`;
}

module.exports = { gstActive, ensureInvoiceNumber, computeInvoice, renderInvoice, amountInWords, financialYear, STATE_CODES };

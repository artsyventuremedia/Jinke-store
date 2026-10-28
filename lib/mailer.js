const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

let cached = { key: '', transport: null };

async function transport() {
  const s = await getSettings();
  if (!s.smtp_host) return null;
  const key = [s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass].join('|');
  if (cached.key !== key) {
    const port = parseInt(s.smtp_port, 10) || 587;
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: s.smtp_host,
        port,
        secure: port === 465,
        auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
      }),
    };
  }
  return cached.transport;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function layout(s, title, body) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161616">
    <div style="background:#161616;color:#f5c518;padding:18px 24px;font-size:22px;font-weight:bold">${process.env.PUBLIC_URL
      ? `<img src="${esc(process.env.PUBLIC_URL.replace(/\/+$/, ''))}/assets/brand/logo-white.png" alt="${esc(s.store_name)}" height="36" style="display:block;height:36px">`
      : esc(s.store_name)}</div>
    <div style="padding:24px;border:1px solid #e6e2d9;border-top:0">
      <h2 style="margin:0 0 12px;font-size:20px">${title}</h2>${body}
      <p style="color:#7b7a76;font-size:13px;margin-top:24px">Questions? Reply to this email or call ${esc(s.phone)}.</p>
    </div></div>`;
}

function itemsTable(o) {
  const rows = o.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.name)} <span style="color:#7b7a76">(${esc(i.size)}) × ${i.qty}</span></td><td style="text-align:right">${money(i.price * i.qty)}</td></tr>`).join('');
  const line = (label, value, bold) => `<tr><td style="padding:4px 0;${bold ? 'font-weight:bold;border-top:1px solid #e6e2d9;padding-top:8px' : 'color:#4a4a48'}">${label}</td><td style="text-align:right;${bold ? 'font-weight:bold;border-top:1px solid #e6e2d9;padding-top:8px' : ''}">${value}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
    ${line('Subtotal', money(o.subtotal))}${o.discount ? line(`Discount (${esc(o.coupon_code)})`, '−' + money(o.discount)) : ''}
    ${line('Shipping', o.shipping ? money(o.shipping) : 'Free')}${line('Total', money(o.total), true)}</table>`;
}

function trackUrl(base, o) {
  return `${base}/track?order=${encodeURIComponent(o.order_no)}&phone=${encodeURIComponent(o.phone)}`;
}

async function send(to, subject, html) {
  const t = await transport();
  if (!t || !to) return;
  const s = await getSettings();
  const from = s.mail_from || `${s.store_name} <${s.smtp_user || s.email}>`;
  try {
    await t.sendMail({ from, to, replyTo: s.email || undefined, subject, html });
  } catch (err) {
    console.error(`Email to ${to} failed:`, err.message);
  }
}

// These never throw (send() catches), so they can't break checkout or admin updates. Callers pass the
// returned promise to background() so the work survives after the response on Vercel.
async function orderPlaced(o, baseUrl) {
  const s = await getSettings();
  const pay = o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online';
  const jobs = [send(o.email, `Order #${o.order_no} confirmed — ${s.store_name}`, layout(s, `Thank you, ${esc(o.name.split(' ')[0])}!`,
    `<p>We've received your order <b>#${esc(o.order_no)}</b> and will let you know as soon as it ships.</p>${itemsTable(o)}
     <p style="font-size:14px"><b>Payment:</b> ${pay}<br><b>Shipping to:</b> ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)}, ${esc(o.state)} ${esc(o.pincode)}</p>
     <p><a href="${trackUrl(baseUrl, o)}" style="background:#c8102e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Track your order</a></p>`))];
  if (s.email) {
    jobs.push(send(s.email, `New order #${o.order_no} — ${money(o.total)} (${pay})`, layout(s, 'New order received',
      `<p><b>${esc(o.name)}</b> · ${esc(o.phone)} · ${esc(o.email)}<br>${esc(o.city)}, ${esc(o.state)}</p>${itemsTable(o)}
       <p><a href="${baseUrl}/admin/#/orders/${o.id}">Open in admin</a></p>`)));
  }
  await Promise.all(jobs);
}

const STATUS_COPY = {
  confirmed: ['Your order is confirmed', 'We are getting your items ready.'],
  shipped: ['Your order is on its way! 🚚', 'Your package has left our warehouse.'],
  delivered: ['Your order has been delivered', 'We hope you love it! Tag us on Instagram — we would love to see it.'],
  cancelled: ['Your order has been cancelled', 'If you paid online, your refund will be processed to the original payment method within 5–7 business days.'],
};

async function statusChanged(o, baseUrl, note) {
  const copy = STATUS_COPY[o.status];
  if (!copy) return;
  const s = await getSettings();
  const tracking = o.status === 'shipped' && o.tracking_no ? `<p><b>Courier:</b> ${esc(o.courier || '—')}<br><b>Tracking number:</b> ${esc(o.tracking_no)}</p>` : '';
  const invoice = o.invoice_no && ['shipped', 'delivered'].includes(o.status)
    ? `<p><a href="${baseUrl}/invoice/${encodeURIComponent(o.order_no)}?phone=${encodeURIComponent(String(o.phone).replace(/\D/g, '').slice(-10))}">Download your invoice (${esc(o.invoice_no)})</a></p>` : '';
  await send(o.email, `${copy[0]} — #${o.order_no}`, layout(s, copy[0],
    `<p>${copy[1]}</p>${note ? `<p style="background:#f7f4ee;padding:10px 12px;border-radius:8px">${esc(note)}</p>` : ''}${tracking}
     <p><a href="${trackUrl(baseUrl, o)}">Track order #${esc(o.order_no)}</a></p>${invoice}`));
}

async function passwordReset(user, link, minutes) {
  const s = await getSettings();
  await send(user.email, `Reset your ${s.store_name} password`, layout(s, 'Reset your password',
    `<p>Hi ${esc(user.name.split(' ')[0])}, we received a request to reset your password.</p>
     <p><a href="${esc(link)}" style="background:#c8102e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Choose a new password</a></p>
     <p style="font-size:13px;color:#7b7a76">This link works once and expires in ${minutes} minutes. If you didn't ask for this, you can ignore this email — your password won't change.</p>`));
}

// New bulk enquiry → alert to the store, and a short acknowledgement to the customer.
async function bulkEnquiry(e, baseUrl) {
  const s = await getSettings();
  const jobs = [];
  const row = (k, v) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#7b7a76">${k}</td><td>${esc(v)}</td></tr>` : '');
  if (s.email) {
    jobs.push(send(s.email, `Bulk enquiry: ${e.quantity} pcs — ${e.company || e.name}`, layout(s, 'New bulk order enquiry',
      `<table style="font-size:14px">${row('Name', e.name)}${row('Company', e.company)}${row('GSTIN', e.gstin)}${row('Phone', e.phone)}${row('Email', e.email)}${row('City', e.city)}
       ${row('Products', e.products)}${row('Quantity', e.quantity)}${row('Customisation', e.customization)}${row('Needed by', e.needed_by)}${row('Message', e.message)}</table>
       <p><a href="${baseUrl}/admin/#/bulk">Open bulk enquiries in admin</a></p>`)));
  }
  jobs.push(send(e.email, `We've received your bulk order enquiry — ${s.store_name}`, layout(s, `Thanks, ${esc(e.name.split(' ')[0])}!`,
    `<p>We've received your enquiry for <b>${esc(e.quantity)} pieces</b> (${esc(e.products)}). Our team will get back to you with a quote within one business day.</p>
     <p>Need it faster? Call or WhatsApp us at ${esc(s.phone)}.</p>`)));
  await Promise.all(jobs);
}

const isConfigured = async () => !!(await getSettings()).smtp_host;

async function testEmail(to) {
  const t = await transport();
  if (!t) throw new Error('Add an SMTP host first');
  const s = await getSettings();
  await t.sendMail({ from: s.mail_from || `${s.store_name} <${s.smtp_user || s.email}>`, to, subject: `Test email from ${s.store_name}`, html: layout(s, 'It works! ✅', '<p>Your store can now send order emails.</p>') });
}

module.exports = { orderPlaced, statusChanged, passwordReset, bulkEnquiry, isConfigured, testEmail };

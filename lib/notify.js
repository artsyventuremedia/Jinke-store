// One place that sends every order notification to each channel that is switched on (email, WhatsApp, SMS)
// and records the outcome, so the admin can see what reached the customer.
const { db, getSettings } = require('./db');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const sms = require('./sms');

const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

function log(orderId, channel, event, recipient, ok, detail) {
  try {
    db.prepare('INSERT INTO notification_log(order_id, channel, event, recipient, ok, detail) VALUES(?,?,?,?,?,?)')
      .run(orderId || null, channel, event, recipient || null, ok ? 1 : 0, String(detail || '').slice(0, 300));
  } catch { /* logging must never break a notification */ }
}

// Template variables, in order, for each event. The admin's WhatsApp/SMS templates must use the same order.
const VARIABLES = {
  order: ['Customer first name', 'Order number', 'Order total', 'Tracking link'],
  shipped: ['Customer first name', 'Order number', 'Courier', 'Tracking number (AWB)', 'Tracking link'],
  delivered: ['Customer first name', 'Order number'],
  cancelled: ['Customer first name', 'Order number'],
  admin: ['Order number', 'Order total', 'Customer name', 'Payment method'],
};

function values(event, o, baseUrl) {
  const link = `${baseUrl}/track?order=${encodeURIComponent(o.order_no)}&phone=${encodeURIComponent(o.phone)}`;
  switch (event) {
    case 'order': return [first(o.name), o.order_no, money(o.total), link];
    case 'shipped': return [first(o.name), o.order_no, o.courier || 'our courier partner', o.tracking_no || '-', link];
    case 'delivered':
    case 'cancelled': return [first(o.name), o.order_no];
    case 'admin': return [o.order_no, money(o.total), o.name, o.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid'];
    default: return [];
  }
}

async function sendChat(event, o, baseUrl) {
  const s = getSettings();
  const jobs = [];
  if (whatsapp.configured(s) && s[`wa_tpl_${event}`]) {
    jobs.push(whatsapp.sendTemplate(o.phone, s[`wa_tpl_${event}`], values(event, o, baseUrl))
      .then((id) => log(o.id, 'whatsapp', event, o.phone, true, id), (err) => log(o.id, 'whatsapp', event, o.phone, false, err.message)));
  }
  if (sms.configured(s) && s[`msg91_tpl_${event}`]) {
    jobs.push(sms.sendFlow(o.phone, s[`msg91_tpl_${event}`], values(event, o, baseUrl))
      .then((r) => log(o.id, 'sms', event, o.phone, true, r), (err) => log(o.id, 'sms', event, o.phone, false, err.message)));
  }
  await Promise.all(jobs);
}

async function alertAdmins(o, baseUrl) {
  const s = getSettings();
  if (!whatsapp.configured(s) || !s.wa_tpl_admin) return;
  const numbers = String(s.wa_admin_numbers || '').split(/[,\s]+/).filter(Boolean);
  await Promise.all(numbers.map((n) => whatsapp.sendTemplate(n, s.wa_tpl_admin, values('admin', o, baseUrl))
    .then((id) => log(o.id, 'whatsapp', 'admin', n, true, id), (err) => log(o.id, 'whatsapp', 'admin', n, false, err.message))));
}

// Fire-and-forget: never throws, never delays the response.
function orderPlaced(o, baseUrl) {
  mailer.orderPlaced(o, baseUrl);
  sendChat('order', o, baseUrl).catch(() => {});
  alertAdmins(o, baseUrl).catch(() => {});
}

function statusChanged(o, baseUrl, note) {
  mailer.statusChanged(o, baseUrl, note);
  if (['shipped', 'delivered', 'cancelled'].includes(o.status)) sendChat(o.status, o, baseUrl).catch(() => {});
}

module.exports = { orderPlaced, statusChanged, VARIABLES, values };

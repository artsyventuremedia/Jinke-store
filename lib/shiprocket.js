// Shiprocket: create the shipment, pick a courier (AWB), schedule pickup, fetch the label, and follow tracking.
// Active once the Shiprocket API user's email + password are saved in Admin → Integrations.
const { db, getSettings } = require('./db');
const { getOrder, markPaid } = require('./shop');

const BASE = process.env.SHIPROCKET_API_BASE || 'https://apiv2.shiprocket.in/v1/external';
let auth = { key: '', token: '', expires: 0 };

async function configured(s) {
  s = s || await getSettings();
  return !!(s.shiprocket_email && s.shiprocket_password);
}

async function token() {
  const s = await getSettings();
  const key = `${s.shiprocket_email}|${s.shiprocket_password}`;
  if (auth.key === key && auth.expires > Date.now()) return auth.token;
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: s.shiprocket_email, password: s.shiprocket_password }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.message || 'Shiprocket login failed — check the API user email and password');
  // Tokens are valid for 10 days; refresh well before that.
  auth = { key, token: data.token, expires: Date.now() + 8 * 864e5 };
  return data.token;
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) auth.expires = 0;
  if (!res.ok) {
    const detail = data.errors ? Object.values(data.errors).flat().join(' ') : '';
    throw new Error(`Shiprocket: ${data.message || res.status}${detail ? ' — ' + detail : ''}`);
  }
  return data;
}

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Creates the Shiprocket order + shipment for one of our orders, assigns a courier and requests pickup.
async function shipOrder(orderId, { courierId } = {}) {
  const s = await getSettings();
  const o = await getOrder(orderId);
  if (!o) throw new Error('Order not found');
  if (['cancelled', 'returned'].includes(o.status)) throw new Error('This order is cancelled');
  if (o.tracking_no && o.shiprocket_shipment_id) throw new Error('This order already has a shipment');

  let shipmentId = o.shiprocket_shipment_id;
  if (!shipmentId) {
    const { first, last } = splitName(o.name);
    const created = await call('POST', '/orders/create/adhoc', {
      order_id: o.order_no,
      order_date: o.created_at.slice(0, 16),
      pickup_location: s.shiprocket_pickup || 'Primary',
      billing_customer_name: first,
      billing_last_name: last,
      billing_address: o.address,
      billing_city: o.city,
      billing_pincode: o.pincode,
      billing_state: o.state,
      billing_country: 'India',
      billing_email: o.email,
      billing_phone: String(o.phone).replace(/\D/g, '').slice(-10),
      shipping_is_billing: true,
      order_items: o.items.map((i) => ({
        name: `${i.name}${i.size ? ` (${i.size})` : ''}`,
        sku: `JK-${i.variant_id || i.product_id}`,
        units: i.qty,
        selling_price: i.price,
        hsn: i.hsn || undefined,
      })),
      payment_method: o.payment_method === 'cod' && o.payment_status !== 'paid' ? 'COD' : 'Prepaid',
      shipping_charges: o.shipping,
      total_discount: o.discount,
      sub_total: o.subtotal,
      length: parseFloat(s.pkg_length) || 25,
      breadth: parseFloat(s.pkg_breadth) || 20,
      height: parseFloat(s.pkg_height) || 3,
      weight: Math.max(0.1, (parseFloat(s.pkg_weight) || 0.3) * o.items.reduce((n, i) => n + i.qty, 0)),
    });
    shipmentId = String(created.shipment_id);
    (await db.run('UPDATE orders SET shiprocket_order_id = ?, shiprocket_shipment_id = ? WHERE id = ?', String(created.order_id), shipmentId, orderId));
  }

  // Without a courier_id Shiprocket picks the recommended courier for this pincode.
  const awb = await call('POST', '/courier/assign/awb', { shipment_id: Number(shipmentId), ...(courierId ? { courier_id: Number(courierId) } : {}) });
  const data = awb.response?.data || {};
  if (!data.awb_code) throw new Error(`Shiprocket could not assign a courier${awb.message ? ': ' + awb.message : ''}. The shipment was created — you can retry or pick a courier in the Shiprocket panel.`);

  let note = `Shipped with ${data.courier_name || 'courier'} via Shiprocket`;
  try {
    await call('POST', '/courier/generate/pickup', { shipment_id: [Number(shipmentId)] });
    note += ' · pickup scheduled';
  } catch (err) {
    note += ' · pickup not scheduled yet (schedule it in Shiprocket)';
    console.error('Shiprocket pickup:', err.message);
  }
  let labelUrl = null;
  try {
    labelUrl = (await call('POST', '/courier/generate/label', { shipment_id: [Number(shipmentId)] })).label_url || null;
  } catch (err) {
    console.error('Shiprocket label:', err.message);
  }

  (await db.run(`UPDATE orders SET courier = ?, tracking_no = ?, label_url = ?, status = 'shipped', updated_at = datetime('now') WHERE id = ?`, data.courier_name || 'Shiprocket', data.awb_code, labelUrl, orderId));
  (await db.run("INSERT INTO order_events(order_id, status, note) VALUES(?, 'shipped', ?)", orderId, note));
  return getOrder(orderId);
}

// Maps Shiprocket/courier status text to our order status (only the ones that move the order forward).
function mapStatus(text) {
  const t = String(text || '').toUpperCase();
  if (/RTO.*DELIVERED|RETURNED/.test(t)) return 'returned';
  if (/^DELIVERED$|^DELIVERED\b/.test(t)) return 'delivered';
  if (/CANCEL/.test(t)) return null; // cancellations are decided in our admin, not by the courier
  return null;
}

// Applies a tracking update; returns the new status if the order moved forward.
async function applyTracking(orderId, statusText, location) {
  const o = (await db.get('SELECT status, payment_method, payment_status, tracking_status FROM orders WHERE id = ?', orderId));
  if (!o || !statusText) return null;
  if (o.tracking_status !== statusText) {
    (await db.run("UPDATE orders SET tracking_status = ?, updated_at = datetime('now') WHERE id = ?", statusText, orderId));
  }
  const next = mapStatus(statusText);
  if (!next || next === o.status || ['delivered', 'cancelled', 'returned'].includes(o.status)) return null;
  (await db.run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", next, orderId));
  (await db.run('INSERT INTO order_events(order_id, status, note) VALUES(?, ?, ?)', orderId, next, `${statusText}${location ? ' · ' + location : ''}`));
  if (next === 'delivered' && o.payment_method === 'cod' && o.payment_status !== 'paid') await markPaid(orderId, null, 'Cash collected on delivery');
  if (next === 'returned') await require('./shop').adjustStock(orderId, 1);
  return next;
}

async function trackAwb(awb) {
  const data = await call('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
  const td = data.tracking_data || {};
  const track = (td.shipment_track || [])[0] || {};
  const last = (td.shipment_track_activities || [])[0] || {};
  return { status: track.current_status || last.activity || '', location: last.location || '', raw: td };
}

// Background sync for shipped orders (the webhook makes this mostly redundant, but it catches missed updates).
async function syncTracking() {
  if (!(await configured())) return [];
  const rows = (await db.all(`SELECT id, tracking_no FROM orders WHERE status = 'shipped' AND shiprocket_shipment_id IS NOT NULL AND tracking_no IS NOT NULL`));
  const moved = [];
  for (const r of rows) {
    try {
      const t = await trackAwb(r.tracking_no);
      const next = await applyTracking(r.id, t.status, t.location);
      if (next) moved.push({ id: r.id, status: next });
    } catch (err) {
      console.error(`Tracking sync for order ${r.id}:`, err.message);
    }
  }
  return moved;
}

async function testConnection() {
  auth.expires = 0;
  await token();
  const pickups = await call('GET', '/settings/company/pickup');
  return (pickups.data?.shipping_address || []).map((p) => p.pickup_location);
}

module.exports = { configured, shipOrder, trackAwb, applyTracking, syncTracking, testConnection, mapStatus };

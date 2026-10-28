const crypto = require('crypto');
const { getSettings } = require('./db');

// Razorpay is "live" once both keys are saved in Admin → Settings; otherwise online payment runs in demo mode.
function razorpayConfig() {
  const s = getSettings();
  if (!s.razorpay_key_id || !s.razorpay_key_secret) return null;
  return { keyId: s.razorpay_key_id, keySecret: s.razorpay_key_secret, webhookSecret: s.razorpay_webhook_secret };
}

async function razorpayRequest(method, path, body) {
  const cfg = razorpayConfig();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.description || `Razorpay request failed (${res.status})`);
  return data;
}

function createRazorpayOrder(order) {
  return razorpayRequest('POST', '/orders', {
    amount: order.total * 100, // paise
    currency: 'INR',
    receipt: order.order_no,
    notes: { order_no: order.order_no },
  });
}

function fetchRazorpayOrder(id) {
  return razorpayRequest('GET', `/orders/${encodeURIComponent(id)}`);
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Signature returned to the browser after checkout: HMAC_SHA256(order_id|payment_id, key_secret).
function verifyPaymentSignature(razorpayOrderId, paymentId, signature) {
  const cfg = razorpayConfig();
  if (!cfg) return false;
  const expected = crypto.createHmac('sha256', cfg.keySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret).
function verifyWebhookSignature(rawBody, signature) {
  const cfg = razorpayConfig();
  if (!cfg || !cfg.webhookSecret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = { razorpayConfig, createRazorpayOrder, fetchRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature };

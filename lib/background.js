// Work that finishes after the response is sent (emails, WhatsApp/SMS, webhooks to Shiprocket).
// On Vercel the function could be frozen once it responds, so the work is registered with waitUntil();
// elsewhere it simply runs on. Errors are logged, never thrown at the customer.
let waitUntil = null;
if (process.env.VERCEL) {
  try { ({ waitUntil } = require('@vercel/functions')); } catch { /* fall back to plain promises */ }
}

function background(promise) {
  const p = Promise.resolve(promise).catch((err) => console.error('Background task failed:', err.message));
  if (waitUntil) {
    try { waitUntil(p); } catch { /* outside a request (e.g. start-up): the promise still runs */ }
  }
  return p;
}

module.exports = { background };

// Background jobs: release stock held by abandoned online payments, and pull courier tracking.
// Run on a timer by a normal server, by Vercel Cron (/api/cron/jobs), and opportunistically when an admin
// opens the dashboard (Vercel's Hobby plan only allows daily cron jobs).
const { db } = require('./db');
const payments = require('./payments');
const shiprocket = require('./shiprocket');
const notify = require('./notify');
const { cancelOrder, markPaid, getOrder } = require('./shop');

// Online orders hold stock while the customer pays. Release it if payment isn't completed within 30 minutes,
// after checking with Razorpay that the payment really didn't go through.
async function releaseAbandonedOrders() {
  if (!(await payments.razorpayConfig())) return 0;
  const stale = await db.all(`SELECT id, payment_ref FROM orders WHERE payment_method = 'online' AND payment_status = 'pending'
    AND status = 'pending' AND payment_ref IS NOT NULL AND created_at < datetime('now', '-30 minutes')`);
  let changed = 0;
  for (const o of stale) {
    try {
      const rzp = await payments.fetchRazorpayOrder(o.payment_ref);
      if (rzp.status === 'paid') { await markPaid(o.id, null, 'Payment received (confirmed by Razorpay)'); changed++; }
      else if (rzp.status !== 'attempted' || Date.now() / 1000 - rzp.created_at > 2 * 3600) { await cancelOrder(o.id, 'Payment not completed — order released'); changed++; }
    } catch (err) {
      console.error(`Could not check payment for order ${o.id}:`, err.message);
    }
  }
  return changed;
}

// Courier tracking (Shiprocket's webhook usually gets there first; this catches anything missed).
async function syncTracking(baseUrl) {
  const moved = await shiprocket.syncTracking();
  for (const { id } of moved) await notify.statusChanged(await getOrder(id), baseUrl);
  return moved.length;
}

const EVERY = { release: 5 * 60 * 1000, tracking: 2 * 60 * 60 * 1000 };
const lastRun = { release: 0, tracking: 0 };

// Runs whichever jobs are due. force = run everything now (used by the cron endpoint).
async function runDueJobs(baseUrl, { force = false } = {}) {
  const now = Date.now();
  const out = {};
  if (force || now - lastRun.release > EVERY.release) { lastRun.release = now; out.released = await releaseAbandonedOrders(); }
  if (force || now - lastRun.tracking > EVERY.tracking) { lastRun.tracking = now; out.tracking = await syncTracking(baseUrl); }
  return out;
}

module.exports = { runDueJobs, releaseAbandonedOrders, syncTracking };

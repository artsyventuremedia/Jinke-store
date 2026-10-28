// The store's local time zone. Timestamps are stored in UTC; anything a person sees as a calendar date
// (dashboard days, invoice dates, financial year) is worked out in this zone. India has no DST.
const TZ = process.env.STORE_TZ || 'Asia/Kolkata';

// Minutes the store's zone is ahead of UTC right now (330 for India).
function offsetMinutes(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// SQLite modifier that shifts a UTC timestamp to store time, e.g. '+330 minutes'.
function sqlShift() {
  const m = offsetMinutes();
  return `'${m >= 0 ? '+' : ''}${m} minutes'`;
}

// "YYYY-MM-DD" in store time.
function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Year and month (1–12) in store time.
function localYearMonth(date = new Date()) {
  const [y, m] = localDate(date).split('-').map(Number);
  return { year: y, month: m };
}

// Formats a stored UTC timestamp ("2026-10-28 18:45:00") as a date in store time.
function formatDate(utc, options = { dateStyle: 'medium' }) {
  return new Date(String(utc).replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { ...options, timeZone: TZ });
}

module.exports = { TZ, offsetMinutes, sqlShift, localDate, localYearMonth, formatDate };

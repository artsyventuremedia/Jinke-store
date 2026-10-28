// Daily SQLite backups: a consistent copy via VACUUM INTO, keeping the most recent BACKUP_KEEP days.
// Copy the backup folder off the server too (see README) — a backup on the same disk won't survive a dead disk.
// With a Turso database (Vercel) there's no local file to copy: Turso keeps point-in-time backups itself.
const fs = require('fs');
const path = require('path');
const { db, DB_PATH, REMOTE_URL } = require('./db');

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP, 10) || 14;

async function backupNow() {
  if (REMOTE_URL) return null;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `store-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(file)) return null;
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  await db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file);
  const old = fs.readdirSync(DIR).filter((f) => /^store-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(DIR, f));
  return file;
}

function scheduleBackups() {
  if (process.env.BACKUPS === 'off' || REMOTE_URL) return;
  const run = async () => {
    try {
      const file = await backupNow();
      if (file) console.log(`Database backed up to ${file}`);
    } catch (err) {
      console.error('Backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // checks hourly, writes at most one file per day
}

module.exports = { backupNow, scheduleBackups, BACKUP_DIR: DIR };

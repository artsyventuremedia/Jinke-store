// Create an admin, or reset an existing account's password and make it an admin.
// Usage: npm run admin -- you@example.com "a-strong-password" ["Your Name"]
const { db } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const [email, password, name = 'Store Admin'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run admin -- <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
(async () => {
  await require('../lib/db').migrate();
  const existing = (await db.get('SELECT id FROM users WHERE email = ?', email));
  if (existing) {
    (await db.run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", hashPassword(password), existing.id));
    (await db.run('DELETE FROM sessions WHERE user_id = ?', existing.id));
    console.log(`Updated ${email}: password reset and admin access granted.`);
  } else {
    (await db.run("INSERT INTO users(name, email, password_hash, role) VALUES(?, ?, ?, 'admin')", name, email, hashPassword(password)));
    console.log(`Created admin ${email}.`);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });

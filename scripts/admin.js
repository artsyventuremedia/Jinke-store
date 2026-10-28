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
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(hashPassword(password), existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Updated ${email}: password reset and admin access granted.`);
} else {
  db.prepare("INSERT INTO users(name, email, password_hash, role) VALUES(?, ?, ?, 'admin')").run(name, email, hashPassword(password));
  console.log(`Created admin ${email}.`);
}

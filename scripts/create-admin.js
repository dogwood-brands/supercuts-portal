#!/usr/bin/env node
'use strict';
// Creates an administrator (or promotes an existing account and issues a new one-time password).
//   node scripts/create-admin.js <username> "<First name>" "<Last name>" [email]
const { openDb } = require('../server/db');
const { migrate } = require('../server/migrate');
const auth = require('../server/auth');

const [username, first, last, email] = process.argv.slice(2);
if (!username || !first || !last || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
  console.error('Usage: node scripts/create-admin.js <username> "<First name>" "<Last name>" [email]\nUsernames use 3 to 40 lower-case letters, numbers, dots, dashes or underscores.');
  process.exit(1);
}
const db = openDb();
migrate(db);
const password = auth.generatePassword();
const now = new Date().toISOString();
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
let id;
if (existing) {
  id = existing.id;
  db.prepare("UPDATE users SET role = 'admin', status = 'active', password_hash = ?, must_change_password = 1 WHERE id = ?").run(auth.hashPassword(password), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
} else {
  id = Number(db.prepare(`INSERT INTO users (email, username, password_hash, must_change_password, role, first_name, last_name, title, status, created_at)
    VALUES (?, ?, ?, 1, 'admin', ?, ?, 'Administrator', 'active', ?)`).run(email || null, username, auth.hashPassword(password), first, last, now).lastInsertRowid);
}
db.prepare("INSERT INTO audit_log (actor_id, action, target_type, target_id, meta_json, ip, created_at) VALUES (NULL, 'cli.create_admin', 'user', ?, ?, 'cli', ?)")
  .run(id, JSON.stringify({ username, existing: !!existing }), now);
db.close();
console.log(`${existing ? 'Promoted' : 'Created'} administrator "${username}".\nOne-time password: ${password}\nThey will be asked to choose a new one at first sign-in.`);

#!/usr/bin/env node
'use strict';
// Issues a new one-time password for an account and signs it out everywhere.
//   node scripts/reset-password.js <username>
const { openDb } = require('../server/db');
const auth = require('../server/auth');

const username = (process.argv[2] || '').toLowerCase();
if (!username) { console.error('Usage: node scripts/reset-password.js <username>'); process.exit(1); }
const db = openDb();
const user = db.prepare('SELECT id, first_name, last_name, status FROM users WHERE username = ?').get(username);
if (!user) { console.error(`No account with the username "${username}".`); db.close(); process.exit(1); }
const password = auth.generatePassword();
const now = new Date().toISOString();
db.transaction(() => {
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(auth.hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare("INSERT INTO audit_log (actor_id, action, target_type, target_id, meta_json, ip, created_at) VALUES (NULL, 'cli.password_reset', 'user', ?, NULL, 'cli', ?)").run(user.id, now);
})();
db.close();
console.log(`New one-time password for ${user.first_name} ${user.last_name} (${username}): ${password}`);
if (user.status !== 'active') console.log('Note: this account is inactive. Reactivate it in Admin > People before they sign in.');

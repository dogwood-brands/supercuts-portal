'use strict';
// Entry point: open the database, apply migrations, make sure an administrator exists, serve.
const path = require('node:path');
const { openDb } = require('./db');
const { migrate } = require('./migrate');
const { createApp } = require('./app');
const auth = require('./auth');

const PORT = Number(process.env.PORT) || 3996;
const HOST = process.env.HOST || '127.0.0.1';

const db = openDb();
migrate(db, (m) => console.log(`[migrate] ${m}`));

// First run on an empty database: create one administrator. The password comes from
// SCP_ADMIN_PASSWORD, or is generated and printed exactly once.
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  const password = process.env.SCP_ADMIN_PASSWORD || auth.generatePassword();
  db.prepare(`INSERT INTO users (username, password_hash, must_change_password, role, first_name, last_name, title, status, created_at)
    VALUES ('admin', ?, 1, 'admin', 'Portal', 'Administrator', 'Administrator', 'active', ?)`).run(auth.hashPassword(password), new Date().toISOString());
  if (!process.env.SCP_ADMIN_PASSWORD) console.log(`[bootstrap] Created administrator "admin" with one-time password: ${password}`);
  else console.log('[bootstrap] Created administrator "admin" with the password from SCP_ADMIN_PASSWORD.');
}

const app = createApp({ db, uploadsDir: process.env.SCP_UPLOADS || path.join(__dirname, '..', 'data', 'uploads') });
const server = app.listen(PORT, HOST, () => console.log(`[sc-portal] listening on http://${HOST}:${PORT}`));

const purge = setInterval(() => { try { auth.purgeExpiredSessions(db); } catch (e) { console.error('[purge]', e.message); } }, 60 * 60 * 1000);
purge.unref();

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[sc-portal] ${signal} received, finishing open requests`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

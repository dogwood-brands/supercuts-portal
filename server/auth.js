'use strict';
// Passwords (scrypt), sessions (opaque token, only its SHA-256 stored), and the CSRF guard.
const crypto = require('node:crypto');
const { unauthorized, forbidden, nowIso } = require('./util');

const COOKIE = 'scp_session';
const SESSION_DAYS = 30;
const DAY_MS = 86400000;
const SCRYPT_N = Number(process.env.SCP_SCRYPT_N) || 2 ** 15;
const KEYLEN = 32;

function hashPassword(password, N = SCRYPT_N) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  if (!Number.isInteger(N) || N < 1024 || N > 2 ** 20) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  } catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashPasswordAsync(password, N = SCRYPT_N) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password), salt, KEYLEN, { N, r: 8, p: 1, maxmem: 256 * N * 8 }, (err, hash) =>
      (err ? reject(err) : resolve(`scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`)));
  });
}

// A real hash of a random secret: used to spend the same time on unknown usernames as on wrong passwords.
const DUMMY_HASH = hashPassword(crypto.randomBytes(24).toString('hex'));

/** Readable one-time password: 4 groups, no look-alike characters. ~77 bits. */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
    }
  }
  return out;
}

function cookieHeader(req, value, maxAgeSeconds) {
  const secure = req.secure || process.env.SCP_COOKIE_SECURE === '1';
  const bits = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

function createSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)').run(
    userId, sha256(token), new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY_MS).toISOString(),
    req.ip || null, String(req.get('user-agent') || '').slice(0, 300));
  res.append('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
  return token;
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.append('Set-Cookie', cookieHeader(req, '', 0));
}

/** Attaches req.user (full users row) and req.session when the cookie maps to a live session. Never throws. */
function sessionMiddleware(db) {
  const find = db.prepare(`SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`);
  const extend = db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
  const drop = db.prepare('DELETE FROM sessions WHERE id = ?');
  return (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return next();
    const row = find.get(sha256(token));
    if (!row) return next();
    const now = Date.now();
    const expires = Date.parse(row.expires_at);
    if (!(expires > now) || row.status !== 'active') {
      drop.run(row.session_id);
      return next();
    }
    // Sliding expiry: push the window out at most once a day so reads stay cheap.
    if (expires - now < (SESSION_DAYS - 1) * DAY_MS) {
      extend.run(new Date(now + SESSION_DAYS * DAY_MS).toISOString(), row.session_id);
      res.append('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
    }
    const { session_id, expires_at, password_hash, ...user } = row;
    req.user = user;
    req.sessionId = session_id;
    next();
  };
}

const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));

/** Non-GET API calls must carry X-SCP: 1 and, when the browser sends Origin, it must be this host. */
function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-scp') !== '1') return next(forbidden('This request did not come from the portal.'));
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* malformed origin */ }
    if (!host || host !== req.get('host')) return next(forbidden('This request did not come from the portal.'));
  }
  next();
}

function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso()).changes;
}

module.exports = {
  COOKIE, SESSION_DAYS, hashPassword, hashPasswordAsync, verifyPassword, DUMMY_HASH, generatePassword, sha256,
  createSession, destroySession, sessionMiddleware, requireAuth, csrfGuard, purgeExpiredSessions, parseCookies,
};

'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const { permissions } = require('../rbac');
const { v, bad, unauthorized, conflict, nowIso, json, HttpError } = require('../util');
const { publicUser } = require('../shape');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

module.exports = (ctx) => {
  const { db, rbac, shapes, audit } = ctx;
  const r = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: ctx.config.loginLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase().slice(0, 60)}`,
    handler: (req, res, next) => next(new HttpError(429, 'too_many_attempts', 'Too many sign-in attempts. Please wait 15 minutes and try again.')),
  });

  function meUser(row) {
    const districtId = rbac.userDistrictId(row);
    const d = districtId ? db.prepare('SELECT id, name FROM districts WHERE id = ?').get(districtId) : null;
    return {
      ...publicUser(row),
      email: row.email || null,
      phone: row.phone || null,
      must_change_password: !!row.must_change_password,
      district: d || null,
      scope: rbac.scopeLabel(row),
      permissions: permissions(row),
    };
  }
  function publicSettings() {
    const get = (k, d) => json(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(k)?.value_json, d);
    return { company_name: get('company_name', 'SC Portal'), sample_data: !!get('sample_data', false), values: get('values', []) };
  }
  ctx.meUser = meUser;
  ctx.publicSettings = publicSettings;

  r.post('/auth/login', loginLimiter, (req, res) => {
    const username = v.str(req.body?.username, 'Username', { max: 120 }).toLowerCase();
    const password = v.str(req.body?.password, 'Password', { max: 200, trim: false });
    const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    // Always spend one hash so unknown usernames and wrong passwords take the same time and read the same.
    const ok = auth.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH);
    if (!row || !ok || row.status !== 'active') {
      audit(req, 'auth.login_failed', 'user', row ? row.id : null, { username: username.slice(0, 60) });
      throw unauthorized('That username or password is not right.');
    }
    auth.createSession(db, req, res, row.id);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit(req, 'auth.login', 'user', row.id, null, row.id);
    res.json({ user: meUser(shapes.userRow(row.id)) });
  });

  r.post('/auth/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  r.get('/auth/me', auth.requireAuth, (req, res) => {
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ user: meUser(shapes.userRow(req.user.id)), settings: publicSettings(), unread });
  });

  r.post('/auth/password', auth.requireAuth, (req, res) => {
    const current = v.str(req.body?.current, 'Current password', { max: 200, trim: false });
    const next = v.str(req.body?.next, 'New password', { max: 200, min: 10, trim: false });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(current, row.password_hash)) throw bad('Your current password is not right.', 'wrong_password');
    if (next === current) throw bad('Choose a new password that is different from the current one.');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(auth.hashPassword(next), req.user.id);
    // Sign out every other device.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.sessionId);
    audit(req, 'auth.password_changed', 'user', req.user.id);
    res.json({ ok: true });
  });

  r.post('/auth/invite/accept', loginLimiter, (req, res) => {
    const code = v.str(req.body?.code, 'Invite code', { max: 100 });
    const username = v.str(req.body?.username, 'Username', { max: 40 }).toLowerCase();
    if (!USERNAME_RE.test(username)) throw bad('Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    const password = v.str(req.body?.password, 'Password', { max: 200, min: 10, trim: false });
    const first = v.str(req.body?.first_name, 'First name', { max: 60 });
    const last = v.str(req.body?.last_name, 'Last name', { max: 60 });
    const invite = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(auth.sha256(code));
    if (!invite || invite.used_by || invite.expires_at < nowIso()) throw bad('That invite code is not valid any more. Ask your manager for a new one.', 'invalid_invite');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('That username is taken. Try another.');
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO users (username, password_hash, role, first_name, last_name, title, salon_id, status, created_at)
        VALUES (?,?,?,?,?,?,?, 'active', ?)`).run(username, auth.hashPassword(password), invite.role, first, last,
        invite.role === 'salon_manager' ? 'Salon Manager' : invite.role === 'stylist' ? 'Stylist' : null, invite.salon_id, nowIso());
      db.prepare('UPDATE invites SET used_by = ? WHERE id = ?').run(info.lastInsertRowid, invite.id);
      return Number(info.lastInsertRowid);
    })();
    auth.createSession(db, req, res, id);
    audit(req, 'auth.invite_accepted', 'user', id, { invite_id: invite.id }, id);
    res.json({ user: meUser(shapes.userRow(id)) });
  });

  return r;
};
module.exports.USERNAME_RE = USERNAME_RE;

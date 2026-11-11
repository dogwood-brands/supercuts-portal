'use strict';
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, HOME_OFFICE, isManagerPlus } = require('../rbac');
const { v, bad, notFound, idParam, nowIso, todayLocal, HttpError } = require('../util');
const { USER_SELECT, publicUser } = require('../shape');

const likeArg = (q) => `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;

/** Returns the extension when the bytes really are the image type they claim to be. */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

module.exports = (ctx) => {
  const { db, shapes } = ctx;
  const r = express.Router();

  // ---- promos -------------------------------------------------------------
  const promoShape = (p, full) => ({
    id: p.id, title: p.title, summary: p.summary, image_url: p.image_url, starts_on: p.starts_on, ends_on: p.ends_on, tag: p.tag, audience: p.audience,
    ...(full ? { body: p.body } : {}),
  });
  r.get('/promos', (req, res) => {
    const status = v.oneOf(req.query.status || 'active', 'status', ['active', 'upcoming', 'past']);
    const today = todayLocal();
    const cond = {
      active: "(starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)",
      upcoming: 'starts_on > ? AND ? IS NOT NULL',
      past: 'ends_on < ? AND ? IS NOT NULL',
    }[status];
    const rows = db.prepare(`SELECT * FROM promos WHERE status = 'published' AND ${cond} ORDER BY sort, ${status === 'past' ? 'ends_on DESC' : 'starts_on'}, id LIMIT 100`).all(today, today);
    res.json({ items: rows.map((p) => promoShape(p, false)) });
  });
  r.get('/promos/:id', (req, res) => {
    const p = db.prepare("SELECT * FROM promos WHERE id = ? AND status = 'published'").get(idParam(req));
    if (!p) throw notFound('We could not find that promotion.');
    res.json({ promo: promoShape(p, true) });
  });

  // ---- videos -------------------------------------------------------------
  r.get('/videos', (req, res) => {
    const channel = v.str(req.query.channel, 'channel', { max: 60, required: false });
    const rows = db.prepare(`SELECT * FROM videos ${channel ? 'WHERE channel = ?' : ''} ORDER BY channel, sort, id LIMIT 300`).all(...(channel ? [channel] : []));
    const channels = db.prepare('SELECT channel, COUNT(*) n FROM videos GROUP BY channel ORDER BY channel').all().map((c) => ({ key: c.channel, count: c.n }));
    res.json({ items: rows, channels });
  });
  r.post('/videos/:id/view', (req, res) => {
    const info = db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(idParam(req));
    if (!info.changes) throw notFound('We could not find that video.');
    res.json({ views: db.prepare('SELECT views FROM videos WHERE id = ?').get(idParam(req)).views });
  });

  // ---- directory ----------------------------------------------------------
  r.get('/directory', (req, res) => {
    const q = v.str(req.query.q, 'Search', { max: 60, required: false });
    const role = v.oneOf(req.query.role, 'role', ROLES, { required: false });
    const salonId = v.int(req.query.salon_id, 'salon_id', { min: 1, required: false });
    const marketId = v.int(req.query.market_id, 'market_id', { min: 1, required: false });
    const where = ["u.status = 'active'"];
    const params = [];
    if (q) { where.push("((u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\' OR u.title LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')"); params.push(likeArg(q), likeArg(q), likeArg(q)); }
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (salonId) { where.push('u.salon_id = ?'); params.push(salonId); }
    if (marketId) { where.push('s.market_id = ?'); params.push(marketId); }
    const rows = db.prepare(`${USER_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY CASE u.role WHEN 'executive' THEN 0 WHEN 'admin' THEN 1 WHEN 'hr' THEN 2 WHEN 'district_leader' THEN 3 WHEN 'salon_manager' THEN 4 ELSE 5 END, u.first_name, u.last_name LIMIT 400`).all(...params);
    // Contact details: managers and above see everyone's; stylists see home-office and field leadership contacts only.
    const wide = isManagerPlus(req.user);
    const people = rows.map((row) => {
      const contact = wide || HOME_OFFICE.includes(row.role) || row.role === 'district_leader';
      return { ...publicUser(row), ...(contact ? { phone: row.phone || null, email: row.email || null } : {}) };
    });
    const sWhere = ["s.status = 'active'"];
    const sParams = [];
    if (q) { sWhere.push("(s.name LIKE ? ESCAPE '\\' OR s.city LIKE ? ESCAPE '\\' OR s.salon_number LIKE ? ESCAPE '\\')"); sParams.push(likeArg(q), likeArg(q), likeArg(q)); }
    if (salonId) { sWhere.push('s.id = ?'); sParams.push(salonId); }
    if (marketId) { sWhere.push('s.market_id = ?'); sParams.push(marketId); }
    const salons = role ? [] : db.prepare(`${ctx.SALON_SQL} WHERE ${sWhere.join(' AND ')} ORDER BY s.name`).all(...sParams);
    res.json({
      people, salons: ctx.salonCards(salons, req.user),
      markets: db.prepare('SELECT id, name, state FROM markets ORDER BY name').all(),
    });
  });

  r.get('/people/:id', (req, res) => {
    const row = shapes.userRow(idParam(req));
    if (!row || row.status !== 'active') throw notFound('We could not find that person.');
    const contact = isManagerPlus(req.user) || HOME_OFFICE.includes(row.role) || row.role === 'district_leader' || row.id === req.user.id;
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const posts = db.prepare(`SELECT p.* FROM posts p JOIN shoutout_targets t ON t.post_id = p.id
      WHERE t.target_type = 'user' AND t.target_id = ? AND p.deleted_at IS NULL AND p.created_at >= ? AND ${ctx.postVisibility(req.user).sql}
      ORDER BY p.created_at DESC LIMIT 10`).all(row.id, since, ...ctx.postVisibility(req.user).params);
    res.json({
      person: {
        ...publicUser(row), bio: row.bio || null, hire_date: row.hire_date || null,
        ...(contact ? { phone: row.phone || null, email: row.email || null } : {}),
      },
      shoutouts: ctx.shapePosts(posts, req.user),
      shoutout_count: db.prepare(`SELECT COUNT(*) n FROM shoutout_targets t JOIN posts p ON p.id = t.post_id WHERE t.target_type = 'user' AND t.target_id = ? AND p.deleted_at IS NULL`).get(row.id).n,
    });
  });

  // ---- search (top bar) ---------------------------------------------------
  r.get('/search', (req, res) => {
    const q = v.str(req.query.q, 'Search', { max: 60, required: false });
    if (!q || q.length < 2) return res.json({ people: [], salons: [], resources: [], promos: [] });
    const like = likeArg(q);
    const people = db.prepare(`${USER_SELECT} WHERE u.status = 'active' AND (u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\' ORDER BY u.first_name, u.last_name LIMIT 5`).all(like).map(publicUser);
    const salons = db.prepare(`SELECT id, name, salon_number, city FROM salons WHERE status = 'active' AND (name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR salon_number LIKE ? ESCAPE '\\') ORDER BY name LIMIT 5`).all(like, like, like);
    const resources = db.prepare(`SELECT id, section, title FROM resources WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' ORDER BY sort, id LIMIT 5`).all(like, like);
    const promos = db.prepare(`SELECT id, title FROM promos WHERE status = 'published' AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\') ORDER BY sort, id LIMIT 5`).all(like, like);
    res.json({ people, salons, resources, promos });
  });

  // ---- profile ------------------------------------------------------------
  r.patch('/me', (req, res) => {
    const b = req.body || {};
    const sets = [];
    const params = [];
    if ('phone' in b) { sets.push('phone = ?'); params.push(v.str(b.phone, 'Phone', { max: 30, required: false })); }
    if ('bio' in b) { sets.push('bio = ?'); params.push(v.str(b.bio, 'About you', { max: 500, required: false })); }
    if ('avatar_url' in b) { sets.push('avatar_url = ?'); params.push(v.url(b.avatar_url, 'Photo')); }
    if (!sets.length) throw bad('Nothing to update.');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.user.id);
    res.json({ user: ctx.meUser(shapes.userRow(req.user.id)) });
  });

  // ---- notifications ------------------------------------------------------
  r.get('/notifications', (req, res) => {
    const rows = db.prepare('SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
    res.json({ items: rows, unread: rows.filter((n) => !n.read_at).length });
  });
  r.post('/notifications/read', (req, res) => {
    const b = req.body || {};
    const now = nowIso();
    if (b.all === true || b.ids === 'all') db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, req.user.id);
    else {
      if (!Array.isArray(b.ids) || b.ids.length > 200) throw bad('Send the notifications to mark as read.');
      const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
      for (const id of b.ids) if (Number.isInteger(id)) stmt.run(now, id, req.user.id);
    }
    res.json({ unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n });
  });

  // ---- uploads ------------------------------------------------------------
  const raw = express.raw({ type: Object.keys(MIME_EXT), limit: '6mb' });
  r.put('/uploads', raw, (req, res) => {
    const claimed = MIME_EXT[String(req.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!claimed) throw new HttpError(400, 'unsupported_type', 'Photos must be JPEG, PNG or WebP.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('That file was empty.');
    const actual = sniffImage(req.body);
    if (!actual || actual !== claimed) throw new HttpError(400, 'unsupported_type', 'That file does not look like a JPEG, PNG or WebP photo.');
    const name = `${crypto.randomBytes(16).toString('hex')}.${actual}`;
    fs.mkdirSync(ctx.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.uploadsDir, name), req.body, { mode: 0o640 });
    ctx.audit(req, 'upload.created', 'upload', null, { name, bytes: req.body.length });
    res.json({ url: `/uploads/${name}` });
  });

  return r;
};
module.exports.sniffImage = sniffImage;
module.exports.EXT_MIME = EXT_MIME;

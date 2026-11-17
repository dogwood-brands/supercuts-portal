'use strict';
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROLES, HOME_OFFICE, isManagerPlus, can } = require('../rbac');
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
const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
const VIDEO_MIME_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mp4', 'video/webm': 'webm' };
/** MP4 / MOV carry 'ftyp' at byte 4; WebM starts with the EBML magic. */
function sniffVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}
const PHOTO_LIMIT = 10;

module.exports = (ctx) => {
  const { db, shapes } = ctx;
  const r = express.Router();

  // ---- promos -------------------------------------------------------------
  const promoShape = (p, full) => ({
    id: p.id, title: p.title, summary: p.summary, image_url: p.image_url, starts_on: p.starts_on, ends_on: p.ends_on, tag: p.tag, audience: p.audience,
    video_url: p.video_url || null, video_poster_url: p.video_poster_url || null,
    ...(full ? { body: p.body } : {}),
  });
  r.get('/promos', (req, res) => {
    const status = v.oneOf(req.query.status || 'active', 'status', ['active', 'upcoming', 'past']);
    // Ended promos are not shown to the field (v1.1): it invites requests to bring old offers back.
    if (status === 'past' && !can(req.user, 'admin.content')) return res.json({ items: [] });
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
    if (p.ends_on && p.ends_on < todayLocal() && !can(req.user, 'admin.content')) throw notFound('That promotion has ended.');
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

  // ---- directory (v1.1) ---------------------------------------------------
  // No list of every stylist (it would go stale as people join and leave). Three groups instead:
  // portfolio leadership (people flagged directory_listed), district leaders, and every salon, A to Z
  // by state, with its address, phone, email and manager. Communication goes through leaders and salons.
  r.get('/directory', (req, res) => {
    const q = (v.str(req.query.q, 'Search', { max: 60, required: false }) || '').toLowerCase();
    const contactOf = (row) => ({ ...publicUser(row), phone: row.phone || null, email: row.email || null });
    const leadership = db.prepare(`${USER_SELECT} WHERE u.status = 'active' AND u.directory_listed = 1 ORDER BY u.last_name, u.first_name`).all().map(contactOf);
    const leaderRows = db.prepare(`${USER_SELECT} JOIN districts d ON d.leader_user_id = u.id WHERE u.status = 'active' ORDER BY u.first_name, u.last_name`).all();
    const districtOf = new Map(db.prepare('SELECT id, name, leader_user_id FROM districts').all().map((d) => [d.leader_user_id, d]));
    const salonCount = new Map(db.prepare("SELECT district_id, COUNT(*) n FROM salons WHERE status = 'active' GROUP BY district_id").all().map((x) => [x.district_id, x.n]));
    const districtLeaders = [...new Map(leaderRows.map((r0) => [r0.id, r0])).values()].map((row) => {
      const d = districtOf.get(row.id);
      return { ...contactOf(row), district: d ? { id: d.id, name: d.name, salons: salonCount.get(d.id) || 0 } : null };
    });
    const rows = db.prepare(`${ctx.SALON_SQL} WHERE s.status = 'active' ORDER BY s.state, s.name`).all();
    const cards = ctx.salonCards(rows, req.user);
    const salons = rows.map((s0, i) => ({
      ...cards[i], address: s0.address, zip: s0.zip, phone: s0.phone || null, email: s0.email || null, shopping_center: s0.shopping_center || null,
    }));
    const match = (...xs) => !q || xs.filter(Boolean).join(' ').toLowerCase().includes(q);
    const STATE = { CA: 'California', NV: 'Nevada', AZ: 'Arizona' };
    const byState = new Map();
    for (const s0 of salons.filter((x) => match(x.name, x.city, x.salon_number, x.manager?.name, x.shopping_center))) {
      (byState.get(s0.state) || byState.set(s0.state, []).get(s0.state)).push(s0);
    }
    res.json({
      leadership: leadership.filter((p) => match(p.name, p.title)),
      district_leaders: districtLeaders.filter((p) => match(p.name, p.title, p.district?.name)),
      states: [...byState.entries()].sort((x, y) => (STATE[x[0]] || x[0]).localeCompare(STATE[y[0]] || y[0]))
        .map(([code, list]) => ({ code, name: STATE[code] || code, salons: list.sort((x, y) => x.name.localeCompare(y.name)) })),
    });
  });

  // ---- work photos (v1.1) -------------------------------------------------
  // Each person shows up to 10 photos of their work. Adding an eleventh means deleting one first.
  const photoShape = (p, users) => ({ id: p.id, url: p.url, caption: p.caption || null, created_at: p.created_at, user: users.get(p.user_id) || null });
  r.get('/people/:id/photos', (req, res) => {
    const id = idParam(req);
    const rows = db.prepare('SELECT * FROM work_photos WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(id, PHOTO_LIMIT);
    const users = shapes.usersByIds([id]);
    res.json({ items: rows.map((p) => photoShape(p, users)), limit: PHOTO_LIMIT, can_add: id === req.user.id });
  });
  r.get('/salons/:id/photos', (req, res) => {
    const id = idParam(req);
    const rows = db.prepare(`SELECT w.* FROM work_photos w JOIN users u ON u.id = w.user_id
      WHERE u.salon_id = ? AND u.status = 'active' ORDER BY w.created_at DESC, w.id DESC LIMIT 12`).all(id);
    const users = shapes.usersByIds(rows.map((p) => p.user_id));
    res.json({ items: rows.map((p) => photoShape(p, users)) });
  });
  r.post('/me/photos', (req, res) => {
    const b = req.body || {};
    const url = v.url(b.url, 'Photo', { required: true });
    if (!/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(url)) throw bad('Upload the photo first, then add it to your album.');
    const caption = v.str(b.caption, 'Caption', { max: 140, required: false });
    const n = db.prepare('SELECT COUNT(*) n FROM work_photos WHERE user_id = ?').get(req.user.id).n;
    if (n >= PHOTO_LIMIT) throw new HttpError(409, 'album_full', `Your album holds ${PHOTO_LIMIT} photos. Delete one to add a new one.`);
    const info = db.prepare('INSERT INTO work_photos (user_id, url, caption, created_at) VALUES (?,?,?,?)').run(req.user.id, url, caption || null, nowIso());
    ctx.audit(req, 'photo.added', 'work_photo', Number(info.lastInsertRowid));
    const row = db.prepare('SELECT * FROM work_photos WHERE id = ?').get(Number(info.lastInsertRowid));
    res.json({ photo: photoShape(row, shapes.usersByIds([req.user.id])) });
  });
  r.delete('/photos/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM work_photos WHERE id = ?').get(idParam(req));
    if (!p) throw notFound('We could not find that photo.');
    // Your own photo, or a moderator removing one.
    if (p.user_id !== req.user.id && !can(req.user, 'moderate')) throw notFound('We could not find that photo.');
    db.prepare('DELETE FROM work_photos WHERE id = ?').run(p.id);
    ctx.audit(req, 'photo.deleted', 'work_photo', p.id, { owner: p.user_id });
    res.json({ ok: true });
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

  // Promo explainer videos (v1.1): content admins only, MP4 / MOV / WebM up to 200 MB.
  const rawVideo = express.raw({ type: Object.keys(VIDEO_MIME_EXT), limit: '200mb' });
  r.put('/uploads/video', (req, res, next) => (can(req.user, 'admin.content') ? next() : next(new HttpError(403, 'forbidden', 'Videos are added by the home office.'))), rawVideo, (req, res) => {
    const claimed = VIDEO_MIME_EXT[String(req.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!claimed) throw new HttpError(400, 'unsupported_type', 'Videos must be MP4, MOV or WebM.');
    const actual = sniffVideo(req.body);
    if (!actual) throw new HttpError(400, 'unsupported_type', 'That file does not look like an MP4, MOV or WebM video.');
    const name = `${crypto.randomBytes(16).toString('hex')}.${actual}`;
    fs.mkdirSync(ctx.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.uploadsDir, name), req.body, { mode: 0o640 });
    ctx.audit(req, 'upload.video', 'upload', null, { name, bytes: req.body.length });
    res.json({ url: `/uploads/${name}` });
  });

  return r;
};
module.exports.sniffImage = sniffImage;
module.exports.EXT_MIME = EXT_MIME;
module.exports.sniffVideo = sniffVideo;

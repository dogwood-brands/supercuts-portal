'use strict';
const express = require('express');
const { can, HOME_OFFICE } = require('../rbac');
const { v, bad, forbidden, notFound, idParam, nowIso, addDays, todayLocal, encodeCursor, decodeCursor, limitParam, json } = require('../util');

const KINDS = ['post', 'shoutout', 'announcement', 'win'];
const AUDIENCES = ['company', 'market', 'district', 'salon'];
const REACTIONS = ['like', 'clap', 'love', 'fire'];

module.exports = (ctx) => {
  const { db, rbac, shapes, audit, notify } = ctx;
  const r = express.Router();

  // ---- visibility ---------------------------------------------------------
  /** SQL fragment + params: posts this user may see. Home office sees everything. */
  function visibility(user) {
    if (HOME_OFFICE.includes(user.role)) return { sql: '1=1', params: [] };
    const parts = ["p.audience_type = 'company'", 'p.author_id = ?'];
    const params = [user.id];
    const market = rbac.userMarketId(user);
    const district = rbac.userDistrictId(user);
    if (market) { parts.push("(p.audience_type = 'market' AND p.audience_id = ?)"); params.push(market); }
    if (district) { parts.push("(p.audience_type = 'district' AND p.audience_id = ?)"); params.push(district); }
    const salons = user.role === 'district_leader' ? rbac.scopeSalonIds(user) : user.salon_id ? [user.salon_id] : [];
    if (salons.length) {
      parts.push(`(p.audience_type = 'salon' AND p.audience_id IN (${salons.map(() => '?').join(',')}))`);
      params.push(...salons);
    }
    return { sql: `(${parts.join(' OR ')})`, params };
  }
  function getVisiblePost(user, id) {
    const vis = visibility(user);
    const row = db.prepare(`SELECT p.* FROM posts p WHERE p.id = ? AND p.deleted_at IS NULL AND ${vis.sql}`).get(id, ...vis.params);
    if (!row) throw notFound('That post is no longer available.');
    return row;
  }

  // ---- shaping ------------------------------------------------------------
  const audienceLabel = (type, id) => {
    if (type === 'company') return 'Everyone';
    const table = { market: 'markets', district: 'districts', salon: 'salons' }[type];
    return db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)?.name || 'Team';
  };
  const commentShape = (c, users, viewer) => ({
    id: c.id, body: c.body, created_at: c.created_at, author: users.get(c.author_id) || null,
    can_delete: c.author_id === viewer.id || can(viewer, 'moderate'),
  });

  function shapePosts(rows, viewer) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const marks = ids.map(() => '?').join(',');
    const now = nowIso();
    const targets = db.prepare(`SELECT * FROM shoutout_targets WHERE post_id IN (${marks})`).all(...ids);
    const reacts = db.prepare(`SELECT post_id, kind, COUNT(*) n FROM reactions WHERE post_id IN (${marks}) GROUP BY post_id, kind`).all(...ids);
    const mine = db.prepare(`SELECT post_id, kind FROM reactions WHERE user_id = ? AND post_id IN (${marks})`).all(viewer.id, ...ids);
    const reads = db.prepare(`SELECT post_id FROM post_reads WHERE user_id = ? AND post_id IN (${marks})`).all(viewer.id, ...ids);
    const counts = db.prepare(`SELECT post_id, COUNT(*) n FROM comments WHERE deleted_at IS NULL AND post_id IN (${marks}) GROUP BY post_id`).all(...ids);
    const latest = db.prepare(`SELECT * FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY id DESC) rn FROM comments c WHERE deleted_at IS NULL AND post_id IN (${marks})
      ) WHERE rn <= 2 ORDER BY id`).all(...ids);
    const userIds = [...rows.map((p) => p.author_id), ...latest.map((c) => c.author_id), ...targets.filter((t) => t.target_type === 'user').map((t) => t.target_id)];
    const users = shapes.usersByIds(userIds);
    const nameOf = (t) => {
      if (t.target_type === 'user') return users.get(t.target_id)?.name || 'Team member';
      return db.prepare(`SELECT name FROM ${t.target_type === 'salon' ? 'salons' : 'districts'} WHERE id = ?`).get(t.target_id)?.name || 'Team';
    };
    const by = (list, key = 'post_id') => list.reduce((m, x) => { (m.get(x[key]) || m.set(x[key], []).get(x[key])).push(x); return m; }, new Map());
    const tBy = by(targets), rBy = by(reacts), cBy = by(latest);
    const mineBy = new Map(mine.map((x) => [x.post_id, x.kind]));
    const readSet = new Set(reads.map((x) => x.post_id));
    const countBy = new Map(counts.map((x) => [x.post_id, x.n]));
    return rows.map((p) => {
      const reactions = { like: 0, clap: 0, love: 0, fire: 0 };
      for (const x of rBy.get(p.id) || []) reactions[x.kind] = x.n;
      return {
        id: p.id, kind: p.kind, body: p.body, image_url: p.image_url || null, created_at: p.created_at, edited_at: p.edited_at || null,
        pinned: !!(p.pinned_until && p.pinned_until > now),
        author: users.get(p.author_id) || null,
        audience: { type: p.audience_type, id: p.audience_id || null, label: audienceLabel(p.audience_type, p.audience_id) },
        targets: (tBy.get(p.id) || []).map((t) => ({ type: t.target_type, id: t.target_id, label: nameOf(t), value_key: t.value_key || null })),
        reactions, my_reaction: mineBy.get(p.id) || null,
        comment_count: countBy.get(p.id) || 0,
        latest_comments: (cBy.get(p.id) || []).map((c) => commentShape(c, users, viewer)),
        requires_read: p.kind === 'announcement',
        read_by_me: readSet.has(p.id),
        can_edit: p.author_id === viewer.id,
        can_delete: p.author_id === viewer.id || can(viewer, 'moderate'),
      };
    });
  }
  ctx.shapePosts = shapePosts;
  ctx.postVisibility = visibility;

  // ---- feed ---------------------------------------------------------------
  r.get('/feed', (req, res) => {
    const scope = v.oneOf(req.query.scope || 'company', 'scope', ['company', 'salon', 'shoutouts']);
    const limit = limitParam(req, 15, 40);
    const cur = decodeCursor(req.query.cursor);
    const vis = visibility(req.user);
    const where = ['p.deleted_at IS NULL', vis.sql];
    const params = [...vis.params];
    if (scope === 'shoutouts') where.push("p.kind = 'shoutout'");
    if (scope === 'salon') {
      const sid = req.user.salon_id;
      if (!sid) return res.json({ items: [], next_cursor: null });
      where.push(`((p.audience_type = 'salon' AND p.audience_id = ?)
        OR p.author_id IN (SELECT id FROM users WHERE salon_id = ?)
        OR p.id IN (SELECT post_id FROM shoutout_targets WHERE (target_type = 'salon' AND target_id = ?)
                    OR (target_type = 'user' AND target_id IN (SELECT id FROM users WHERE salon_id = ?))))`);
      params.push(sid, sid, sid, sid);
    }
    if (cur) {
      if (typeof cur.t !== 'string' || !Number.isInteger(cur.i)) throw bad('That page link is no longer valid.');
      where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))');
      params.push(cur.t, cur.t, cur.i);
    }
    const rows = db.prepare(`SELECT p.* FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({ items: shapePosts(page, req.user), next_cursor: rows.length > limit ? encodeCursor({ t: last.created_at, i: last.id }) : null });
  });

  r.get('/feed/sidebar', (req, res) => {
    const vis = visibility(req.user);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const top = db.prepare(`SELECT t.target_id AS id, COUNT(*) n FROM shoutout_targets t JOIN posts p ON p.id = t.post_id
      WHERE t.target_type = 'user' AND p.deleted_at IS NULL AND p.created_at >= ? GROUP BY t.target_id ORDER BY n DESC, t.target_id LIMIT 5`).all(since);
    const users = shapes.usersByIds(top.map((x) => x.id));

    // Birthdays and work anniversaries in the next two weeks; the caller's own salon first.
    const today = todayLocal();
    const days = Array.from({ length: 15 }, (_, i) => addDays(today, i));
    const mds = days.map((d) => d.slice(5));
    const people = db.prepare(`SELECT id, salon_id, hire_date, birthday_md FROM users WHERE status = 'active'
      AND (birthday_md IN (${mds.map(() => '?').join(',')}) OR substr(hire_date, 6) IN (${mds.map(() => '?').join(',')}))`).all(...mds, ...mds);
    let celebrations = [];
    for (const p of people) {
      if (p.birthday_md && mds.includes(p.birthday_md)) celebrations.push({ id: p.id, salon_id: p.salon_id, kind: 'birthday', label: 'Birthday', on: days[mds.indexOf(p.birthday_md)] });
      if (p.hire_date && mds.includes(p.hire_date.slice(5))) {
        const on = days[mds.indexOf(p.hire_date.slice(5))];
        const years = Number(on.slice(0, 4)) - Number(p.hire_date.slice(0, 4));
        if (years >= 1) celebrations.push({ id: p.id, salon_id: p.salon_id, kind: 'anniversary', label: `${years} year${years === 1 ? '' : 's'} with the team`, on });
      }
    }
    celebrations.sort((a, b) => (b.salon_id === req.user.salon_id) - (a.salon_id === req.user.salon_id) || a.on.localeCompare(b.on) || a.id - b.id);
    celebrations = celebrations.slice(0, 8);
    const cUsers = shapes.usersByIds(celebrations.map((c) => c.id));

    const pinned = db.prepare(`SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.pinned_until > ? AND ${vis.sql} ORDER BY p.created_at DESC LIMIT 5`).all(nowIso(), ...vis.params);
    res.json({
      top_recognized: top.map((x) => ({ user: users.get(x.id), count: x.n })).filter((x) => x.user),
      celebrations: celebrations.map((c) => ({ user: cUsers.get(c.id), kind: c.kind, label: c.label, on: c.on })).filter((c) => c.user),
      pinned: shapePosts(pinned, req.user),
    });
  });

  r.get('/mentions', (req, res) => {
    const q = v.str(req.query.q, 'Search', { max: 60, required: false }) || '';
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const rows = db.prepare(`SELECT id FROM users WHERE status = 'active' AND id != ?
      AND (first_name || ' ' || last_name) LIKE ? ESCAPE '\\' ORDER BY (salon_id IS ?) DESC, first_name, last_name LIMIT 8`).all(req.user.id, like, req.user.salon_id);
    const users = shapes.usersByIds(rows.map((x) => x.id));
    const salons = db.prepare(`SELECT id, name, salon_number FROM salons WHERE status = 'active'
      AND (name LIKE ? ESCAPE '\\' OR salon_number LIKE ? ESCAPE '\\') ORDER BY name LIMIT 6`).all(like, like);
    res.json({ users: rows.map((x) => users.get(x.id)), salons });
  });

  // ---- posts --------------------------------------------------------------
  /** Checks the caller may address this audience with this kind of post. Returns the audience id to store. */
  function checkAudience(user, kind, type, rawId) {
    const home = HOME_OFFICE.includes(user.role);
    if (kind === 'announcement' && !can(user, 'post.announce')) throw forbidden('Announcements are posted by managers and leadership.');
    if (type === 'company') {
      if (kind === 'announcement' && !home) throw forbidden('Company-wide announcements come from the home office.');
      return null;
    }
    const id = v.int(rawId, 'Audience', { min: 1 });
    const table = { market: 'markets', district: 'districts', salon: 'salons' }[type];
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw bad('Choose who should see this post.');
    if (home) return id;
    const own = type === 'salon'
      ? (user.role === 'district_leader' ? rbac.salonInScope(user, id) : user.salon_id === id)
      : type === 'district' ? rbac.userDistrictId(user) === id : rbac.userMarketId(user) === id;
    if (!own) throw forbidden('You can post to your own salon, district or market, or to everyone.');
    if (kind === 'announcement' && user.role === 'salon_manager' && type !== 'salon') throw forbidden('Salon managers can post announcements to their own salon.');
    if (kind === 'announcement' && type === 'market') throw forbidden('Market announcements come from the home office.');
    return id;
  }

  r.post('/posts', (req, res) => {
    const b = req.body || {};
    const kind = v.oneOf(b.kind || 'post', 'Post type', KINDS);
    const body = v.str(b.body, 'Your post', { max: 4000 });
    const type = v.oneOf(b.audience_type || 'company', 'Audience', AUDIENCES);
    const audienceId = checkAudience(req.user, kind, type, b.audience_id);
    const image = v.url(b.image_url, 'Photo');
    let pinnedUntil = null;
    if (b.pin_days !== undefined && b.pin_days !== null && b.pin_days !== '') {
      if (!can(req.user, 'post.announce')) throw forbidden('Only managers and leadership can pin a post.');
      const days = v.int(b.pin_days, 'Pin length', { min: 1, max: 30 });
      pinnedUntil = new Date(Date.now() + days * 86400000).toISOString();
    }
    const values = new Set(ctx.publicSettings().values.map((x) => x.key));
    const targets = [];
    if (b.targets !== undefined && b.targets !== null) {
      if (!Array.isArray(b.targets) || b.targets.length > 12) throw bad('Choose up to 12 people or teams to recognise.');
      const seen = new Set();
      for (const t of b.targets) {
        const tt = v.oneOf(t?.type, 'Shout-out target', ['user', 'salon', 'district']);
        const tid = v.int(t?.id, 'Shout-out target', { min: 1 });
        const vk = v.str(t?.value_key, 'Value', { max: 40, required: false });
        if (vk && !values.has(vk)) throw bad('That value is not one of ours.');
        const table = { user: 'users', salon: 'salons', district: 'districts' }[tt];
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(tid)) throw bad('We could not find one of the people or teams you tagged.');
        if (tt === 'user' && tid === req.user.id) throw bad('Shout-outs are for teammates. Pick someone else to recognise.');
        if (seen.has(`${tt}:${tid}`)) continue;
        seen.add(`${tt}:${tid}`);
        targets.push({ tt, tid, vk });
      }
    }
    if (kind === 'shoutout' && !targets.length) throw bad('Choose who you are recognising.');
    const now = nowIso();
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO posts (author_id, kind, body, audience_type, audience_id, pinned_until, image_url, created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, kind, body, type, audienceId, pinnedUntil, image, now);
      const pid = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO shoutout_targets (post_id, target_type, target_id, value_key) VALUES (?,?,?,?)');
      for (const t of targets) ins.run(pid, t.tt, t.tid, t.vk);
      return pid;
    })();
    const me = shapes.userById(req.user.id);
    for (const t of targets) if (t.tt === 'user') notify(t.tid, 'shoutout', `${me.name} gave you a shout-out`, body.slice(0, 140), '/');
    if (kind === 'announcement') audit(req, 'post.announcement', 'post', id, { audience_type: type, audience_id: audienceId });
    res.json({ post: shapePosts([db.prepare('SELECT * FROM posts WHERE id = ?').get(id)], req.user)[0] });
  });

  r.patch('/posts/:id', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    if (post.author_id !== req.user.id) throw forbidden('You can edit your own posts.');
    const body = v.str(req.body?.body, 'Your post', { max: 4000 });
    db.prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), post.id);
    res.json({ post: shapePosts([db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id)], req.user)[0] });
  });

  r.delete('/posts/:id', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    const own = post.author_id === req.user.id;
    if (!own && !can(req.user, 'moderate')) throw forbidden('You can remove your own posts.');
    db.prepare('UPDATE posts SET deleted_at = ? WHERE id = ?').run(nowIso(), post.id);
    if (!own) audit(req, 'post.removed', 'post', post.id, { author_id: post.author_id });
    res.json({ ok: true });
  });

  r.post('/posts/:id/react', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    const kind = v.oneOf(req.body?.kind, 'Reaction', REACTIONS, { required: false });
    if (!kind) db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    else db.prepare(`INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?,?,?,?)
      ON CONFLICT(post_id, user_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at`).run(post.id, req.user.id, kind, nowIso());
    const reactions = { like: 0, clap: 0, love: 0, fire: 0 };
    for (const x of db.prepare('SELECT kind, COUNT(*) n FROM reactions WHERE post_id = ? GROUP BY kind').all(post.id)) reactions[x.kind] = x.n;
    res.json({ reactions, my_reaction: kind || null });
  });

  r.post('/posts/:id/read', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    db.prepare('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?,?,?)').run(post.id, req.user.id, nowIso());
    res.json({ ok: true });
  });

  r.get('/posts/:id/comments', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    const rows = db.prepare('SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 500').all(post.id);
    const users = shapes.usersByIds(rows.map((c) => c.author_id));
    res.json({ items: rows.map((c) => commentShape(c, users, req.user)) });
  });

  r.post('/posts/:id/comments', (req, res) => {
    const post = getVisiblePost(req.user, idParam(req));
    const body = v.str(req.body?.body, 'Your comment', { max: 2000 });
    const info = db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?,?)').run(post.id, req.user.id, body, nowIso());
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
    const users = shapes.usersByIds([c.author_id]);
    if (post.author_id !== req.user.id) notify(post.author_id, 'comment', `${users.get(c.author_id).name} commented on your post`, body.slice(0, 140), '/');
    res.json({ comment: commentShape(c, users, req.user) });
  });

  r.delete('/comments/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(idParam(req));
    if (!c) throw notFound('That comment is no longer available.');
    getVisiblePost(req.user, c.post_id);
    const own = c.author_id === req.user.id;
    if (!own && !can(req.user, 'moderate')) throw forbidden('You can remove your own comments.');
    db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(nowIso(), c.id);
    if (!own) audit(req, 'comment.removed', 'comment', c.id, { author_id: c.author_id });
    res.json({ ok: true });
  });

  r.post('/reports', (req, res) => {
    const b = req.body || {};
    const reason = v.str(b.reason, 'Reason', { max: 500 });
    const postId = v.int(b.post_id, 'Post', { min: 1, required: false });
    const commentId = v.int(b.comment_id, 'Comment', { min: 1, required: false });
    if (!postId === !commentId) throw bad('Tell us which post or comment you are reporting.');
    if (postId) getVisiblePost(req.user, postId);
    else {
      const c = db.prepare('SELECT post_id FROM comments WHERE id = ? AND deleted_at IS NULL').get(commentId);
      if (!c) throw notFound('That comment is no longer available.');
      getVisiblePost(req.user, c.post_id);
    }
    const info = db.prepare("INSERT INTO reports (post_id, comment_id, reporter_id, reason, status, created_at) VALUES (?,?,?,?, 'open', ?)")
      .run(postId, commentId, req.user.id, reason, nowIso());
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  return r;
};

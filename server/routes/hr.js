'use strict';
const express = require('express');
const { can } = require('../rbac');
const { v, forbidden, notFound, idParam, nowIso, todayLocal } = require('../util');

const CATEGORIES = ['pay', 'schedule', 'benefits', 'leave', 'concern', 'other'];
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const SECTIONS = ['brand', 'products', 'policies', 'ops', 'hr'];

module.exports = (ctx) => {
  const { db, shapes, audit, notify } = ctx;
  const r = express.Router();

  // ---- HR inquiries: visible only to the author, HR and admins ------------
  const isHr = (user) => can(user, 'hr.inbox');
  function getInquiry(req) {
    const q = db.prepare('SELECT * FROM hr_inquiries WHERE id = ?').get(idParam(req));
    // Same answer whether it does not exist or is not yours.
    if (!q || (q.author_id !== req.user.id && !isHr(req.user))) throw notFound('We could not find that inquiry.');
    return q;
  }
  function shapeInquiries(rows) {
    const users = shapes.usersByIds(rows.flatMap((q) => [q.author_id, q.assignee_id]).filter(Boolean));
    return rows.map((q) => ({
      id: q.id, category: q.category, subject: q.subject, body: q.body, status: q.status,
      author: users.get(q.author_id) || null, assignee: q.assignee_id ? users.get(q.assignee_id) || null : null,
      created_at: q.created_at, updated_at: q.updated_at,
    }));
  }
  function detail(q) {
    const msgs = db.prepare('SELECT * FROM hr_messages WHERE inquiry_id = ? ORDER BY id').all(q.id);
    const users = shapes.usersByIds(msgs.map((m) => m.author_id));
    return { inquiry: shapeInquiries([q])[0], messages: msgs.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, author: users.get(m.author_id) || null })) };
  }

  r.get('/hr/inquiries', (req, res) => {
    const mineOnly = !isHr(req.user) || req.query.mine === '1';
    const status = v.str(req.query.status, 'status', { max: 20, required: false });
    const where = [];
    const params = [];
    if (mineOnly) { where.push('author_id = ?'); params.push(req.user.id); }
    if (status === 'active') where.push("status IN ('open','in_progress','waiting')");
    else if (status) { where.push('status = ?'); params.push(v.oneOf(status, 'status', STATUSES)); }
    const rows = db.prepare(`SELECT * FROM hr_inquiries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC LIMIT 300`).all(...params);
    res.json({ items: shapeInquiries(rows) });
  });

  r.post('/hr/inquiries', (req, res) => {
    const b = req.body || {};
    const category = v.oneOf(b.category, 'Topic', CATEGORIES);
    const subject = v.str(b.subject, 'Subject', { max: 140 });
    const body = v.str(b.body, 'Your message', { max: 6000 });
    const now = nowIso();
    const info = db.prepare("INSERT INTO hr_inquiries (author_id, category, subject, body, status, created_at, updated_at) VALUES (?,?,?,?, 'open', ?, ?)")
      .run(req.user.id, category, subject, body, now, now);
    const id = Number(info.lastInsertRowid);
    // Notify HR without putting the subject line in the notification.
    for (const h of db.prepare("SELECT id FROM users WHERE role = 'hr' AND status = 'active'").all()) notify(h.id, 'hr', 'New HR inquiry', `Topic: ${category}`, `/hr/${id}`);
    audit(req, 'hr.inquiry_created', 'hr_inquiry', id, { category });
    res.json(detail(db.prepare('SELECT * FROM hr_inquiries WHERE id = ?').get(id)));
  });

  r.get('/hr/inquiries/:id', (req, res) => {
    const q = getInquiry(req);
    if (q.author_id !== req.user.id) audit(req, 'hr.inquiry_viewed', 'hr_inquiry', q.id);
    res.json(detail(q));
  });

  r.post('/hr/inquiries/:id/messages', (req, res) => {
    const q = getInquiry(req);
    const b = req.body || {};
    const statusTo = v.oneOf(b.status_to, 'Status', STATUSES, { required: false });
    if (statusTo && !isHr(req.user) && !(statusTo === 'closed' && q.author_id === req.user.id)) throw forbidden('HR updates the status of an inquiry.');
    const body = v.str(b.body, 'Your message', { max: 6000, required: !statusTo });
    const now = nowIso();
    db.transaction(() => {
      if (body) db.prepare('INSERT INTO hr_messages (inquiry_id, author_id, body, created_at) VALUES (?,?,?,?)').run(q.id, req.user.id, body, now);
      const hrReply = isHr(req.user) && q.author_id !== req.user.id;
      db.prepare('UPDATE hr_inquiries SET status = ?, updated_at = ?, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?')
        .run(statusTo || (hrReply && q.status === 'open' ? 'in_progress' : q.status), now, hrReply ? req.user.id : null, q.id);
    })();
    if (q.author_id !== req.user.id) {
      notify(q.author_id, 'hr', 'HR replied to your inquiry', null, `/hr/${q.id}`);
      audit(req, 'hr.inquiry_reply', 'hr_inquiry', q.id, { status_to: statusTo || null });
    } else if (q.assignee_id) notify(q.assignee_id, 'hr', 'New message on an HR inquiry', null, `/hr/${q.id}`);
    res.json(detail(db.prepare('SELECT * FROM hr_inquiries WHERE id = ?').get(q.id)));
  });

  // ---- resources and acknowledgements -------------------------------------
  r.get('/resources', (req, res) => {
    const section = v.oneOf(req.query.section, 'section', SECTIONS, { required: false });
    const rows = db.prepare(`SELECT r.id, r.section, r.category, r.title, r.summary, r.file_url, r.image_url, r.sort, r.requires_ack, r.updated_at, a.acknowledged_at
      FROM resources r LEFT JOIN acknowledgements a ON a.resource_id = r.id AND a.user_id = ?
      ${section ? 'WHERE r.section = ?' : ''} ORDER BY r.section, r.sort, r.id`).all(...(section ? [req.user.id, section] : [req.user.id]));
    res.json({ items: rows.map((x) => ({ ...x, requires_ack: !!x.requires_ack, acknowledged_at: x.acknowledged_at || null })) });
  });

  r.get('/resources/:id', (req, res) => {
    const x = db.prepare(`SELECT r.*, a.acknowledged_at FROM resources r LEFT JOIN acknowledgements a ON a.resource_id = r.id AND a.user_id = ? WHERE r.id = ?`).get(req.user.id, idParam(req));
    if (!x) throw notFound('We could not find that page.');
    res.json({ resource: { ...x, requires_ack: !!x.requires_ack, acknowledged_at: x.acknowledged_at || null } });
  });

  r.post('/resources/:id/ack', (req, res) => {
    const x = db.prepare('SELECT id, requires_ack FROM resources WHERE id = ?').get(idParam(req));
    if (!x) throw notFound('We could not find that page.');
    const now = nowIso();
    db.prepare('INSERT OR IGNORE INTO acknowledgements (resource_id, user_id, acknowledged_at) VALUES (?,?,?)').run(x.id, req.user.id, now);
    const at = db.prepare('SELECT acknowledged_at FROM acknowledgements WHERE resource_id = ? AND user_id = ?').get(x.id, req.user.id).acknowledged_at;
    audit(req, 'resource.acknowledged', 'resource', x.id);
    res.json({ acknowledged_at: at });
  });

  // ---- what needs my attention --------------------------------------------
  r.get('/me/todo', (req, res) => {
    const items = [];
    const acks = db.prepare(`SELECT r.id, r.title, r.section FROM resources r
      WHERE r.requires_ack = 1 AND NOT EXISTS (SELECT 1 FROM acknowledgements a WHERE a.resource_id = r.id AND a.user_id = ?) ORDER BY r.sort, r.id LIMIT 20`).all(req.user.id);
    for (const a of acks) items.push({ kind: 'ack', title: `Read and acknowledge: ${a.title}`, link: `/standards/${a.id}`, due_on: null });
    const vis = ctx.postVisibility(req.user);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const unread = db.prepare(`SELECT p.id, p.body FROM posts p WHERE p.kind = 'announcement' AND p.deleted_at IS NULL AND p.created_at >= ? AND p.author_id != ? AND ${vis.sql}
      AND NOT EXISTS (SELECT 1 FROM post_reads x WHERE x.post_id = p.id AND x.user_id = ?) ORDER BY p.created_at DESC LIMIT 10`).all(since, req.user.id, ...vis.params, req.user.id);
    for (const p of unread) items.push({ kind: 'announcement', title: p.body.split('\n')[0].slice(0, 90), link: '/', due_on: null });
    if (req.user.salon_id && req.user.role !== 'hr') {
      const today = todayLocal();
      const open = db.prepare(`SELECT t.name FROM checklist_templates t WHERE t.active = 1 AND t.key IN ('open','close')
        AND NOT EXISTS (SELECT 1 FROM checklist_runs x WHERE x.template_id = t.id AND x.salon_id = ? AND x.date = ? AND x.completed_at IS NOT NULL) ORDER BY t.id`).all(req.user.salon_id, today);
      for (const c of open) items.push({ kind: 'checklist', title: `${c.name} for today`, link: '/operations', due_on: today });
    }
    res.json({ items });
  });

  return r;
};

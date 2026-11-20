'use strict';
const express = require('express');
const { can, canChecklists } = require('../rbac');
const { v, forbidden, notFound, idParam, nowIso, todayLocal } = require('../util');

const SECTIONS = ['brand', 'products', 'policies', 'ops', 'hr'];

module.exports = (ctx) => {
  const { db, shapes, audit, notify } = ctx;
  const r = express.Router();

  // ---- Ask HR (v1.1) -------------------------------------------------------
  // A private inquiry goes straight to the HR inbox (settings.hr_inbox_email, HR@scsalons.com) by email.
  // The portal keeps only who wrote in, when, and when they acknowledged the receipt: no message content,
  // no open / resolved status, no replies, and nothing is ever sent to the employee. HR contacts them
  // directly. While the content waits for delivery it sits in hr_outbox, readable only by HR and admins.
  const isHr = (user) => can(user, 'hr.inbox');
  const relay = ctx.hrRelay;

  r.get('/hr/inquiries', (req, res) => {
    if (!isHr(req.user)) {
      const rows = db.prepare('SELECT id, created_at, acknowledged_at FROM hr_submissions WHERE author_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
      return res.json({ items: rows });
    }
    const rows = db.prepare('SELECT * FROM hr_submissions ORDER BY id DESC LIMIT 300').all();
    const users = shapes.usersByIds(rows.map((x) => x.author_id));
    const waiting = db.prepare('SELECT o.submission_id, o.subject, o.body, o.attempts, o.created_at, h.author_id FROM hr_outbox o JOIN hr_submissions h ON h.id = o.submission_id ORDER BY o.submission_id').all();
    const wUsers = shapes.usersByIds(waiting.map((x) => x.author_id));
    // A configured relay clears the outbox within minutes (the retry runs every five). Waiting longer
    // than half an hour means delivery is failing, so the inbox says so. Waiting in manual mode is
    // by design and never counts as stuck.
    const STUCK_AFTER_MINUTES = 30;
    const oldest = waiting.reduce((a, x) => (!a || x.created_at < a ? x.created_at : a), null);
    const oldestWaitingMin = oldest ? Math.round((Date.now() - Date.parse(oldest)) / 60000) : null;
    const stuck = relay.configured() && oldestWaitingMin !== null && oldestWaitingMin >= STUCK_AFTER_MINUTES;
    res.json({
      delivery: { configured: relay.configured(), stuck, oldest_waiting_minutes: oldestWaitingMin, to: relay.to() },
      waiting: waiting.map((x) => ({ id: x.submission_id, subject: x.subject, body: x.body, attempts: x.attempts, created_at: x.created_at, author: wUsers.get(x.author_id) || null })),
      items: rows.map((x) => ({ id: x.id, author: users.get(x.author_id) || null, created_at: x.created_at, acknowledged_at: x.acknowledged_at, delivered_at: x.delivered_at, delivery: x.delivery })),
    });
  });

  r.post('/hr/inquiries', (req, res) => {
    const b = req.body || {};
    const subject = v.str(b.subject, 'Subject', { max: 140 });
    const body = v.str(b.body, 'Your message', { max: 6000 });
    const now = nowIso();
    const id = db.transaction(() => {
      const info = db.prepare('INSERT INTO hr_submissions (author_id, created_at) VALUES (?, ?)').run(req.user.id, now);
      const sid = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO hr_outbox (submission_id, subject, body, created_at) VALUES (?,?,?,?)').run(sid, subject, body, now);
      return sid;
    })();
    // HR hears that something arrived, never what it says.
    for (const u of db.prepare("SELECT id FROM users WHERE role IN ('hr','admin') AND status = 'active'").all()) {
      if (u.id !== req.user.id && !relay.configured()) notify(u.id, 'hr', 'A private HR inquiry is waiting', null, '/hr');
    }
    audit(req, 'hr.inquiry_submitted', 'hr_submission', id);
    relay.flush().catch(() => {});
    res.json({ submission: { id, created_at: now, acknowledged_at: null } });
  });

  // The employee confirms they saw the receipt. Only the author can acknowledge.
  r.post('/hr/inquiries/:id/acknowledge', (req, res) => {
    const x = db.prepare('SELECT * FROM hr_submissions WHERE id = ?').get(idParam(req));
    if (!x || x.author_id !== req.user.id) throw notFound('We could not find that inquiry.');
    const at = x.acknowledged_at || nowIso();
    db.prepare('UPDATE hr_submissions SET acknowledged_at = ? WHERE id = ?').run(at, x.id);
    audit(req, 'hr.inquiry_acknowledged', 'hr_submission', x.id);
    res.json({ submission: { id: x.id, created_at: x.created_at, acknowledged_at: at } });
  });

  // HR copied a waiting message into the HR inbox by hand: delete it from the portal.
  r.post('/hr/outbox/:id/moved', (req, res) => {
    if (!isHr(req.user)) throw notFound('We could not find that inquiry.');
    const id = idParam(req);
    if (!db.prepare('SELECT 1 FROM hr_outbox WHERE submission_id = ?').get(id)) throw notFound('That message has already been moved.');
    relay.markDelivered(id, 'manual', req.user.id);
    res.json({ ok: true });
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
    if (req.user.salon_id && canChecklists(req.user)) {
      const today = todayLocal();
      const open = db.prepare(`SELECT t.name FROM checklist_templates t WHERE t.active = 1 AND t.key IN ('open','close')
        AND NOT EXISTS (SELECT 1 FROM checklist_runs x WHERE x.template_id = t.id AND x.salon_id = ? AND x.date = ? AND x.completed_at IS NOT NULL) ORDER BY t.id`).all(req.user.salon_id, today);
      for (const c of open) items.push({ kind: 'checklist', title: `${c.name} for today`, link: '/operations', due_on: today });
    }
    res.json({ items });
  });

  return r;
};

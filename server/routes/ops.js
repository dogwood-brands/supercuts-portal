'use strict';
const express = require('express');
const { can, isManagerPlus, HOME_OFFICE } = require('../rbac');
const { v, bad, forbidden, notFound, idParam, nowIso, todayLocal, addDays, json } = require('../util');

const CATEGORIES = ['it', 'facilities', 'supplies', 'marketing'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

module.exports = (ctx) => {
  const { db, rbac, shapes, kpi, audit, notify } = ctx;
  const r = express.Router();

  // ---- checklists ---------------------------------------------------------
  function salonForRequest(req, raw) {
    const id = v.int(raw ?? req.user.salon_id, 'Salon', { min: 1 });
    if (!db.prepare('SELECT 1 FROM salons WHERE id = ?').get(id)) throw notFound('We could not find that salon.');
    rbac.requireSalonScope(req.user, id);
    return id;
  }

  r.get('/checklists', (req, res) => {
    const salonId = salonForRequest(req, req.query.salon_id);
    const date = v.date(req.query.date, 'date', { required: false }) || todayLocal();
    const templates = db.prepare('SELECT * FROM checklist_templates WHERE active = 1 ORDER BY id').all();
    const runs = new Map(db.prepare('SELECT * FROM checklist_runs WHERE salon_id = ? AND date = ?').all(salonId, date).map((x) => [x.template_id, x]));
    const users = shapes.usersByIds([...runs.values()].map((x) => x.completed_by).filter(Boolean));
    res.json({
      salon_id: salonId, date,
      items: templates.map((t) => {
        const run = runs.get(t.id);
        return {
          template: { id: t.id, key: t.key, name: t.name, items: json(t.items_json, []) },
          run: { done: run ? json(run.done_json, []) : [], completed_at: run?.completed_at || null, completed_by: run?.completed_by ? users.get(run.completed_by) || null : null },
        };
      }),
    });
  });

  r.put('/checklists/:templateId/run', (req, res) => {
    const t = db.prepare('SELECT * FROM checklist_templates WHERE id = ? AND active = 1').get(idParam(req, 'templateId'));
    if (!t) throw notFound('We could not find that checklist.');
    const b = req.body || {};
    const salonId = salonForRequest(req, b.salon_id);
    const date = v.date(b.date, 'Date', { required: false }) || todayLocal();
    const today = todayLocal();
    if (date > today || date < addDays(today, -7)) throw bad('Checklists can be updated for today and the past week.');
    if (!Array.isArray(b.done)) throw bad('Send the list of completed items.');
    const valid = new Set(json(t.items_json, []).map((i) => String(i.id)));
    const done = [...new Set(b.done.map(String))].filter((i) => valid.has(i));
    const complete = v.bool(b.complete);
    if (complete && !isManagerPlus(req.user)) throw forbidden('A manager signs off the checklist once every item is done.');
    if (complete && done.length < valid.size) throw bad('Finish every item before signing off.');
    const existing = db.prepare('SELECT * FROM checklist_runs WHERE template_id = ? AND salon_id = ? AND date = ?').get(t.id, salonId, date);
    const completedAt = complete ? existing?.completed_at || nowIso() : null;
    const completedBy = complete ? existing?.completed_by || req.user.id : null;
    db.prepare(`INSERT INTO checklist_runs (template_id, salon_id, date, done_json, completed_by, completed_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(template_id, salon_id, date) DO UPDATE SET done_json = excluded.done_json, completed_by = excluded.completed_by, completed_at = excluded.completed_at`)
      .run(t.id, salonId, date, JSON.stringify(done), completedBy, completedAt);
    if (complete !== !!existing?.completed_at) kpi.invalidate();
    res.json({ run: { done, completed_at: completedAt, completed_by: completedBy ? shapes.userById(completedBy) : null } });
  });

  // ---- tickets ------------------------------------------------------------
  /** Tickets a user can see: leadership all, district leaders their district, managers their salon, everyone their own. */
  function ticketVisibility(user) {
    if (user.role === 'admin' || user.role === 'executive') return { sql: '1=1', params: [] };
    const parts = ['t.author_id = ?'];
    const params = [user.id];
    if (isManagerPlus(user) && user.role !== 'hr') {
      const ids = rbac.scopeSalonIds(user);
      if (ids.length) { parts.push(`t.salon_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    }
    return { sql: `(${parts.join(' OR ')})`, params };
  }
  const canWork = (user, t) => can(user, 'tickets.work') && rbac.salonInScope(user, t.salon_id);

  function shapeTickets(rows) {
    const users = shapes.usersByIds(rows.flatMap((t) => [t.author_id, t.assignee_id]).filter(Boolean));
    const salons = new Map(db.prepare('SELECT id, name, salon_number FROM salons').all().map((s) => [s.id, s]));
    return rows.map((t) => ({
      id: t.id, category: t.category, subject: t.subject, body: t.body, priority: t.priority, status: t.status,
      salon: salons.get(t.salon_id) || null, author: users.get(t.author_id) || null, assignee: t.assignee_id ? users.get(t.assignee_id) || null : null,
      created_at: t.created_at, updated_at: t.updated_at,
    }));
  }

  r.get('/tickets', (req, res) => {
    const vis = ticketVisibility(req.user);
    const where = [vis.sql];
    const params = [...vis.params];
    const status = v.str(req.query.status, 'status', { max: 20, required: false });
    if (status === 'active') where.push("t.status IN ('open','in_progress','waiting')");
    else if (status) { where.push('t.status = ?'); params.push(v.oneOf(status, 'status', STATUSES)); }
    const salonId = v.int(req.query.salon_id, 'salon_id', { min: 1, required: false });
    if (salonId) { where.push('t.salon_id = ?'); params.push(salonId); }
    const rows = db.prepare(`SELECT t.* FROM tickets t WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC, t.id DESC LIMIT 300`).all(...params);
    res.json({ items: shapeTickets(rows) });
  });

  r.post('/tickets', (req, res) => {
    const b = req.body || {};
    const salonId = salonForRequest(req, b.salon_id);
    const category = v.oneOf(b.category, 'Category', CATEGORIES);
    const subject = v.str(b.subject, 'Subject', { max: 140 });
    const body = v.str(b.body, 'Details', { max: 4000 });
    const priority = v.oneOf(b.priority || 'normal', 'Priority', PRIORITIES);
    const now = nowIso();
    const info = db.prepare(`INSERT INTO tickets (salon_id, author_id, category, subject, body, priority, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?, 'open', ?, ?)`).run(salonId, req.user.id, category, subject, body, priority, now, now);
    const id = Number(info.lastInsertRowid);
    const leader = db.prepare('SELECT d.leader_user_id AS id FROM salons s JOIN districts d ON d.id = s.district_id WHERE s.id = ?').get(salonId);
    if (leader?.id && leader.id !== req.user.id) notify(leader.id, 'ticket', `New ${category} ticket`, subject, `/tickets/${id}`);
    res.json({ ticket: shapeTickets([db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)])[0] });
  });

  function getTicket(req) {
    const vis = ticketVisibility(req.user);
    const t = db.prepare(`SELECT t.* FROM tickets t WHERE t.id = ? AND ${vis.sql}`).get(idParam(req), ...vis.params);
    if (!t) throw notFound('We could not find that ticket.');
    return t;
  }
  function ticketDetail(t, user) {
    const events = db.prepare('SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id').all(t.id);
    const users = shapes.usersByIds(events.map((e) => e.author_id));
    return {
      ticket: { ...shapeTickets([t])[0], can_work: canWork(user, t), can_close: canWork(user, t) || t.author_id === user.id || (user.role === 'salon_manager' && user.salon_id === t.salon_id) },
      events: events.map((e) => ({ id: e.id, body: e.body, status_to: e.status_to, created_at: e.created_at, author: users.get(e.author_id) || null })),
    };
  }

  r.get('/tickets/:id', (req, res) => res.json(ticketDetail(getTicket(req), req.user)));

  r.post('/tickets/:id/events', (req, res) => {
    const t = getTicket(req);
    if (req.user.role === 'executive') throw forbidden('Leadership has a read-only view of tickets.');
    const b = req.body || {};
    const statusTo = v.oneOf(b.status_to, 'Status', STATUSES, { required: false });
    const body = v.str(b.body, 'Your update', { max: 4000, required: !statusTo }) || '';
    if (statusTo && statusTo !== t.status) {
      const closer = t.author_id === req.user.id || (req.user.role === 'salon_manager' && req.user.salon_id === t.salon_id);
      if (!canWork(req.user, t) && !(closer && (statusTo === 'closed' || statusTo === 'open'))) throw forbidden('Only the team working this ticket can change its status.');
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare('INSERT INTO ticket_events (ticket_id, author_id, body, status_to, created_at) VALUES (?,?,?,?,?)').run(t.id, req.user.id, body, statusTo && statusTo !== t.status ? statusTo : null, now);
      db.prepare('UPDATE tickets SET status = ?, updated_at = ?, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?')
        .run(statusTo || t.status, now, canWork(req.user, t) ? req.user.id : null, t.id);
    })();
    if (t.author_id !== req.user.id) notify(t.author_id, 'ticket', `Update on "${t.subject.slice(0, 60)}"`, body.slice(0, 140) || `Status: ${statusTo}`, `/tickets/${t.id}`);
    res.json(ticketDetail(db.prepare('SELECT * FROM tickets WHERE id = ?').get(t.id), req.user));
  });

  // ---- operations calendar ------------------------------------------------
  r.get('/events', (req, res) => {
    const today = todayLocal();
    const from = v.date(req.query.from, 'from', { required: false }) || `${today.slice(0, 7)}-01`;
    const to = v.date(req.query.to, 'to', { required: false }) || addDays(from, 62);
    const u = req.user;
    const rows = db.prepare('SELECT * FROM events WHERE starts_on <= ? AND COALESCE(ends_on, starts_on) >= ? ORDER BY starts_on, id LIMIT 500').all(to, from)
      .filter((e) => {
        if (e.audience_type === 'company' || HOME_OFFICE.includes(u.role)) return true;
        if (e.audience_type === 'salon') return rbac.salonInScope(u, e.audience_id) || u.salon_id === e.audience_id;
        if (e.audience_type === 'district') return rbac.userDistrictId(u) === e.audience_id;
        return rbac.userMarketId(u) === e.audience_id;
      });
    res.json({ items: rows.map((e) => ({ id: e.id, title: e.title, starts_on: e.starts_on, ends_on: e.ends_on, kind: e.kind, audience_type: e.audience_type, audience_id: e.audience_id })) });
  });

  return r;
};

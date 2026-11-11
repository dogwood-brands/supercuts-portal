'use strict';
const express = require('express');
const crypto = require('node:crypto');
const auth = require('../auth');
const { ROLES, RANK, can, requirePerm } = require('../rbac');
const { v, bad, forbidden, notFound, conflict, idParam, nowIso, todayLocal, addDays, json, encodeCursor, decodeCursor, limitParam, round1, HttpError } = require('../util');
const { USER_SELECT, publicUser } = require('../shape');
const { parseCsvObjects } = require('../import/csv');
const { importDsr } = require('../import/dsr');
const { USERNAME_RE } = require('./auth');

const likeArg = (q) => `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = (ctx) => {
  const { db, rbac, shapes, kpi, audit } = ctx;
  const r = express.Router();
  const bigJson = express.json({ limit: '8mb' });

  // Friendly aliases on writes: `hours` for salons.hours_json, `items` for checklist_templates.items_json.
  r.use('/admin/salons', (req, res, next) => { if (req.body && 'hours' in req.body && !('hours_json' in req.body)) req.body.hours_json = req.body.hours; next(); });

  r.use('/admin/checklist-templates', (req, res, next) => { if (req.body && 'items' in req.body) req.body.items_json = req.body.items; next(); });

  // ======================================================================
  // Users
  // ======================================================================
  const adminUser = (row) => ({
    ...publicUser(row), username: row.username, email: row.email || null, phone: row.phone || null, status: row.status,
    last_login_at: row.last_login_at || null, hire_date: row.hire_date || null, birthday_md: row.birthday_md || null,
    must_change_password: !!row.must_change_password, district_id: row.district_id || null, created_at: row.created_at,
  });

  /** HR manages field and HR accounts; only admins manage admin and executive accounts. */
  function assertCanManage(actor, role) {
    if (actor.role !== 'admin' && (role === 'admin' || role === 'executive')) throw forbidden('Only an administrator can manage leadership and administrator accounts.');
  }
  function uniqueUsername(first, last) {
    const base = `${first}.${last}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '').slice(0, 34) || 'user';
    const taken = db.prepare('SELECT 1 FROM users WHERE username = ?');
    if (base.length >= 3 && !taken.get(base)) return base;
    for (let i = 2; i < 1000; i++) if (!taken.get(`${base}${i}`)) return `${base}${i}`;
    return `${base}.${crypto.randomBytes(3).toString('hex')}`;
  }
  /** Validates the editable user fields that are present in `b`. Returns a column -> value map. */
  function userFields(b, { creating }) {
    const out = {};
    const has = (k) => creating || k in b;
    if (has('first_name')) out.first_name = v.str(b.first_name, 'First name', { max: 60 });
    if (has('last_name')) out.last_name = v.str(b.last_name, 'Last name', { max: 60 });
    if (has('role')) out.role = v.oneOf(b.role, 'Role', ROLES);
    if ('email' in b) {
      out.email = v.str(b.email, 'Email', { max: 160, required: false });
      if (out.email) { out.email = out.email.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw bad('That email address does not look right.'); }
    }
    if ('username' in b && b.username) {
      out.username = v.str(b.username, 'Username', { max: 40 }).toLowerCase();
      if (!USERNAME_RE.test(out.username)) throw bad('Usernames use 3 to 40 letters, numbers, dots, dashes or underscores.');
    }
    if ('title' in b) out.title = v.str(b.title, 'Title', { max: 80, required: false });
    if ('phone' in b) out.phone = v.str(b.phone, 'Phone', { max: 30, required: false });
    if ('bio' in b) out.bio = v.str(b.bio, 'Bio', { max: 500, required: false });
    if ('hire_date' in b) out.hire_date = v.date(b.hire_date, 'Hire date', { required: false });
    if ('birthday_md' in b) {
      out.birthday_md = v.str(b.birthday_md, 'Birthday', { max: 5, required: false });
      if (out.birthday_md && !MD_RE.test(out.birthday_md)) throw bad('Birthday must be month and day, like 03-14.');
    }
    if ('avatar_url' in b) out.avatar_url = v.url(b.avatar_url, 'Photo');
    if ('salon_id' in b) {
      out.salon_id = v.int(b.salon_id, 'Salon', { min: 1, required: false });
      if (out.salon_id && !db.prepare('SELECT 1 FROM salons WHERE id = ?').get(out.salon_id)) throw bad('We could not find that salon.');
    }
    if ('district_id' in b) {
      out.district_id = v.int(b.district_id, 'District', { min: 1, required: false });
      if (out.district_id && !db.prepare('SELECT 1 FROM districts WHERE id = ?').get(out.district_id)) throw bad('We could not find that district.');
    }
    if (!creating && 'status' in b) out.status = v.oneOf(b.status, 'Status', ['active', 'inactive']);
    return out;
  }
  /** Keeps salons.manager_user_id and districts.leader_user_id in step with the user's role. */
  function syncOrgLinks(userId) {
    const u = db.prepare('SELECT id, role, salon_id, district_id, status FROM users WHERE id = ?').get(userId);
    const activeManager = u.status === 'active' && u.role === 'salon_manager' && u.salon_id;
    db.prepare('UPDATE salons SET manager_user_id = NULL WHERE manager_user_id = ? AND (? = 0 OR id != ?)').run(u.id, activeManager ? 1 : 0, u.salon_id || 0);
    if (activeManager) db.prepare('UPDATE salons SET manager_user_id = ? WHERE id = ? AND manager_user_id IS NULL').run(u.id, u.salon_id);
    const activeLeader = u.status === 'active' && u.role === 'district_leader' && u.district_id;
    db.prepare('UPDATE districts SET leader_user_id = NULL WHERE leader_user_id = ? AND (? = 0 OR id != ?)').run(u.id, activeLeader ? 1 : 0, u.district_id || 0);
    if (activeLeader) db.prepare('UPDATE districts SET leader_user_id = ? WHERE id = ? AND leader_user_id IS NULL').run(u.id, u.district_id);
  }
  function requireSalonForRole(f) {
    if ((f.role === 'stylist' || f.role === 'salon_manager') && !f.salon_id) throw bad('Stylists and salon managers need a salon.');
  }

  r.get('/admin/users', requirePerm('admin.users'), (req, res) => {
    const q = v.str(req.query.q, 'Search', { max: 60, required: false });
    const role = v.oneOf(req.query.role, 'role', ROLES, { required: false });
    const salonId = v.int(req.query.salon_id, 'salon_id', { min: 1, required: false });
    const status = v.oneOf(req.query.status, 'status', ['active', 'inactive'], { required: false });
    const where = ['1=1'];
    const params = [];
    if (q) { where.push("((u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')"); params.push(likeArg(q), likeArg(q), likeArg(q)); }
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (salonId) { where.push('u.salon_id = ?'); params.push(salonId); }
    if (status) { where.push('u.status = ?'); params.push(status); }
    const total = db.prepare(`SELECT COUNT(*) n FROM users u WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db.prepare(`${USER_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.first_name, u.last_name LIMIT 1000`).all(...params);
    res.json({ items: rows.map(adminUser), total });
  });

  r.post('/admin/users', requirePerm('admin.users'), (req, res) => {
    const f = userFields(req.body || {}, { creating: true });
    assertCanManage(req.user, f.role);
    requireSalonForRole(f);
    const username = f.username || uniqueUsername(f.first_name, f.last_name);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('That username is taken. Try another.');
    if (f.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) throw conflict('Someone already uses that email address.');
    const temp = auth.generatePassword();
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO users (email, username, password_hash, must_change_password, role, first_name, last_name, title, salon_id, district_id,
          phone, avatar_url, hire_date, birthday_md, bio, status, created_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`)
        .run(f.email ?? null, username, auth.hashPassword(temp), f.role, f.first_name, f.last_name, f.title ?? null, f.salon_id ?? null, f.district_id ?? null,
          f.phone ?? null, f.avatar_url ?? null, f.hire_date ?? null, f.birthday_md ?? null, f.bio ?? null, nowIso());
      const uid = Number(info.lastInsertRowid);
      syncOrgLinks(uid);
      return uid;
    })();
    audit(req, 'user.created', 'user', id, { role: f.role, salon_id: f.salon_id ?? null });
    res.json({ user: adminUser(shapes.userRow(id)), temp_password: temp });
  });

  r.patch('/admin/users/:id', requirePerm('admin.users'), (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(idParam(req));
    if (!target) throw notFound('We could not find that person.');
    assertCanManage(req.user, target.role);
    const f = userFields(req.body || {}, { creating: false });
    if (f.role) assertCanManage(req.user, f.role);
    if (target.id === req.user.id && ((f.role && f.role !== target.role) || f.status === 'inactive')) throw bad('You cannot change your own role or deactivate your own account.');
    const next = { ...target, ...f };
    requireSalonForRole(next);
    if (target.role === 'admin' && (next.role !== 'admin' || next.status !== 'active')) {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?").get(target.id).n;
      if (!admins) throw bad('Keep at least one active administrator.');
    }
    if (f.username && f.username !== target.username && db.prepare('SELECT 1 FROM users WHERE username = ?').get(f.username)) throw conflict('That username is taken. Try another.');
    if (f.email && f.email !== target.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) throw conflict('Someone already uses that email address.');
    const cols = Object.keys(f);
    if (!cols.length) throw bad('Nothing to update.');
    db.transaction(() => {
      db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => f[c]), target.id);
      if (f.status === 'inactive') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      syncOrgLinks(target.id);
    })();
    audit(req, 'user.updated', 'user', target.id, { fields: cols, role_from: f.role && f.role !== target.role ? target.role : undefined, role_to: f.role && f.role !== target.role ? f.role : undefined });
    res.json({ user: adminUser(shapes.userRow(target.id)) });
  });

  r.post('/admin/users/:id/reset-password', requirePerm('admin.users'), (req, res) => {
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(idParam(req));
    if (!target) throw notFound('We could not find that person.');
    assertCanManage(req.user, target.role);
    const temp = auth.generatePassword();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(auth.hashPassword(temp), target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(target.id, target.id === req.user.id ? req.sessionId : -1);
    })();
    audit(req, 'user.password_reset', 'user', target.id);
    res.json({ temp_password: temp });
  });

  // CSV columns: first_name, last_name, role, salon_number (required for stylists and managers),
  // optional: username, email, title, phone, hire_date, birthday_md. Up to 300 rows per call.
  r.post('/admin/users/import', requirePerm('admin.users'), bigJson, (req, res, next) => { importUsers(req, res).catch(next); });
  async function importUsers(req, res) {
    const csv = v.str(req.body?.csv, 'CSV', { max: 2_000_000, trim: false });
    const { header, records } = parseCsvObjects(csv);
    for (const c of ['first_name', 'last_name', 'role']) if (!header.includes(c)) throw bad(`The file needs a ${c} column.`);
    if (records.length > 300) throw bad('Import up to 300 people at a time.');
    const salonByNumber = new Map(db.prepare('SELECT id, salon_number FROM salons').all().map((s) => [String(s.salon_number), s.id]));
    const created = [];
    const rejected = [];
    for (const rec of records) {
      try {
        const body = { first_name: rec.first_name, last_name: rec.last_name, role: rec.role || 'stylist' };
        for (const k of ['username', 'email', 'title', 'phone', 'hire_date', 'birthday_md']) if (rec[k]) body[k] = rec[k];
        if (rec.salon_number) {
          const sid = salonByNumber.get(rec.salon_number);
          if (!sid) throw bad(`Salon ${rec.salon_number} is not in the portal.`);
          body.salon_id = sid;
        }
        const f = userFields(body, { creating: true });
        assertCanManage(req.user, f.role);
        requireSalonForRole(f);
        const username = f.username || uniqueUsername(f.first_name, f.last_name);
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad(`Username ${username} is taken.`);
        if (f.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) throw bad(`Email ${f.email} is already in use.`);
        const temp = auth.generatePassword();
        const hash = await auth.hashPasswordAsync(temp); // off the main thread, so a large import does not stall other requests
        const info = db.prepare(`INSERT INTO users (email, username, password_hash, must_change_password, role, first_name, last_name, title, salon_id, phone, hire_date, birthday_md, status, created_at)
          VALUES (?,?,?,1,?,?,?,?,?,?,?,?, 'active', ?)`).run(f.email ?? null, username, hash, f.role, f.first_name, f.last_name,
          f.title ?? (f.role === 'stylist' ? 'Stylist' : f.role === 'salon_manager' ? 'Salon Manager' : null), f.salon_id ?? null, f.phone ?? null, f.hire_date ?? null, f.birthday_md ?? null, nowIso());
        syncOrgLinks(Number(info.lastInsertRowid));
        created.push({ id: Number(info.lastInsertRowid), name: `${f.first_name} ${f.last_name}`, username, temp_password: temp });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        rejected.push({ line: rec._line, reason: e.message });
      }
    }
    audit(req, 'user.import', 'user', null, { created: created.length, rejected: rejected.length });
    res.json({ created, rejected });
  }

  r.post('/admin/invites', requirePerm('admin.users'), (req, res) => {
    const b = req.body || {};
    const role = v.oneOf(b.role || 'stylist', 'Role', ['stylist', 'salon_manager']);
    const salonId = v.int(b.salon_id, 'Salon', { min: 1 });
    if (!db.prepare('SELECT 1 FROM salons WHERE id = ?').get(salonId)) throw bad('We could not find that salon.');
    const days = v.int(b.days ?? 14, 'Days', { min: 1, max: 60 });
    const code = `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const info = db.prepare('INSERT INTO invites (code_hash, role, salon_id, created_by, expires_at) VALUES (?,?,?,?,?)').run(auth.sha256(code), role, salonId, req.user.id, expires);
    audit(req, 'invite.created', 'invite', Number(info.lastInsertRowid), { role, salon_id: salonId });
    res.json({ code, expires_at: expires, role, salon_id: salonId });
  });

  // ======================================================================
  // Generic CRUD for simple tables
  // ======================================================================
  /**
   * fields: { column: (value) => cleanValue }  — a validator that throws on bad input.
   * required: columns that must be present on create.
   */
  function crud({ path, table, perm, fields, required = [], orderBy = 'id', shape = (x) => x, auditType, afterChange }) {
    const cols = Object.keys(fields);
    const read = (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    const clean = (b, creating) => {
      const out = {};
      for (const c of cols) {
        if (c in b) out[c] = fields[c](b[c]);
        else if (creating && required.includes(c)) out[c] = fields[c](undefined);
      }
      return out;
    };
    r.get(`/admin/${path}`, requirePerm(perm), (req, res) => {
      res.json({ items: db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy} LIMIT 2000`).all().map(shape) });
    });
    r.post(`/admin/${path}`, requirePerm(perm), (req, res) => {
      const f = clean(req.body || {}, true);
      if (table === 'resources') f.updated_at = nowIso();
      const keys = Object.keys(f);
      const info = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => f[k]));
      const id = Number(info.lastInsertRowid);
      audit(req, `${auditType}.created`, auditType, id, null);
      afterChange?.();
      res.json({ item: shape(read(id)) });
    });
    r.patch(`/admin/${path}/:id`, requirePerm(perm), (req, res) => {
      const id = idParam(req);
      if (!read(id)) throw notFound();
      const f = clean(req.body || {}, false);
      if (table === 'resources') f.updated_at = nowIso();
      const keys = Object.keys(f);
      if (!keys.length) throw bad('Nothing to update.');
      db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
      audit(req, `${auditType}.updated`, auditType, id, { fields: keys });
      afterChange?.();
      res.json({ item: shape(read(id)) });
    });
    return { read };
  }
  function crudDelete({ path, table, perm, auditType, guard }) {
    r.delete(`/admin/${path}/:id`, requirePerm(perm), (req, res) => {
      const id = idParam(req);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!row) throw notFound();
      guard?.(row);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      audit(req, `${auditType}.deleted`, auditType, id, { title: row.title || row.name || null });
      res.json({ ok: true });
    });
  }
  const opt = (fn) => (x) => fn(x, false);
  const refExists = (table, label) => (x, required = true) => {
    const id = v.int(x, label, { min: 1, required });
    if (id && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw bad(`We could not find that ${label.toLowerCase()}.`);
    return id;
  };

  // ---- org ---------------------------------------------------------------
  const salonShape = (s) => ({ ...s, hours: json(s.hours_json, null), hours_json: undefined });
  crud({
    path: 'salons', table: 'salons', perm: 'admin.settings', auditType: 'salon', orderBy: 'name', shape: salonShape,
    required: ['salon_number', 'name'], afterChange: () => kpi.invalidate(),
    fields: {
      salon_number: (x) => { const s = v.str(x, 'Salon number', { max: 12 }); if (!/^\d{3,8}$/.test(s)) throw bad('Salon number is 3 to 8 digits.'); return s; },
      name: (x) => v.str(x, 'Name', { max: 80 }),
      concept: (x) => v.oneOf(x || 'SUPERCUTS', 'Concept', ['SUPERCUTS', 'SMARTSTYLE']),
      address: (x) => v.str(x, 'Address', { max: 160, required: false }),
      city: (x) => v.str(x, 'City', { max: 80, required: false }),
      state: (x) => v.str(x, 'State', { max: 2, required: false }),
      zip: (x) => v.str(x, 'ZIP', { max: 10, required: false }),
      phone: (x) => v.str(x, 'Phone', { max: 30, required: false }),
      shopping_center: (x) => v.str(x, 'Shopping center', { max: 120, required: false }),
      market_id: opt(refExists('markets', 'Market')),
      district_id: opt(refExists('districts', 'District')),
      entity_id: opt(refExists('entities', 'Entity')),
      manager_user_id: opt(refExists('users', 'Manager')),
      hours_json: (x) => (x === null || x === undefined ? null : JSON.stringify(x).slice(0, 2000)),
      photo_url: (x) => v.url(x, 'Photo'),
      lat: (x) => v.num(x, 'Latitude', { min: -90, max: 90, required: false }),
      lng: (x) => v.num(x, 'Longitude', { min: -180, max: 180, required: false }),
      status: (x) => v.oneOf(x || 'active', 'Status', ['active', 'closed']),
      opened_on: (x) => v.date(x, 'Opened on', { required: false }),
    },
  });

  crud({
    path: 'districts', table: 'districts', perm: 'admin.settings', auditType: 'district', orderBy: 'name', required: ['name'], afterChange: () => kpi.invalidate(),
    fields: { name: (x) => v.str(x, 'Name', { max: 80 }), leader_user_id: opt(refExists('users', 'Leader')) },
  });
  crud({
    path: 'markets', table: 'markets', perm: 'admin.settings', auditType: 'market', orderBy: 'name', required: ['name', 'state'],
    fields: { name: (x) => v.str(x, 'Name', { max: 80 }), state: (x) => v.str(x, 'State', { max: 2 }) },
  });

  // ---- content -----------------------------------------------------------
  crud({
    path: 'promos', table: 'promos', perm: 'admin.content', auditType: 'promo', orderBy: 'sort, id', required: ['title'],
    fields: {
      title: (x) => v.str(x, 'Title', { max: 140 }),
      summary: (x) => v.str(x, 'Summary', { max: 400, required: false }),
      body: (x) => v.str(x, 'Details', { max: 20000, required: false }),
      image_url: (x) => v.url(x, 'Image'),
      starts_on: (x) => v.date(x, 'Start date', { required: false }),
      ends_on: (x) => v.date(x, 'End date', { required: false }),
      tag: (x) => v.str(x, 'Tag', { max: 40, required: false }),
      audience: (x) => v.str(x || 'all', 'Audience', { max: 40 }),
      status: (x) => v.oneOf(x || 'published', 'Status', ['draft', 'published', 'archived']),
      sort: (x) => v.int(x ?? 0, 'Order', { min: -9999, max: 9999 }),
    },
  });
  crudDelete({ path: 'promos', table: 'promos', perm: 'admin.content', auditType: 'promo' });

  crud({
    path: 'resources', table: 'resources', perm: 'admin.content', auditType: 'resource', orderBy: 'section, sort, id', required: ['section', 'title'],
    shape: (x) => ({ ...x, requires_ack: !!x.requires_ack }),
    fields: {
      section: (x) => v.oneOf(x, 'Section', ['brand', 'products', 'policies', 'ops', 'hr']),
      category: (x) => v.str(x, 'Category', { max: 60, required: false }),
      title: (x) => v.str(x, 'Title', { max: 140 }),
      summary: (x) => v.str(x, 'Summary', { max: 400, required: false }),
      body_md: (x) => v.str(x, 'Body', { max: 60000, required: false, trim: false }),
      file_url: (x) => v.url(x, 'File', { allowExternal: true }),
      image_url: (x) => v.url(x, 'Image'),
      sort: (x) => v.int(x ?? 0, 'Order', { min: -9999, max: 9999 }),
      requires_ack: (x) => (v.bool(x) ? 1 : 0),
    },
  });
  crudDelete({ path: 'resources', table: 'resources', perm: 'admin.content', auditType: 'resource' });

  crud({
    path: 'videos', table: 'videos', perm: 'admin.content', auditType: 'video', orderBy: 'channel, sort, id', required: ['channel', 'title', 'url'],
    fields: {
      channel: (x) => v.str(x, 'Channel', { max: 60 }),
      title: (x) => v.str(x, 'Title', { max: 140 }),
      description: (x) => v.str(x, 'Description', { max: 2000, required: false }),
      url: (x) => v.url(x, 'Video link', { required: true, allowExternal: true }),
      poster_url: (x) => v.url(x, 'Poster', { allowExternal: true }),
      duration_s: (x) => v.int(x, 'Length', { min: 0, max: 86400, required: false }),
      sort: (x) => v.int(x ?? 0, 'Order', { min: -9999, max: 9999 }),
    },
  });
  crudDelete({ path: 'videos', table: 'videos', perm: 'admin.content', auditType: 'video' });

  crud({
    path: 'events', table: 'events', perm: 'admin.content', auditType: 'event', orderBy: 'starts_on, id', required: ['title', 'starts_on'],
    fields: {
      title: (x) => v.str(x, 'Title', { max: 140 }),
      starts_on: (x) => v.date(x, 'Start date'),
      ends_on: (x) => v.date(x, 'End date', { required: false }),
      kind: (x) => v.str(x || 'general', 'Type', { max: 30 }),
      audience_type: (x) => v.oneOf(x || 'company', 'Audience', ['company', 'market', 'district', 'salon']),
      audience_id: (x) => v.int(x, 'Audience', { min: 1, required: false }),
    },
  });
  crudDelete({ path: 'events', table: 'events', perm: 'admin.content', auditType: 'event' });

  const templateItems = (x) => {
    if (!Array.isArray(x) || !x.length || x.length > 60) throw bad('A checklist needs between 1 and 60 items.');
    const seen = new Set();
    return JSON.stringify(x.map((it, i) => {
      const label = v.str(it?.label, 'Item', { max: 200 });
      let id = String(it?.id ?? '').trim().slice(0, 40) || `i${i + 1}`;
      while (seen.has(id)) id += '_';
      seen.add(id);
      return { id, label };
    }));
  };
  crud({
    path: 'checklist-templates', table: 'checklist_templates', perm: 'admin.content', auditType: 'checklist_template', orderBy: 'id', required: ['key', 'name', 'items_json'],
    shape: (t) => ({ id: t.id, key: t.key, name: t.name, items: json(t.items_json, []), active: !!t.active }),
    afterChange: () => kpi.invalidate(),
    fields: {
      key: (x) => { const s = v.str(x, 'Key', { max: 30 }); if (!/^[a-z][a-z0-9_-]*$/.test(s)) throw bad('Key uses lower-case letters, numbers, dashes or underscores.'); return s; },
      name: (x) => v.str(x, 'Name', { max: 80 }),
      items_json: templateItems,
      active: (x) => (v.bool(x) ? 1 : 0),
    },
  });

  // ======================================================================
  // KPI goals and import
  // ======================================================================
  r.get('/admin/goals', requirePerm('admin.settings'), (req, res) => {
    const period = v.str(req.query.period, 'period', { max: 7, required: false }) || todayLocal().slice(0, 7);
    if (!PERIOD_RE.test(period)) throw bad('period must look like 2026-11.');
    const rows = db.prepare(`SELECT s.id AS salon_id, s.name AS salon_name, s.salon_number, g.sales_goal_c, g.product_pct_goal, g.srph_goal_c
      FROM salons s LEFT JOIN kpi_goals g ON g.salon_id = s.id AND g.period = ? WHERE s.status = 'active' ORDER BY s.name`).all(period);
    res.json({ period, items: rows });
  });

  r.put('/admin/goals', requirePerm('admin.settings'), (req, res) => {
    const b = req.body || {};
    const period = v.str(b.period ?? req.query.period, 'Period', { max: 7 });
    if (!PERIOD_RE.test(period)) throw bad('Period must look like 2026-11.');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 500) throw bad('Send the goals to save.');
    const rows = b.items.map((it) => ({
      salon_id: refExists('salons', 'Salon')(it?.salon_id),
      sales_goal_c: v.int(it?.sales_goal_c, 'Sales goal', { min: 0, max: 500_000_000 }),
      product_pct_goal: v.num(it?.product_pct_goal, 'Product % goal', { min: 0, max: 100, required: false }),
      srph_goal_c: v.int(it?.srph_goal_c, 'SRPH goal', { min: 0, max: 100_000, required: false }),
    }));
    const stmt = db.prepare(`INSERT INTO kpi_goals (salon_id, period, sales_goal_c, product_pct_goal, srph_goal_c) VALUES (?,?,?,?,?)
      ON CONFLICT(salon_id, period) DO UPDATE SET sales_goal_c = excluded.sales_goal_c, product_pct_goal = excluded.product_pct_goal, srph_goal_c = excluded.srph_goal_c`);
    db.transaction(() => { for (const g of rows) stmt.run(g.salon_id, period, g.sales_goal_c, g.product_pct_goal, g.srph_goal_c); })();
    kpi.invalidate();
    audit(req, 'goals.updated', 'kpi_goals', null, { period, salons: rows.length });
    res.json({ ok: true, period, saved: rows.length });
  });

  r.post('/admin/import/dsr', requirePerm('admin.settings'), bigJson, express.text({ type: 'text/csv', limit: '8mb' }), (req, res) => {
    const csv = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) throw bad('Paste or upload the daily sales file (CSV).');
    let out;
    try { out = importDsr(db, csv); } catch (e) { if (e.userFacing) throw bad(e.message); throw e; }
    kpi.invalidate();
    audit(req, 'kpi.import', 'kpi_daily', null, { rows: out.rows, salons: out.salons, from: out.from, to: out.to, rejected: out.rejected_count });
    res.json(out);
  });

  // ======================================================================
  // Moderation
  // ======================================================================
  r.get('/admin/reports', requirePerm('moderate'), (req, res) => {
    const status = v.oneOf(req.query.status || 'open', 'status', ['open', 'resolved', 'all']);
    const rows = db.prepare(`SELECT * FROM reports ${status === 'all' ? '' : 'WHERE status = ?'} ORDER BY id DESC LIMIT 200`).all(...(status === 'all' ? [] : [status === 'open' ? 'open' : 'resolved']));
    const posts = new Map();
    const comments = new Map();
    for (const x of rows) {
      if (x.post_id && !posts.has(x.post_id)) posts.set(x.post_id, db.prepare('SELECT id, author_id, body, created_at, deleted_at FROM posts WHERE id = ?').get(x.post_id));
      if (x.comment_id && !comments.has(x.comment_id)) comments.set(x.comment_id, db.prepare('SELECT id, post_id, author_id, body, created_at, deleted_at FROM comments WHERE id = ?').get(x.comment_id));
    }
    const users = shapes.usersByIds([...rows.flatMap((x) => [x.reporter_id, x.resolved_by]), ...[...posts.values(), ...comments.values()].map((x) => x?.author_id)].filter(Boolean));
    const excerpt = (x) => (x ? { id: x.id, body: x.body.slice(0, 600), created_at: x.created_at, removed: !!x.deleted_at, author: users.get(x.author_id) || null } : null);
    res.json({
      items: rows.map((x) => ({
        id: x.id, reason: x.reason, status: x.status, created_at: x.created_at, reporter: users.get(x.reporter_id) || null,
        resolved_by: x.resolved_by ? users.get(x.resolved_by) || null : null,
        post: x.post_id ? excerpt(posts.get(x.post_id)) : null, comment: x.comment_id ? excerpt(comments.get(x.comment_id)) : null,
      })),
    });
  });

  r.post('/admin/reports/:id/resolve', requirePerm('moderate'), (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(idParam(req));
    if (!rep) throw notFound('We could not find that report.');
    const action = v.oneOf(req.body?.action, 'Action', ['dismiss', 'remove']);
    db.transaction(() => {
      if (action === 'remove') {
        if (rep.post_id) db.prepare('UPDATE posts SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(nowIso(), rep.post_id);
        if (rep.comment_id) db.prepare('UPDATE comments SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(nowIso(), rep.comment_id);
      }
      // Close every open report about the same item.
      db.prepare(`UPDATE reports SET status = 'resolved', resolved_by = ? WHERE status = 'open' AND ((post_id IS NOT NULL AND post_id = ?) OR (comment_id IS NOT NULL AND comment_id = ?))`)
        .run(req.user.id, rep.post_id, rep.comment_id);
    })();
    audit(req, `report.${action}`, 'report', rep.id, { post_id: rep.post_id, comment_id: rep.comment_id });
    res.json({ ok: true });
  });

  // ======================================================================
  // Overview, audit log, settings
  // ======================================================================
  r.get('/admin/overview', requirePerm('admin.users', 'admin.content', 'admin.settings'), (req, res) => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const total = one("SELECT COUNT(*) n FROM users WHERE status = 'active'");
    const ackNeeded = one('SELECT COUNT(*) n FROM resources WHERE requires_ack = 1') * total;
    const ackDone = one("SELECT COUNT(*) n FROM acknowledgements a JOIN resources r ON r.id = a.resource_id JOIN users u ON u.id = a.user_id WHERE r.requires_ack = 1 AND u.status = 'active'");
    const m = kpi.metrics();
    const checks = [...m.bySalon.values()].map((x) => x.checklist_pct);
    const adoption = db.prepare(`SELECT s.id, s.name, s.salon_number, COUNT(u.id) total, SUM(CASE WHEN u.last_login_at >= ? THEN 1 ELSE 0 END) active
      FROM salons s LEFT JOIN users u ON u.salon_id = s.id AND u.status = 'active' WHERE s.status = 'active' GROUP BY s.id ORDER BY s.name`).all(weekAgo);
    res.json({
      users: {
        total,
        active_7d: one("SELECT COUNT(*) n FROM users WHERE status = 'active' AND last_login_at >= ?", weekAgo),
        never_logged_in: one("SELECT COUNT(*) n FROM users WHERE status = 'active' AND last_login_at IS NULL"),
      },
      posts_7d: one('SELECT COUNT(*) n FROM posts WHERE deleted_at IS NULL AND created_at >= ?', weekAgo),
      shoutouts_7d: one("SELECT COUNT(*) n FROM posts WHERE deleted_at IS NULL AND kind = 'shoutout' AND created_at >= ?", weekAgo),
      open_tickets: one("SELECT COUNT(*) n FROM tickets WHERE status IN ('open','in_progress','waiting')"),
      open_hr: can(req.user, 'hr.inbox') ? one("SELECT COUNT(*) n FROM hr_inquiries WHERE status IN ('open','in_progress','waiting')") : null,
      open_reports: one("SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
      ack_completion_pct: ackNeeded ? round1((ackDone / ackNeeded) * 100) : 100,
      checklist_completion_pct: checks.length ? round1(checks.reduce((a, b) => a + b, 0) / checks.length) : 0,
      adoption_by_salon: adoption.map((a) => ({ salon: { id: a.id, name: a.name, salon_number: a.salon_number }, users: a.total, active_pct: a.total ? round1((a.active / a.total) * 100) : 0 })),
    });
  });

  r.get('/admin/audit', requirePerm('admin.settings'), (req, res) => {
    const limit = limitParam(req, 50, 200);
    const cur = decodeCursor(req.query.cursor);
    const action = v.str(req.query.action, 'action', { max: 60, required: false });
    const where = [];
    const params = [];
    if (cur) { if (!Number.isInteger(cur.i)) throw bad('That page link is no longer valid.'); where.push('id < ?'); params.push(cur.i); }
    if (action) { where.push("action LIKE ? ESCAPE '\\'"); params.push(likeArg(action)); }
    const rows = db.prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const users = shapes.usersByIds(page.map((x) => x.actor_id).filter(Boolean));
    res.json({
      items: page.map((x) => ({ id: x.id, action: x.action, target_type: x.target_type, target_id: x.target_id, meta: json(x.meta_json, null), ip: x.ip, created_at: x.created_at, actor: x.actor_id ? users.get(x.actor_id) || null : null })),
      next_cursor: rows.length > limit ? encodeCursor({ i: page[page.length - 1].id }) : null,
    });
  });

  const SETTINGS = {
    company_name: (x) => v.str(x, 'Company name', { max: 80 }),
    sample_data: (x) => v.bool(x),
    values: (x) => {
      if (!Array.isArray(x) || x.length > 12) throw bad('Keep the list of values to 12 or fewer.');
      return x.map((it) => {
        const key = v.str(it?.key, 'Value key', { max: 40 });
        if (!/^[a-z][a-z0-9_-]*$/.test(key)) throw bad('Value keys use lower-case letters, numbers, dashes or underscores.');
        const meaning = v.str(it?.meaning, 'Value meaning', { max: 200, required: false });
        return { key, label: v.str(it?.label, 'Value label', { max: 60 }), ...(meaning ? { meaning } : {}) };
      });
    },
    features: (x) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('Features must be a set of on/off switches.');
      const out = {};
      for (const [k, val] of Object.entries(x).slice(0, 40)) if (/^[a-z][a-z0-9_]{0,39}$/.test(k)) out[k] = !!val;
      return out;
    },
    academy_url: (x) => v.url(x, 'Training link', { allowExternal: true }),
  };
  const allSettings = () => Object.fromEntries(db.prepare('SELECT key, value_json FROM settings').all().map((s) => [s.key, json(s.value_json, null)]));

  r.get('/admin/settings', requirePerm('admin.settings'), (req, res) => res.json({ settings: allSettings() }));
  r.put('/admin/settings', requirePerm('admin.settings'), (req, res) => {
    const b = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body || {};
    const changed = [];
    const stmt = db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json');
    db.transaction(() => {
      for (const [k, fn] of Object.entries(SETTINGS)) {
        if (!(k in b)) continue;
        stmt.run(k, JSON.stringify(fn(b[k])));
        changed.push(k);
      }
    })();
    if (!changed.length) throw bad('Nothing to update.');
    audit(req, 'settings.updated', 'settings', null, { keys: changed });
    res.json({ settings: allSettings() });
  });

  return r;
};

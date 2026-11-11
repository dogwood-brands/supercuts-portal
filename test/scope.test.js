'use strict';
// Every access rule in SPEC section 3, exercised over HTTP.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPortal } = require('./helpers');

let p, MDR, PAS, LV, stylist, manager, dl, exec, hr, admin;
before(async () => {
  p = await startPortal();
  MDR = p.salonId(8495);   // Marina Del Rey: the demo stylist and manager, in the demo district leader's district
  PAS = p.salonId(80039);  // Pasadena: same district, different salon
  LV = p.salonId(82303);   // Charleston Commons: a different district
  [stylist, manager, dl, exec, hr, admin] = await Promise.all(['demo.stylist', 'demo.manager', 'demo.dl', 'demo.executive', 'demo.hr', 'demo.admin'].map((u) => p.as(u)));
});
after(async () => { await p.stop(); });

const hasDollars = (obj) => /_c"\s*:/.test(JSON.stringify(obj));

test('salon page: own salon shows KPIs, another salon shows the public tier only', async () => {
  const own = await stylist.get(`/api/salons/${MDR}`);
  assert.equal(own.status, 200);
  assert.ok(own.body.kpis && own.body.kpis.mtd.net_sales_c > 0);
  assert.equal(own.body.boxes.length, 5);
  assert.ok(own.body.alerts.people.length > 0);
  assert.equal(own.body.salon.in_scope, true);
  for (const k of ['period', 'mtd', 'goal', 'wow', 'yesterday']) assert.ok(k in own.body.kpis);
  for (const k of ['net_sales_c', 'service_c', 'product_c', 'guests', 'haircuts', 'hours', 'atv_c', 'srph_c', 'product_pct', 'supercut_plus']) assert.ok(k in own.body.kpis.mtd, k);
  for (const k of ['sales_goal_c', 'pace_pct', 'projected_c', 'product_pct_goal', 'srph_goal_c']) assert.ok(k in own.body.kpis.goal, k);
  assert.ok(own.body.kpis.goal.pace_pct > 40 && own.body.kpis.goal.pace_pct < 200, 'pace is in percent units');
  assert.ok(own.body.kpis.mtd.product_pct > 1 && own.body.kpis.mtd.product_pct < 30, 'product % is in percent units');

  const other = await stylist.get(`/api/salons/${PAS}`);
  assert.equal(other.status, 200);
  assert.equal(other.body.kpis, null);
  assert.deepEqual(other.body.boxes, []);
  assert.deepEqual(other.body.alerts, { people: [], store: [], initiative: [] });
  assert.equal(other.body.salon.in_scope, false);
  assert.equal(hasDollars(other.body), false, 'no dollar figure may reach a stylist for another salon');
  assert.ok(other.body.salon.name && other.body.salon.phone && other.body.salon.address);
  assert.equal(typeof other.body.salon.pace_pct, 'number');
  assert.ok(other.body.rank.company >= 1);
});

test('salon list carries no dollars for anyone and marks scope', async () => {
  const r = await stylist.get('/api/salons');
  assert.equal(r.body.items.length, 51);
  assert.equal(hasDollars(r.body), false);
  assert.deepEqual(r.body.items.filter((s) => s.in_scope).map((s) => s.id), [MDR]);
  const d = await dl.get('/api/salons');
  const inScope = d.body.items.filter((s) => s.in_scope);
  assert.ok(inScope.length >= 5 && inScope.length < 51);
  assert.ok(inScope.some((s) => s.id === PAS) && !inScope.some((s) => s.id === LV));
  assert.equal((await exec.get('/api/salons')).body.items.every((s) => s.in_scope), true);
  assert.match(r.body.items[0].photo_url, /^\/media\/salon-[1-6]\.webp$/);
});

test('DSR detail requires the salon in scope', async () => {
  assert.equal((await stylist.get(`/api/salons/${MDR}/dsr`)).status, 200);
  assert.equal((await stylist.get(`/api/salons/${PAS}/dsr`)).status, 403);
  assert.equal((await manager.get(`/api/salons/${PAS}/dsr`)).status, 403);
  assert.equal((await dl.get(`/api/salons/${PAS}/dsr`)).status, 200);
  assert.equal((await dl.get(`/api/salons/${LV}/dsr`)).status, 403);
  assert.equal((await hr.get(`/api/salons/${MDR}/dsr`)).status, 403, 'HR has people access, not sales');
  const e = await exec.get(`/api/salons/${LV}/dsr`);
  assert.equal(e.status, 200);
  assert.ok(e.body.days.length > 0 && e.body.totals.net_sales_c === e.body.days.reduce((a, d) => a + d.net_sales_c, 0));
  assert.equal((await exec.get(`/api/salons/${LV}/dsr?from=2026-13-40`)).status, 400);
});

test('individual stylist numbers: self, or manager and above with the salon in scope', async () => {
  const mine = await stylist.get(`/api/salons/${MDR}/stylists`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.items.length, 1);
  assert.equal(mine.body.items[0].user.id, stylist.me.id);
  const team = await manager.get(`/api/salons/${MDR}/stylists`);
  assert.ok(team.body.items.length >= 4);
  assert.equal((await manager.get(`/api/salons/${PAS}/stylists`)).status, 403);
  assert.equal((await stylist.get(`/api/salons/${PAS}/stylists`)).status, 403);
  assert.equal((await dl.get(`/api/salons/${PAS}/stylists`)).status, 200);
  assert.equal((await dl.get(`/api/salons/${LV}/stylists`)).status, 403);
  const stats = await stylist.get('/api/me/stats');
  assert.equal(stats.status, 200);
  for (const k of ['period', 'service_c', 'product_c', 'guests', 'hours', 'srph_c', 'product_pct', 'rank_salon', 'rank_company', 'of_company', 'shoutouts_received', 'streak_days', 'trend']) assert.ok(k in stats.body, k);
  assert.ok(stats.body.service_c > 0 && stats.body.rank_company >= 1);
});

test('company rollups are for district leaders (their district) and leadership', async () => {
  assert.equal((await stylist.get('/api/kpi/overview')).status, 403);
  assert.equal((await manager.get('/api/kpi/overview')).status, 403);
  assert.equal((await hr.get('/api/kpi/overview')).status, 403);
  const company = await exec.get('/api/kpi/overview?level=company');
  assert.equal(company.status, 200);
  assert.equal(company.body.breakdown.length, 51);
  assert.ok(company.body.trend.length >= 28);
  for (const k of ['id', 'label', 'net_sales_c', 'pace_pct', 'guests', 'atv_c', 'srph_c', 'product_pct', 'wow_pct']) assert.ok(k in company.body.breakdown[0], k);
  assert.equal(company.body.totals.mtd.net_sales_c, company.body.breakdown.reduce((a, b) => a + b.net_sales_c, 0));
  assert.equal((await exec.get('/api/kpi/overview?level=market')).body.breakdown.length, 8);
  assert.equal((await exec.get('/api/kpi/overview?level=district')).body.breakdown.length, 7);
  const mine = await dl.get('/api/kpi/overview?level=company');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.breakdown.length < 51 && mine.body.breakdown.every((b) => b.id !== LV));
  assert.ok(mine.body.totals.mtd.net_sales_c < company.body.totals.mtd.net_sales_c);
  assert.equal((await dl.get('/api/kpi/overview?level=district')).body.breakdown.length, 1);
});

test('leaderboards hide dollars outside the caller\'s scope', async () => {
  const s = await stylist.get('/api/leaderboards?metric=sales&group=salon&period=mtd');
  assert.equal(s.status, 200);
  assert.equal(s.body.items.length, 51);
  for (const k of ['rank', 'label', 'sub_label', 'value', 'value_label', 'delta', 'id', 'type', 'avatar_url', 'is_me']) assert.ok(k in s.body.items[0], k);
  const own = s.body.items.find((x) => x.is_me);
  assert.equal(own.id, MDR);
  assert.match(own.value_label, /^\$/);
  for (const x of s.body.items.filter((i) => !i.is_me)) assert.match(x.value_label, /^Index \d+$/);
  const e = await exec.get('/api/leaderboards?metric=sales&group=salon');
  assert.ok(e.body.items.every((x) => /^\$/.test(x.value_label)));
  const st = await stylist.get('/api/leaderboards?metric=sales&group=stylist');
  assert.ok(st.body.items.some((x) => x.is_me && /^\$/.test(x.value_label)));
  assert.ok(st.body.items.filter((x) => !x.is_me).every((x) => /^Index/.test(x.value_label)), 'a stylist never sees a peer\'s dollars');
  const mg = await manager.get('/api/leaderboards?metric=sales&group=stylist');
  const dollars = mg.body.items.filter((x) => /^\$/.test(x.value_label));
  assert.ok(dollars.length >= 4 && dollars.every((x) => x.sub_label === 'Marina Del Rey'));
  for (const metric of ['pace', 'atv', 'product_pct', 'srph', 'recognition']) {
    for (const group of ['salon', 'stylist', 'district']) {
      for (const period of ['mtd', 'wtd']) {
        const r = await stylist.get(`/api/leaderboards?metric=${metric}&group=${group}&period=${period}`);
        assert.equal(r.status, 200, `${metric}/${group}/${period}`);
        assert.ok(Array.isArray(r.body.items));
      }
    }
  }
  assert.equal((await stylist.get('/api/leaderboards?metric=bogus')).status, 400);
});

test('alerts: managers and district leaders in scope can update, stylists cannot', async () => {
  const alert = (await manager.get(`/api/salons/${MDR}`)).body.alerts.store[0];
  assert.equal((await stylist.patch(`/api/alerts/${alert.id}`, { state: 'ok' })).status, 403);
  assert.equal((await manager.patch(`/api/alerts/${alert.id}`, { state: 'action' })).status, 200);
  assert.equal((await dl.patch(`/api/alerts/${alert.id}`, { state: 'ok' })).status, 200);
  const far = p.db.prepare('SELECT id FROM alerts WHERE salon_id = ?').get(LV).id;
  assert.equal((await manager.patch(`/api/alerts/${far}`, { state: 'ok' })).status, 403);
  assert.equal((await dl.patch(`/api/alerts/${far}`, { state: 'ok' })).status, 403);
  assert.equal((await manager.patch(`/api/alerts/${alert.id}`, { state: 'maybe' })).status, 400);
});

test('checklists: own salon only; a manager signs off', async () => {
  const list = await stylist.get('/api/checklists');
  assert.equal(list.status, 200);
  const open = list.body.items.find((i) => i.template.key === 'open');
  const all = open.template.items.map((i) => i.id);
  assert.equal((await stylist.get(`/api/checklists?salon_id=${PAS}`)).status, 403);
  assert.equal((await stylist.put(`/api/checklists/${open.template.id}/run`, { salon_id: PAS, done: all })).status, 403);
  assert.equal((await stylist.put(`/api/checklists/${open.template.id}/run`, { salon_id: MDR, done: all.slice(0, 3) })).status, 200);
  assert.equal((await stylist.put(`/api/checklists/${open.template.id}/run`, { salon_id: MDR, done: all, complete: true })).status, 403);
  assert.equal((await manager.put(`/api/checklists/${open.template.id}/run`, { salon_id: MDR, done: all.slice(0, 3), complete: true })).status, 400);
  const done = await manager.put(`/api/checklists/${open.template.id}/run`, { salon_id: MDR, done: all, complete: true });
  assert.equal(done.status, 200);
  assert.equal(done.body.run.completed_by.id, manager.me.id);
  assert.equal((await hr.get(`/api/checklists?salon_id=${MDR}`)).status, 403);
});

test('tickets: visible to the author, the salon\'s manager, the district leader and leadership', async () => {
  const mk = await stylist.post('/api/tickets', { salon_id: MDR, category: 'it', subject: 'Scanner is down', body: 'The barcode scanner will not pair.', priority: 'high' });
  assert.equal(mk.status, 200);
  const id = mk.body.ticket.id;
  assert.equal((await stylist.post('/api/tickets', { salon_id: PAS, category: 'it', subject: 'x', body: 'y' })).status, 403);
  assert.equal((await stylist.get(`/api/tickets/${id}`)).status, 200);
  assert.equal((await manager.get(`/api/tickets/${id}`)).status, 200);
  assert.equal((await dl.get(`/api/tickets/${id}`)).status, 200);
  assert.equal((await exec.get(`/api/tickets/${id}`)).status, 200);
  const outsider = await p.as(p.managerAt(82303).username);
  assert.equal((await outsider.get(`/api/tickets/${id}`)).status, 404);
  const peer = await p.as(p.stylistAt(8495, 1).username);
  assert.equal((await peer.get(`/api/tickets/${id}`)).status, 404, 'a fellow stylist does not see a teammate\'s ticket');
  assert.equal((await stylist.post(`/api/tickets/${id}/events`, { body: 'done?', status_to: 'resolved' })).status, 403);
  assert.equal((await exec.post(`/api/tickets/${id}/events`, { body: 'looking' })).status, 403, 'executives are read-only');
  const worked = await dl.post(`/api/tickets/${id}/events`, { body: 'Replacement ordered.', status_to: 'in_progress' });
  assert.equal(worked.status, 200);
  assert.equal(worked.body.ticket.status, 'in_progress');
  assert.equal(worked.body.events.length, 1);
  assert.equal((await stylist.post(`/api/tickets/${id}/events`, { body: 'All good now, thank you.', status_to: 'closed' })).status, 200);
  const mine = await stylist.get('/api/tickets');
  assert.ok(mine.body.items.every((t) => t.author.id === stylist.me.id));
  const mgr = await manager.get('/api/tickets');
  assert.ok(mgr.body.items.length > 1 && mgr.body.items.every((t) => t.salon.id === MDR));
});

test('directory: stylists do not get peers\' contact details', async () => {
  p.db.prepare("UPDATE users SET phone = '555-0100', email = lower(username) || '@example.test' WHERE role IN ('stylist','salon_manager','district_leader')").run();
  const s = await stylist.get(`/api/directory?salon_id=${MDR}`);
  assert.equal(s.status, 200);
  const peers = s.body.people.filter((x) => x.role === 'stylist' || x.role === 'salon_manager');
  assert.ok(peers.length >= 5);
  for (const x of peers) { assert.equal('phone' in x, false); assert.equal('email' in x, false); }
  const m = await manager.get(`/api/directory?salon_id=${MDR}`);
  assert.ok(m.body.people.every((x) => x.phone === '555-0100'));
  const leaders = await stylist.get('/api/directory?role=district_leader');
  assert.ok(leaders.body.people.length >= 7 && leaders.body.people.every((x) => 'phone' in x), 'field leadership contacts are open');
  assert.equal(JSON.stringify(s.body).includes('password'), false);
  const person = await stylist.get(`/api/people/${peers[0].id}`);
  assert.equal(person.status, 200);
  assert.equal('phone' in person.body.person, false);
});

test('search returns at most five of each and never contact details', async () => {
  const r = await stylist.get('/api/search?q=ma');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['people', 'promos', 'resources', 'salons']);
  for (const k of Object.keys(r.body)) assert.ok(r.body[k].length <= 5);
  assert.ok(r.body.salons.some((s) => s.name.startsWith('Marina')));
  assert.deepEqual(Object.keys(r.body.salons[0]).sort(), ['city', 'id', 'name', 'salon_number']);
  assert.equal(/phone|email/.test(JSON.stringify(r.body.people)), false);
  assert.deepEqual((await stylist.get('/api/search?q=')).body, { people: [], salons: [], resources: [], promos: [] });
});

test('admin routes are closed to the field and gated per permission', async () => {
  for (const c of [stylist, manager, dl]) {
    for (const url of ['/api/admin/users', '/api/admin/overview', '/api/admin/settings', '/api/admin/audit', '/api/admin/promos', '/api/admin/reports', '/api/admin/goals', '/api/admin/salons']) {
      assert.equal((await c.get(url)).status, 403, url);
    }
  }
  assert.equal((await exec.get('/api/admin/users')).status, 403, 'executives are read-only and have no admin console');
  assert.equal((await hr.get('/api/admin/users')).status, 200);
  assert.equal((await hr.get('/api/admin/settings')).status, 403);
  assert.equal((await hr.get('/api/admin/audit')).status, 403);
  assert.equal((await hr.post('/api/admin/import/dsr', { csv: 'date,store_id\n' })).status, 403);
  assert.equal((await admin.get('/api/admin/settings')).status, 200);
  const overview = await admin.get('/api/admin/overview');
  assert.equal(overview.status, 200);
  for (const k of ['users', 'posts_7d', 'shoutouts_7d', 'open_tickets', 'open_hr', 'ack_completion_pct', 'checklist_completion_pct', 'adoption_by_salon']) assert.ok(k in overview.body, k);
  assert.equal(overview.body.adoption_by_salon.length, 51);
  assert.equal((await hr.get('/api/admin/overview')).status, 200);
});

test('user management: HR cannot create or change administrators; changes are audited', async () => {
  const made = await hr.post('/api/admin/users', { first_name: 'Test', last_name: 'Person', role: 'stylist', salon_id: MDR });
  assert.equal(made.status, 200);
  assert.ok(made.body.temp_password.length >= 16);
  assert.equal(made.body.user.must_change_password, true);
  const login = await p.client().login(made.body.user.username, made.body.temp_password);
  assert.equal(login.status, 200);
  assert.equal(login.body.user.must_change_password, true);
  assert.equal((await hr.post('/api/admin/users', { first_name: 'No', last_name: 'Salon', role: 'stylist' })).status, 400);
  assert.equal((await hr.post('/api/admin/users', { first_name: 'Bad', last_name: 'Actor', role: 'admin' })).status, 403);
  assert.equal((await hr.patch(`/api/admin/users/${made.body.user.id}`, { role: 'admin' })).status, 403);
  assert.equal((await hr.patch(`/api/admin/users/${admin.me.id}`, { status: 'inactive' })).status, 403);
  assert.equal((await hr.post(`/api/admin/users/${admin.me.id}/reset-password`)).status, 403);
  assert.equal((await admin.patch(`/api/admin/users/${admin.me.id}`, { role: 'stylist', salon_id: MDR })).status, 400, 'no self-demotion');
  const off = await admin.patch(`/api/admin/users/${made.body.user.id}`, { status: 'inactive' });
  assert.equal(off.status, 200);
  assert.equal((await p.client().login(made.body.user.username, made.body.temp_password)).status, 401);
  const actions = p.db.prepare("SELECT action FROM audit_log WHERE target_type = 'user' AND target_id = ?").all(made.body.user.id).map((a) => a.action);
  assert.ok(actions.includes('user.created') && actions.includes('user.updated'));
  const log = await admin.get('/api/admin/audit?limit=5');
  assert.equal(log.body.items.length, 5);
  assert.ok(log.body.next_cursor);
});

test('settings and content writes are validated and audited', async () => {
  assert.equal((await admin.put('/api/admin/settings', { company_name: '' })).status, 400);
  const ok = await admin.put('/api/admin/settings', { company_name: 'SC Portal', values: [{ key: 'guest_first', label: 'Guest first' }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.values.length, 1);
  const promo = await hr.post('/api/admin/promos', { title: 'Spring event', starts_on: '2027-03-01', ends_on: '2027-03-31' });
  assert.equal(promo.status, 200);
  assert.equal((await hr.post('/api/admin/promos', { summary: 'no title' })).status, 400);
  assert.equal((await hr.patch(`/api/admin/promos/${promo.body.item.id}`, { image_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await hr.del(`/api/admin/promos/${promo.body.item.id}`)).status, 200);
  const tpl = await admin.post('/api/admin/checklist-templates', { key: 'midday', name: 'Midday reset', items: [{ label: 'Sweep' }, { label: 'Restock' }] });
  assert.equal(tpl.status, 200);
  assert.equal(tpl.body.item.items.length, 2);
  const seen = p.db.prepare("SELECT action FROM audit_log WHERE action IN ('settings.updated','promo.created','promo.deleted','checklist_template.created')").all().map((a) => a.action);
  assert.equal(new Set(seen).size, 4);
  const goals = await admin.get('/api/admin/goals');
  assert.equal(goals.body.items.length, 51);
  const put = await admin.put('/api/admin/goals', { period: goals.body.period, items: [{ salon_id: MDR, sales_goal_c: 9000000, product_pct_goal: 10, srph_goal_c: 5500 }] });
  assert.equal(put.status, 200);
  assert.equal((await exec.get(`/api/salons/${MDR}`)).body.kpis.goal.sales_goal_c, 9000000);
});

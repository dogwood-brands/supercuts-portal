'use strict';
const express = require('express');
const { can, isManagerPlus } = require('../rbac');
const { v, bad, forbidden, notFound, idParam, nowIso, addDays, todayLocal, json, round1, pctChange } = require('../util');
const { tenureLabel } = require('../shape');
const { refreshInfo } = require('../refresh');

module.exports = (ctx) => {
  const { db, rbac, shapes, kpi, audit } = ctx;
  const r = express.Router();

  const SALON_SQL = `SELECT s.*, m.name AS market_name, d.name AS district_name, e.code AS entity_code
    FROM salons s LEFT JOIN markets m ON m.id = s.market_id LEFT JOIN districts d ON d.id = s.district_id LEFT JOIN entities e ON e.id = s.entity_id`;

  function cards(rows, user) {
    const m = kpi.metrics();
    const managers = shapes.usersByIds(rows.map((s) => s.manager_user_id).filter(Boolean));
    return rows.map((s) => {
      const x = m.bySalon.get(s.id);
      return {
        id: s.id, salon_number: s.salon_number, name: s.name, concept: s.concept, city: s.city, state: s.state,
        market: s.market_name || null, district: s.district_name || null,
        manager: s.manager_user_id ? managers.get(s.manager_user_id) || null : null,
        photo_url: s.photo_url || null,
        pace_pct: x ? x.block.goal.pace_pct : null,
        rank_company: x ? x.rank_company : null,
        in_scope: rbac.salonInScope(user, s.id),
      };
    });
  }
  ctx.salonCards = cards;
  ctx.SALON_SQL = SALON_SQL;

  r.get('/salons', (req, res) => {
    const rows = db.prepare(`${SALON_SQL} WHERE s.status = 'active' ORDER BY s.name`).all();
    res.json({ items: cards(rows, req.user) });
  });

  r.get('/salons/:id', (req, res) => {
    const s = db.prepare(`${SALON_SQL} WHERE s.id = ?`).get(idParam(req));
    if (!s) throw notFound('We could not find that salon.');
    const m = kpi.metrics();
    const x = m.bySalon.get(s.id);
    const inScope = rbac.salonInScope(req.user, s.id);
    const today = todayLocal();
    const teamRows = db.prepare(`SELECT id, hire_date FROM users WHERE salon_id = ? AND status = 'active'
      ORDER BY CASE role WHEN 'salon_manager' THEN 0 ELSE 1 END, first_name, last_name`).all(s.id);
    const users = shapes.usersByIds(teamRows.map((t) => t.id));
    const alerts = { people: [], store: [], initiative: [] };
    if (inScope) {
      for (const a of db.prepare('SELECT id, group_key, label, state, due_on, updated_at FROM alerts WHERE salon_id = ? ORDER BY id').all(s.id)) {
        alerts[a.group_key].push({ id: a.id, label: a.label, state: a.state, due_on: a.due_on, updated_at: a.updated_at });
      }
    }
    res.json({
      salon: {
        ...cards([s], req.user)[0],
        address: s.address, zip: s.zip, phone: s.phone, shopping_center: s.shopping_center,
        hours: json(s.hours_json, null), entity: s.entity_code || null, lat: s.lat, lng: s.lng, opened_on: s.opened_on,
      },
      team: teamRows.map((t) => ({ ...users.get(t.id), tenure_label: tenureLabel(t.hire_date, today) })),
      kpis: inScope && x ? x.block : null,
      boxes: inScope && x ? x.boxes : [],
      rank: x ? { score: x.score, district: x.rank_district, market: x.rank_market, company: x.rank_company, of_company: m.bySalon.size } : null,
      alerts,
      updated_through: m.through,
      refresh: refreshInfo(db),
    });
  });

  r.get('/salons/:id/dsr', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT 1 FROM salons WHERE id = ?').get(id)) throw notFound('We could not find that salon.');
    rbac.requireSalonScope(req.user, id);
    const m = kpi.metrics();
    const to = v.date(req.query.to, 'to', { required: false }) || m.through || todayLocal();
    const from = v.date(req.query.from, 'from', { required: false }) || `${to.slice(0, 7)}-01`;
    if (from > to) throw bad('The start date must be on or before the end date.');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) throw bad('Choose a range of 400 days or fewer.');
    const rows = db.prepare('SELECT * FROM kpi_daily WHERE salon_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(id, from, to);
    const total = kpi.ZERO();
    const days = rows.map((d) => {
      kpi.add(total, d);
      const x = kpi.derive(d);
      return { date: d.date, net_sales_c: x.net_sales_c, service_c: x.service_c, product_c: x.product_c, guests: x.guests, haircuts: x.haircuts,
        hours: x.hours, atv_c: x.atv_c, srph_c: x.srph_c, product_pct: x.product_pct, supercut_plus: x.supercut_plus };
    });
    res.json({ days, totals: kpi.derive(total), from, to });
  });

  // ---- stylist numbers ----------------------------------------------------
  function stylistRows(from, to, salonId) {
    const where = salonId ? 'AND u.salon_id = ?' : '';
    const args = salonId ? [from, to, salonId] : [from, to];
    return db.prepare(`SELECT sd.user_id, u.salon_id, SUM(sd.service_c) service_c, SUM(sd.product_c) product_c, SUM(sd.guests) guests, SUM(sd.hours) hours
      FROM stylist_daily sd JOIN users u ON u.id = sd.user_id WHERE sd.date BETWEEN ? AND ? AND u.status = 'active' ${where} GROUP BY sd.user_id`).all(...args)
      .map((x) => ({
        ...x, hours: round1(x.hours), total_c: x.service_c + x.product_c,
        srph_c: x.hours > 0 ? Math.round(x.service_c / x.hours) : 0,
        product_pct: x.service_c + x.product_c > 0 ? round1((x.product_c / (x.service_c + x.product_c)) * 100) : 0,
      }));
  }

  r.get('/salons/:id/stylists', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT 1 FROM salons WHERE id = ?').get(id)) throw notFound('We could not find that salon.');
    rbac.requireSalonScope(req.user, id);
    const m = kpi.metrics();
    const period = v.str(req.query.period, 'period', { max: 7, required: false }) || m.period || todayLocal().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw bad('period must look like 2026-11.');
    const from = `${period}-01`;
    const to = addDays(`${period}-01`, 31).slice(0, 7) + '-01';
    const rows = stylistRows(from, addDays(to, -1), id).sort((a, b) => b.total_c - a.total_c);
    rows.forEach((x, i) => { x.rank = i + 1; });
    // Stylists see their own line; managers and above see the whole team.
    const visible = isManagerPlus(req.user) ? rows : rows.filter((x) => x.user_id === req.user.id);
    const users = shapes.usersByIds(visible.map((x) => x.user_id));
    res.json({
      period,
      items: visible.map((x) => ({ user: users.get(x.user_id), service_c: x.service_c, product_c: x.product_c, guests: x.guests, hours: x.hours,
        srph_c: x.srph_c, product_pct: x.product_pct, rank: x.rank })),
    });
  });

  // The DSR / DHR report sales by salon, not by person. Until a per-stylist feed exists this returns the
  // caller's salon figures (level: 'salon'), plus the recognition they personally received.
  r.get('/me/stats', (req, res) => {
    const m = kpi.metrics();
    const period = m.period || todayLocal().slice(0, 7);
    const through = m.through || todayLocal();
    const since = `${period}-01T00:00:00.000Z`;
    const shoutouts = db.prepare(`SELECT COUNT(*) n FROM shoutout_targets t JOIN posts p ON p.id = t.post_id
      WHERE t.target_type = 'user' AND t.target_id = ? AND p.deleted_at IS NULL AND p.created_at >= ?`).get(req.user.id, since).n;
    const x = req.user.salon_id ? m.bySalon.get(req.user.salon_id) : null;
    const b = x ? x.block : null;
    const trend = req.user.salon_id
      ? kpi.trend([req.user.salon_id], 30).map((d) => ({ date: d.date, service_c: d.net_sales_c, net_sales_c: d.net_sales_c }))
      : [];
    res.json({
      period,
      level: 'salon',
      salon_name: x ? x.salon.name : null,
      net_sales_c: b ? b.mtd.net_sales_c : 0,
      service_c: b ? b.mtd.service_c : 0, product_c: b ? b.mtd.product_c : 0, guests: b ? b.mtd.guests : 0, hours: b ? b.mtd.hours : 0,
      srph_c: b ? b.mtd.srph_c : 0, product_pct: b ? b.mtd.product_pct : 0,
      pace_pct: b ? b.goal.pace_pct : null,
      rank_salon: null,
      rank_company: x ? x.rank_company : null,
      of_company: m.bySalon.size,
      shoutouts_received: shoutouts,
      streak_days: 0,
      trend,
    });
  });

  // ---- rollups ------------------------------------------------------------
  // `level` picks the grouping of the breakdown rows: company -> one row per salon, market -> per market,
  // district -> per district. Optional `id` drills into one market or district (rows become its salons).
  r.get('/kpi/overview', (req, res) => {
    const level = v.oneOf(req.query.level || 'company', 'level', ['company', 'market', 'district']);
    const scope = rbac.scopeSalonIds(req.user);
    const wide = can(req.user, 'kpi.company');
    if (!wide && req.user.role !== 'district_leader') throw forbidden('Company rollups are for district leaders and leadership.');
    const m = kpi.metrics();
    let pool = [...m.bySalon.values()].filter((x) => scope === 'all' || scope.includes(x.salon.id));
    const drill = v.int(req.query.id, 'id', { min: 1, required: false });
    let groupKey = level === 'company' ? 'salon' : level;
    if (drill && level !== 'company') {
      pool = pool.filter((x) => (level === 'market' ? x.salon.market_id : x.salon.district_id) === drill);
      groupKey = 'salon';
    }
    const ids = pool.map((x) => x.salon.id);
    const names = {
      market: new Map(db.prepare('SELECT id, name FROM markets').all().map((x) => [x.id, x.name])),
      district: new Map(db.prepare('SELECT id, name FROM districts').all().map((x) => [x.id, x.name])),
    };
    const groups = new Map();
    for (const x of pool) {
      const gid = groupKey === 'salon' ? x.salon.id : groupKey === 'market' ? x.salon.market_id : x.salon.district_id;
      (groups.get(gid) || groups.set(gid, []).get(gid)).push(x);
    }
    const breakdown = [...groups.entries()].map(([gid, list]) => {
      const b = list.length === 1 && groupKey === 'salon' ? list[0].block : kpi.rollup(list.map((x) => x.salon.id));
      return {
        id: gid, type: groupKey,
        label: groupKey === 'salon' ? list[0].salon.name : names[groupKey].get(gid) || 'Unassigned',
        net_sales_c: b.mtd.net_sales_c, pace_pct: b.goal.pace_pct, guests: b.mtd.guests, atv_c: b.mtd.atv_c, srph_c: b.mtd.srph_c,
        product_pct: b.mtd.product_pct, wow_pct: b.wow.net_sales_pct, salons: list.length,
      };
    }).sort((a, b) => (b.pace_pct ?? -1) - (a.pace_pct ?? -1));
    res.json({
      period: m.period, updated_through: m.through, refresh: refreshInfo(db), level,
      totals: ids.length ? kpi.rollup(ids) : null,
      trend: kpi.trend(scope === 'all' && !drill ? 'all' : ids, 30),
      breakdown,
    });
  });

  // ---- leaderboards -------------------------------------------------------
  r.get('/leaderboards', (req, res) => {
    const metric = v.oneOf(req.query.metric || 'pace', 'metric', ['pace', 'sales', 'atv', 'product_pct', 'srph', 'recognition']);
    const group = v.oneOf(req.query.group || 'salon', 'group', ['salon', 'stylist', 'district']);
    const period = v.oneOf(req.query.period || 'mtd', 'period', ['mtd', 'wtd']);
    const m = kpi.metrics();
    const w = kpi.window(period);
    if (!w) return res.json({ items: [], period, metric, group, updated_through: null });
    const me = req.user;
    const idx = (value, base) => (base > 0 ? Math.round((value / base) * 100) : 0);
    const avgOf = (xs) => { const p = xs.filter((x) => x > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0; };
    let items = [];

    if (metric === 'recognition') {
      const count = (from, to) => {
        const rows = db.prepare(`SELECT t.target_type, t.target_id, COUNT(*) n FROM shoutout_targets t JOIN posts p ON p.id = t.post_id
          WHERE p.deleted_at IS NULL AND substr(p.created_at, 1, 10) BETWEEN ? AND ? GROUP BY t.target_type, t.target_id`).all(from, to);
        const userSalon = new Map(db.prepare('SELECT id, salon_id FROM users').all().map((u) => [u.id, u.salon_id]));
        const salonDistrict = new Map(m.salons.map((s) => [s.id, s.district_id]));
        const out = new Map();
        const bump = (k, n) => out.set(k, (out.get(k) || 0) + n);
        for (const x of rows) {
          if (group === 'stylist') { if (x.target_type === 'user') bump(x.target_id, x.n); continue; }
          const salon = x.target_type === 'salon' ? x.target_id : x.target_type === 'user' ? userSalon.get(x.target_id) : null;
          if (group === 'salon') { if (salon) bump(salon, x.n); continue; }
          const district = x.target_type === 'district' ? x.target_id : salon ? salonDistrict.get(salon) : null;
          if (district) bump(district, x.n);
        }
        return out;
      };
      // Recognition can land after the last sales day, so the window runs through today.
      const cur = count(w.from, todayLocal());
      const prev = count(w.prevFrom, w.prevTo);
      items = [...cur.entries()].map(([id, n]) => ({ id, value: n, value_label: `${n} shout-out${n === 1 ? '' : 's'}`, delta: n - (prev.get(id) || 0) }));
    } else if (group === 'stylist') {
      const cur = stylistRows(w.from, w.to);
      const prev = new Map(stylistRows(w.prevFrom, w.prevTo).map((x) => [x.user_id, x]));
      const viewer = shapes.userRow(me.id);
      const avgSales = avgOf(cur.map((x) => x.total_c));
      const avgSrph = avgOf(cur.map((x) => x.srph_c));
      const avgAtv = avgOf(cur.map((x) => (x.guests > 0 ? x.total_c / x.guests : 0)));
      items = cur.filter((x) => x.guests > 0).map((x) => {
        const p = prev.get(x.user_id);
        const dollars = rbac.canSeeStylistStats(viewer, { id: x.user_id, salon_id: x.salon_id });
        const atv = x.guests > 0 ? Math.round(x.total_c / x.guests) : 0;
        const pAtv = p && p.guests > 0 ? Math.round(p.total_c / p.guests) : 0;
        switch (metric) {
          case 'product_pct': return { id: x.user_id, value: x.product_pct, value_label: `${x.product_pct}%`, delta: p ? round1(x.product_pct - p.product_pct) : null };
          case 'srph': return { id: x.user_id, value: dollars ? x.srph_c : idx(x.srph_c, avgSrph), value_label: dollars ? kpi.usd(x.srph_c) : `Index ${idx(x.srph_c, avgSrph)}`, delta: p ? pctChange(x.srph_c, p.srph_c) : null, sort: x.srph_c };
          case 'atv': return { id: x.user_id, value: dollars ? atv : idx(atv, avgAtv), value_label: dollars ? kpi.usd(atv) : `Index ${idx(atv, avgAtv)}`, delta: p ? pctChange(atv, pAtv) : null, sort: atv };
          default: // sales, and pace (stylists carry no goal, so pace ranks by sales against the company average)
            return { id: x.user_id, value: dollars && metric === 'sales' ? x.total_c : idx(x.total_c, avgSales),
              value_label: dollars && metric === 'sales' ? kpi.usd0(x.total_c) : `Index ${idx(x.total_c, avgSales)}`, delta: p ? pctChange(x.total_c, p.total_c) : null, sort: x.total_c };
        }
      });
    } else {
      // salon or district
      const curAgg = kpi.aggBySalon(w.from, w.to);
      const prevAgg = kpi.aggBySalon(w.prevFrom, w.prevTo);
      const units = new Map();
      for (const s of m.salons) {
        const key = group === 'salon' ? s.id : s.district_id;
        if (!key) continue;
        const u = units.get(key) || units.set(key, { id: key, salons: [], cur: kpi.ZERO(), prev: kpi.ZERO() }).get(key);
        u.salons.push(s.id);
        if (curAgg.has(s.id)) kpi.add(u.cur, curAgg.get(s.id));
        if (prevAgg.has(s.id)) kpi.add(u.prev, prevAgg.get(s.id));
      }
      const list = [...units.values()].map((u) => ({ ...u, c: kpi.derive(u.cur), p: kpi.derive(u.prev) }));
      const perSalon = (u) => u.c.net_sales_c / u.salons.length;
      const avgSales = avgOf(list.map(perSalon));
      const avgAtv = avgOf(list.map((u) => u.c.atv_c));
      const avgSrph = avgOf(list.map((u) => u.c.srph_c));
      const scope = rbac.scopeSalonIds(me);
      items = list.filter((u) => u.cur.guests > 0).map((u) => {
        const dollars = scope === 'all' || u.salons.every((sid) => scope.includes(sid));
        switch (metric) {
          case 'pace': {
            // Monthly pace comes from the cached month block; week-to-date ranks by change on the same weekdays.
            if (period === 'wtd') { const d = pctChange(u.cur.net_sales_c, u.prev.net_sales_c); return { id: u.id, value: d ?? 0, value_label: d === null ? 'New' : `${d > 0 ? '+' : ''}${d}% vs last week`, delta: d }; }
            const b = group === 'salon' ? m.bySalon.get(u.id)?.block : kpi.rollup(u.salons);
            const pace = b?.goal.pace_pct ?? 0;
            return { id: u.id, value: pace, value_label: `${pace}%`, delta: pctChange(u.cur.net_sales_c, u.prev.net_sales_c) };
          }
          case 'product_pct': return { id: u.id, value: u.c.product_pct, value_label: `${u.c.product_pct}%`, delta: round1(u.c.product_pct - u.p.product_pct) };
          case 'srph': return { id: u.id, value: dollars ? u.c.srph_c : idx(u.c.srph_c, avgSrph), value_label: dollars ? kpi.usd(u.c.srph_c) : `Index ${idx(u.c.srph_c, avgSrph)}`, delta: pctChange(u.c.srph_c, u.p.srph_c), sort: u.c.srph_c };
          case 'atv': return { id: u.id, value: dollars ? u.c.atv_c : idx(u.c.atv_c, avgAtv), value_label: dollars ? kpi.usd(u.c.atv_c) : `Index ${idx(u.c.atv_c, avgAtv)}`, delta: pctChange(u.c.atv_c, u.p.atv_c), sort: u.c.atv_c };
          default: return { id: u.id, value: dollars ? u.c.net_sales_c : idx(perSalon(u), avgSales), value_label: dollars ? kpi.usd0(u.c.net_sales_c) : `Index ${idx(perSalon(u), avgSales)}`,
            delta: pctChange(u.cur.net_sales_c, u.prev.net_sales_c), sort: group === 'salon' ? u.c.net_sales_c : perSalon(u) };
        }
      });
    }

    items.sort((a, b) => (b.sort ?? b.value) - (a.sort ?? a.value) || a.id - b.id);
    const myDistrict = rbac.userDistrictId(me);
    if (group === 'stylist') {
      const all = items;
      // Top 50 company-wide, then the caller and their own salon's team wherever they rank.
      const salonOf = new Map(db.prepare("SELECT id, salon_id FROM users WHERE status = 'active'").all().map((u) => [u.id, u.salon_id]));
      const top = all.filter((x, i) => i < 50 || x.id === me.id || (me.salon_id && salonOf.get(x.id) === me.salon_id));
      const users = shapes.usersByIds(top.map((x) => x.id));
      items = top.map((x) => {
        const u = users.get(x.id);
        return { rank: all.indexOf(x) + 1, label: u?.name || 'Team member', sub_label: u?.salon?.name || null, value: x.value, value_label: x.value_label,
          delta: x.delta, id: x.id, type: 'user', avatar_url: u?.avatar_url || null, is_me: x.id === me.id };
      });
    } else if (group === 'salon') {
      const info = new Map(db.prepare(`${SALON_SQL}`).all().map((s) => [s.id, s]));
      items = items.map((x, i) => {
        const s = info.get(x.id);
        return { rank: i + 1, label: s?.name || 'Salon', sub_label: s ? `${s.market_name || s.city} · #${s.salon_number}` : null, value: x.value, value_label: x.value_label,
          delta: x.delta, id: x.id, type: 'salon', avatar_url: s?.photo_url || null, is_me: x.id === me.salon_id };
      });
    } else {
      const info = new Map(db.prepare('SELECT d.id, d.name, d.leader_user_id FROM districts d').all().map((d) => [d.id, d]));
      const leaders = shapes.usersByIds([...info.values()].map((d) => d.leader_user_id).filter(Boolean));
      const counts = new Map();
      for (const s of m.salons) counts.set(s.district_id, (counts.get(s.district_id) || 0) + 1);
      items = items.map((x, i) => {
        const d = info.get(x.id);
        const n = counts.get(x.id) || 0;
        return { rank: i + 1, label: d?.name || 'District', sub_label: `${n} salon${n === 1 ? '' : 's'}`, value: x.value, value_label: x.value_label,
          delta: x.delta, id: x.id, type: 'district', avatar_url: d?.leader_user_id ? leaders.get(d.leader_user_id)?.avatar_url || null : null, is_me: x.id === myDistrict };
      });
    }
    res.json({ items, metric, group, period, updated_through: m.through });
  });

  r.patch('/alerts/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM alerts WHERE id = ?').get(idParam(req));
    if (!a) throw notFound('We could not find that alert.');
    if (!isManagerPlus(req.user) || !rbac.salonInScope(req.user, a.salon_id)) throw forbidden('Alerts are updated by the salon manager or district leader.');
    const state = v.oneOf(req.body?.state, 'State', ['ok', 'action']);
    db.prepare('UPDATE alerts SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), a.id);
    audit(req, 'alert.updated', 'alert', a.id, { state });
    res.json({ alert: { id: a.id, label: a.label, state, due_on: a.due_on, updated_at: nowIso() } });
  });

  return r;
};

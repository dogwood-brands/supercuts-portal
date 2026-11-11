'use strict';
// KPI maths (SPEC section 6). One pass over kpi_daily builds every salon's block, boxes and rank;
// the result is cached briefly and dropped whenever KPI data, goals or checklists change.
const { addDays, daysInMonth, mondayOf, round1, pctChange } = require('./util');

const ZERO = () => ({ net_sales_c: 0, service_c: 0, product_c: 0, guests: 0, haircuts: 0, hours: 0, supercut_plus: 0 });
const add = (a, b) => {
  a.net_sales_c += b.net_sales_c; a.service_c += b.service_c; a.product_c += b.product_c;
  a.guests += b.guests; a.haircuts += b.haircuts; a.hours += b.hours; a.supercut_plus += b.supercut_plus;
  return a;
};
/** Adds the derived measures. Percent fields are on a 0-100 scale with one decimal. */
function derive(a) {
  return {
    net_sales_c: a.net_sales_c, service_c: a.service_c, product_c: a.product_c,
    guests: a.guests, haircuts: a.haircuts, hours: round1(a.hours),
    atv_c: a.guests > 0 ? Math.round(a.net_sales_c / a.guests) : 0,
    // Sales per clocked hour, the DSR's "Total Sales / Total Hours" (field name kept for API stability).
    srph_c: a.hours > 0 ? Math.round(a.net_sales_c / a.hours) : 0,
    product_pct: a.net_sales_c > 0 ? round1((a.product_c / a.net_sales_c) * 100) : 0,
    supercut_plus: a.supercut_plus,
  };
}
const median = (xs) => {
  const s = xs.filter((x) => x > 0).sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const usd = (c) => `$${(c / 100).toFixed(2)}`;
const usd0 = (c) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

const WEIGHTS = { pace: 40, srph: 25, product: 20, checklist: 15 };
const CHECKLIST_WINDOW_DAYS = 14;

function makeKpi(db) {
  const maxDate = db.prepare('SELECT MAX(date) AS d FROM kpi_daily');
  const aggStmt = db.prepare(`SELECT salon_id, SUM(net_sales_c) net_sales_c, SUM(service_c) service_c, SUM(product_c) product_c,
    SUM(guests) guests, SUM(haircuts) haircuts, SUM(hours) hours, SUM(supercut_plus) supercut_plus
    FROM kpi_daily WHERE date BETWEEN ? AND ? GROUP BY salon_id`);
  const daysStmt = db.prepare('SELECT COUNT(DISTINCT date) n FROM kpi_daily WHERE date BETWEEN ? AND ?');
  const goalsStmt = db.prepare('SELECT * FROM kpi_goals WHERE period = ?');
  const salonsStmt = db.prepare("SELECT id, name, salon_number, district_id, market_id FROM salons WHERE status = 'active'");
  const dailyTrend = db.prepare('SELECT date, SUM(net_sales_c) net_sales_c, SUM(guests) guests FROM kpi_daily WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date');

  let cache = null;
  let cacheAt = 0;
  const invalidate = () => { cache = null; };

  function aggBySalon(from, to) {
    const map = new Map();
    for (const r of aggStmt.all(from, to)) map.set(r.salon_id, r);
    return map;
  }

  /** Share of daily (open / close) checklists completed per salon over the last two weeks, 0-100. */
  function checklistPct(today) {
    const from = addDays(today, -CHECKLIST_WINDOW_DAYS);
    const to = addDays(today, -1);
    const templates = db.prepare("SELECT id FROM checklist_templates WHERE active = 1 AND key IN ('open','close')").all();
    const expected = templates.length * CHECKLIST_WINDOW_DAYS;
    const map = new Map();
    if (!expected) return { map, expected };
    const ids = templates.map((t) => t.id);
    const rows = db.prepare(`SELECT salon_id, COUNT(*) n FROM checklist_runs
      WHERE completed_at IS NOT NULL AND date BETWEEN ? AND ? AND template_id IN (${ids.map(() => '?').join(',')}) GROUP BY salon_id`).all(from, to, ...ids);
    for (const r of rows) map.set(r.salon_id, Math.min(100, round1((r.n / expected) * 100)));
    return { map, expected };
  }

  function buildBlock(period, elapsedDays, dim, mtd, yday, last7, prev7, goal) {
    const m = derive(mtd);
    // Prefer the DSR's own run-rate; fall back to a straight-line projection when none is loaded.
    const projected = goal && goal.run_rate_c > 0 ? goal.run_rate_c : (elapsedDays > 0 ? Math.round((mtd.net_sales_c / elapsedDays) * dim) : 0);
    const l = derive(last7);
    const p = derive(prev7);
    return {
      period,
      mtd: m,
      goal: {
        sales_goal_c: goal ? goal.sales_goal_c : null,
        pace_pct: goal && goal.sales_goal_c > 0 ? round1((projected / goal.sales_goal_c) * 100) : null,
        projected_c: projected,
        product_pct_goal: goal ? goal.product_pct_goal : null,
        srph_goal_c: goal ? goal.srph_goal_c : null,
      },
      wow: {
        net_sales_pct: pctChange(last7.net_sales_c, prev7.net_sales_c),
        guests_pct: pctChange(last7.guests, prev7.guests),
        atv_pct: pctChange(l.atv_c, p.atv_c),
      },
      yesterday: derive(yday),
    };
  }

  function compute() {
    const through = maxDate.get().d;
    const salons = salonsStmt.all();
    if (!through) return { through: null, period: null, salons, bySalon: new Map(), medianAtv: 0, elapsedDays: 0, dim: 0 };
    const period = through.slice(0, 7);
    const monthStart = `${period}-01`;
    const dim = daysInMonth(period);
    const elapsedDays = daysStmt.get(monthStart, through).n;
    const mtd = aggBySalon(monthStart, through);
    const yday = aggBySalon(through, through);
    const last7 = aggBySalon(addDays(through, -6), through);
    const prev7 = aggBySalon(addDays(through, -13), addDays(through, -7));
    const goals = new Map(goalsStmt.all(period).map((g) => [g.salon_id, g]));
    const { map: checks } = checklistPct(addDays(through, 1));

    const bySalon = new Map();
    for (const s of salons) {
      const block = buildBlock(period, elapsedDays, dim, mtd.get(s.id) || ZERO(), yday.get(s.id) || ZERO(),
        last7.get(s.id) || ZERO(), prev7.get(s.id) || ZERO(), goals.get(s.id) || null);
      bySalon.set(s.id, { salon: s, block, raw: mtd.get(s.id) || ZERO(), checklist_pct: checks.get(s.id) ?? 0, hasData: mtd.has(s.id) });
    }
    const medianAtv = median([...bySalon.values()].map((x) => x.block.mtd.atv_c));
    // The DSR carries a sales target only. Sales per hour and product % are judged against the company median.
    const medianSph = median([...bySalon.values()].map((x) => x.block.mtd.srph_c));
    const medianProduct = median([...bySalon.values()].map((x) => Math.round(x.block.mtd.product_pct * 10))) / 10;

    // Rank score: pace 40, SRPH 25, product % 20, checklist completion 15. Each part is capped at 120% of goal.
    const part = (value, goal) => (goal > 0 && value > 0 ? Math.min(value / goal, 1.2) : 0);
    for (const x of bySalon.values()) {
      const b = x.block;
      x.score = round1(
        WEIGHTS.pace * part(b.goal.pace_pct || 0, 100) +
        WEIGHTS.srph * part(b.mtd.srph_c, b.goal.srph_goal_c || medianSph) +
        WEIGHTS.product * part(b.mtd.product_pct, b.goal.product_pct_goal || medianProduct) +
        WEIGHTS.checklist * part(x.checklist_pct, 100));
    }
    const rankWithin = (list, key) => {
      list.sort((a, b) => b.score - a.score || a.salon.id - b.salon.id);
      list.forEach((x, i) => { x[key] = i + 1; });
    };
    const all = [...bySalon.values()];
    rankWithin([...all], 'rank_company');
    const groupBy = (f) => all.reduce((m, x) => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map());
    for (const g of groupBy((x) => x.salon.district_id).values()) rankWithin(g, 'rank_district');
    for (const g of groupBy((x) => x.salon.market_id).values()) rankWithin(g, 'rank_market');

    // "Check the boxes" on the salon page.
    for (const x of all) {
      const b = x.block;
      const box = (key, label, value, goal, valueLabel, goalLabel) => {
        const pct = goal > 0 ? round1((value / goal) * 100) : 0;
        return { key, label, value_label: valueLabel, goal_label: goalLabel, pct, state: goal > 0 && value >= goal ? 'ok' : 'action' };
      };
      x.boxes = [
        box('pace', 'Pace to goal', b.goal.pace_pct || 0, 100, b.goal.pace_pct === null ? 'No goal set' : `${b.goal.pace_pct}%`, 'Goal: 100%'),
        box('srph', 'Sales per hour', b.mtd.srph_c, b.goal.srph_goal_c || medianSph, usd(b.mtd.srph_c), b.goal.srph_goal_c ? `Goal: ${usd(b.goal.srph_goal_c)}` : `Company median: ${usd(medianSph)}`),
        box('product_pct', 'Product %', b.mtd.product_pct, b.goal.product_pct_goal || medianProduct, `${b.mtd.product_pct}%`, b.goal.product_pct_goal ? `Goal: ${b.goal.product_pct_goal}%` : `Company median: ${medianProduct}%`),
        box('atv', 'Average ticket', b.mtd.atv_c, medianAtv, usd(b.mtd.atv_c), `Company median: ${usd(medianAtv)}`),
        box('checklists', 'Checklists', x.checklist_pct, 90, `${x.checklist_pct}%`, 'Goal: 90%'),
      ];
    }
    return { through, period, salons, bySalon, medianAtv, elapsedDays, dim, goals };
  }

  function metrics() {
    if (!cache || Date.now() - cacheAt > 30000) { cache = compute(); cacheAt = Date.now(); }
    return cache;
  }

  /** KpiBlock for any set of salons (company, market, district rollups). Goals are summed / averaged. */
  function rollup(salonIds) {
    const m = metrics();
    if (!m.through) return null;
    const ids = new Set(salonIds);
    const monthStart = `${m.period}-01`;
    const sum = (map) => { const t = ZERO(); for (const [id, r] of map) if (ids.has(id)) add(t, r); return t; };
    const goals = [...m.goals.values()].filter((g) => ids.has(g.salon_id));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const goal = goals.length ? {
      sales_goal_c: goals.reduce((a, g) => a + g.sales_goal_c, 0),
      product_pct_goal: goals.some((g) => g.product_pct_goal) ? round1(avg(goals.map((g) => g.product_pct_goal || 0))) : null,
      srph_goal_c: goals.some((g) => g.srph_goal_c) ? Math.round(avg(goals.map((g) => g.srph_goal_c || 0))) : null,
      // a rollup has a run-rate only when every salon in it does
      run_rate_c: goals.every((g) => g.run_rate_c > 0) ? goals.reduce((a, g) => a + g.run_rate_c, 0) : null,
    } : null;
    return buildBlock(m.period, m.elapsedDays, m.dim,
      sum(aggBySalon(monthStart, m.through)), sum(aggBySalon(m.through, m.through)),
      sum(aggBySalon(addDays(m.through, -6), m.through)), sum(aggBySalon(addDays(m.through, -13), addDays(m.through, -7))), goal);
  }

  function trend(salonIds, days = 30) {
    const m = metrics();
    if (!m.through) return [];
    const from = addDays(m.through, -(days - 1));
    if (salonIds === 'all') return dailyTrend.all(from, m.through);
    if (!salonIds.length) return [];
    return db.prepare(`SELECT date, SUM(net_sales_c) net_sales_c, SUM(guests) guests FROM kpi_daily
      WHERE date BETWEEN ? AND ? AND salon_id IN (${salonIds.map(() => '?').join(',')}) GROUP BY date ORDER BY date`).all(from, m.through, ...salonIds);
  }

  /** Date window for a leaderboard period, plus the matching previous window for the delta. */
  function window(period) {
    const m = metrics();
    if (!m.through) return null;
    if (period === 'wtd') {
      const from = mondayOf(m.through);
      const len = (Date.parse(m.through) - Date.parse(from)) / 86400000;
      return { from, to: m.through, prevFrom: addDays(from, -7), prevTo: addDays(from, -7 + len) };
    }
    const from = `${m.period}-01`;
    const prevEndOfMonth = addDays(from, -1);
    const prevFrom = `${prevEndOfMonth.slice(0, 7)}-01`;
    const day = Number(m.through.slice(8, 10));
    const prevTo = addDays(prevFrom, Math.min(day, daysInMonth(prevFrom.slice(0, 7))) - 1);
    return { from, to: m.through, prevFrom, prevTo };
  }

  return { metrics, invalidate, aggBySalon, derive, rollup, trend, window, usd, usd0, ZERO, add, median };
}

module.exports = { makeKpi, derive };

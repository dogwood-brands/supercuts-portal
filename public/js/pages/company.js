// Company and district rollup for leadership and district leaders.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, dateShort, refreshNote } from '../core/format.js';

const paceTone = (p) => (p === null || p === undefined ? 'neutral' : p >= 100 ? 'good' : p >= 92 ? 'warn' : 'bad');

function headline(o, label) {
  const t = o.totals;
  if (!t) return h('div', { class: 'card' }, ui.empty({ icon: 'chart', title: 'No numbers yet for this view' }));
  const pace = t.goal?.pace_pct;
  const sales = h('div', { class: 'co-hero-sales t-num' });
  ui.countUp(sales, t.mtd?.net_sales_c || 0, (n) => money(n));
  const gap = (t.goal?.projected_c ?? 0) - (t.goal?.sales_goal_c ?? 0);
  const tile = (lab, value, format, delta) => {
    const s = ui.stat({ label: lab, value: '', delta, hint: delta !== undefined && delta !== null ? 'vs last week' : undefined });
    if (value === null || value === undefined) s.valueEl.textContent = '–';
    else ui.countUp(s.valueEl, value, format);
    return h('div', { class: 'card card-pad' }, s);
  };
  return h('div', { class: 'stack' },
    h('section', { class: 'card card-dark co-hero' },
      h('div', { class: 'co-hero-main' },
        h('div', { class: 't-eyebrow' }, `${label} net sales, month to date`),
        sales,
        h('div', { class: 'co-hero-line' },
          h('span', null, 'Projected ', h('b', { class: 't-num' }, money(t.goal?.projected_c))),
          h('span', null, 'Goal ', h('b', { class: 't-num' }, money(t.goal?.sales_goal_c))),
          t.goal?.sales_goal_c ? h('span', { class: ['co-gap', gap >= 0 ? 'is-up' : 'is-down'] }, gap >= 0 ? `${money(gap, { compact: true })} ahead of goal` : `${money(-gap, { compact: true })} behind goal`) : null,
          t.wow?.net_sales_pct !== null && t.wow?.net_sales_pct !== undefined ? h('span', { class: 'row gap-1' }, ui.delta(t.wow.net_sales_pct), 'vs last week') : null)),
      ui.ring(pace ?? 0, { size: 132, stroke: 11, label: 'pace to goal' })),
    h('div', { class: 'grid grid-4' },
      tile('Guests', t.mtd?.guests, (n) => num(Math.round(n)), t.wow?.guests_pct),
      tile('Average ticket', t.mtd?.atv_c, (n) => money(n, { cents: true }), t.wow?.atv_pct),
      tile('Sales per hour', t.mtd?.srph_c, (n) => money(n, { cents: true })),
      tile('Product share of sales', t.mtd?.product_pct, (n) => pct(n))));
}

function trendCard(o) {
  const trend = o.trend || [];
  if (trend.length < 2) return null;
  return ui.card({ title: 'Daily net sales, last 30 days' }, ui.lineChart({
    series: [{ label: 'Net sales', tone: 'brand', points: trend.map((d) => ({ x: d.date, y: (d.net_sales_c || 0) / 100 })) }],
    yFormat: (v) => money(v * 100, { compact: true }),
    xFormat: (x) => dateShort(x),
    height: 240,
  }));
}

function paceBars(rows, unit) {
  const buckets = [
    { label: '105% and above', test: (p) => p >= 105, tone: 'good' },
    { label: '100 to 105%', test: (p) => p >= 100 && p < 105, tone: 'good' },
    { label: '95 to 100%', test: (p) => p >= 95 && p < 100, tone: '' },
    { label: '90 to 95%', test: (p) => p >= 90 && p < 95, tone: 'muted' },
    { label: 'Below 90%', test: (p) => p < 90, tone: 'brand' },
  ];
  const valid = rows.filter((r) => r.pace_pct !== null && r.pace_pct !== undefined);
  if (!valid.length) return null;
  const on = valid.filter((r) => r.pace_pct >= 100).length;
  return ui.card({ title: 'Pace to goal spread', action: h('span', { class: 't-sm t-muted' }, h('b', { class: 't-num' }, `${on} of ${valid.length}`), ` ${unit} at or above goal`) },
    ui.barChart({
      rows: buckets.map((b) => {
        const n = valid.filter((r) => b.test(r.pace_pct)).length;
        return { label: b.label, value: n, valueLabel: String(n), tone: b.tone };
      }),
      max: Math.max(1, ...buckets.map((b) => valid.filter((r) => b.test(r.pace_pct)).length)),
    }));
}

function breakdownCard(o, st, reload, ctx) {
  const rows = o.breakdown || [];
  const sort = st.sort;
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === 'string' || typeof bv === 'string') return sort.dir * String(av || '').localeCompare(String(bv || ''));
    return sort.dir * ((av ?? -Infinity) - (bv ?? -Infinity));
  });
  const head = (key, label) => {
    const btn = h('button', {
      class: ['co-sort', sort.key === key && 'is-on'], type: 'button',
      'aria-label': `Sort by ${label}`,
      onClick: () => {
        st.sort = { key, dir: sort.key === key ? -sort.dir : (key === 'label' ? 1 : -1) };
        host.replaceWith(breakdownCard(o, st, reload, ctx));
      },
    }, label, sort.key === key ? ui.icon(sort.dir > 0 ? 'arrowUp' : 'arrowDown', 12) : null);
    return btn;
  };
  const isSalonRows = rows[0]?.type === 'salon';
  const title = isSalonRows ? 'Salons' : rows[0]?.type === 'market' ? 'Markets' : 'Districts';
  const host = ui.card({
    title: h('span', { class: 'row gap-2' }, h('h3', null, title), h('span', { class: 'tab-count' }, String(rows.length))),
    action: st.drill ? ui.button('Back to all', { variant: 'ghost', size: 'sm', icon: 'chevronLeft', onClick: () => { st.drill = null; reload(); } }) : null,
    flush: true,
  }, ui.table({
    columns: [
      { key: 'label', label: head('label', isSalonRows ? 'Salon' : title.slice(0, -1)), render: (r) => h('span', { class: 't-strong' }, r.label, !isSalonRows && r.salons ? h('span', { class: 't-xs t-muted' }, `  ${r.salons} salons`) : null) },
      { key: 'pace_pct', label: head('pace_pct', 'Pace'), align: 'right', render: (r) => ui.badge(pct(r.pace_pct), paceTone(r.pace_pct)) },
      { key: 'net_sales_c', label: head('net_sales_c', 'Net sales'), align: 'right', render: (r) => money(r.net_sales_c) },
      { key: 'wow_pct', label: head('wow_pct', 'vs last wk'), align: 'right', render: (r) => ui.delta(r.wow_pct) || '–' },
      { key: 'guests', label: head('guests', 'Guests'), align: 'right', render: (r) => num(r.guests) },
      { key: 'atv_c', label: head('atv_c', 'Avg ticket'), align: 'right', render: (r) => money(r.atv_c, { cents: true }) },
      { key: 'srph_c', label: head('srph_c', 'Sales / hr'), align: 'right', render: (r) => money(r.srph_c, { cents: true }) },
      { key: 'product_pct', label: head('product_pct', 'Product %'), align: 'right', render: (r) => pct(r.product_pct) },
    ],
    rows: sorted,
    onRow: (r) => {
      if (r.type === 'salon') ctx.navigate(`/salon/${r.id}`);
      else { st.drill = { id: r.id, label: r.label }; reload(); }
    },
    empty: ui.empty({ icon: 'store', title: 'Nothing to show here yet' }),
  }));
  host.classList.add('co-breakdown');
  return host;
}

export default {
  title: (ctx) => (ctx.can('kpi.company') ? 'Company' : 'My district'),
  css: true,
  async render(ctx) {
    const wide = ctx.can('kpi.company');
    const st = { level: 'company', drill: null, sort: { key: 'pace_pct', dir: -1 }, seq: 0 };
    const body = h('div', { class: 'stack-lg' });
    const stamp = h('span', { class: 't-sm t-muted' });

    async function load() {
      const seq = ++st.seq;
      mount(body, [ui.skeleton('card', 1), ui.skeleton('stat'), ui.skeleton('table', 8)]);
      try {
        const o = await api.get('/kpi/overview', { level: st.level, id: st.drill?.id });
        if (seq !== st.seq) return;
        const label = st.drill ? st.drill.label : wide ? 'Company' : (ctx.user.district?.name || 'District');
        const rows = o.breakdown || [];
        stamp.textContent = o.updated_through ? `Numbers through ${dateShort(o.updated_through)}${refreshNote(o.refresh) ? ` · ${refreshNote(o.refresh)}` : ''}` : '';
        mount(body, [
          headline(o, label),
          h('div', { class: 'co-two' }, trendCard(o), paceBars(rows, rows[0]?.type === 'salon' ? 'salons' : rows[0]?.type === 'market' ? 'markets' : 'districts')),
          breakdownCard(o, st, load, ctx),
        ].filter(Boolean).map((b, i) => ui.reveal(b, i * 70)));
      } catch (err) {
        if (seq !== st.seq) return;
        mount(body, ui.errorState(err, load));
      }
    }

    const levels = wide ? ui.segmented([
      { key: 'company', label: 'By salon' },
      { key: 'market', label: 'By market' },
      { key: 'district', label: 'By district' },
    ], st.level, (k) => { st.level = k; st.drill = null; st.sort = { key: 'pace_pct', dir: -1 }; load(); }) : null;

    load();
    return h('div', { class: 'company' },
      ui.pageHeader({
        eyebrow: wide ? 'Leadership view' : 'District view',
        title: wide ? 'Company performance' : (ctx.user.district?.name ? `${ctx.user.district.name}` : 'My district'),
        sub: wide ? 'Every salon rolled up. Choose a market or district to open it, or a salon to see its page.' : 'Every salon in your district. Choose a salon to see its page.',
        actions: [stamp, levels],
      }),
      body);
  },
};

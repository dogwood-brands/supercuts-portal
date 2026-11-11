// Scoreboard: who is leading, by salon, stylist or district.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { dateShort } from '../core/format.js';

const GROUPS = [
  { key: 'salon', label: 'Salons' },
  { key: 'stylist', label: 'Stylists' },
  { key: 'district', label: 'Districts' },
];
const METRICS = [
  { key: 'pace', label: 'Pace to goal', blurb: 'Projected month against the sales goal.' },
  { key: 'sales', label: 'Sales', blurb: 'Net sales for the period.' },
  { key: 'atv', label: 'Average ticket', blurb: 'Net sales divided by guests.' },
  { key: 'product_pct', label: 'Product %', blurb: 'Product sales as a share of net sales.' },
  { key: 'srph', label: 'Sales per hour', blurb: 'Net sales for every clocked hour.' },
  { key: 'recognition', label: 'Shout-outs', blurb: 'Recognition received from teammates.' },
];
const PERIODS = [
  { key: 'mtd', label: 'This month' },
  { key: 'wtd', label: 'This week' },
];

let io = null;

function hrefFor(item) {
  if (item.type === 'salon') return `#/salon/${item.id}`;
  if (item.type === 'stylist' || item.type === 'user') return `#/people/${item.id}`;
  return null;
}

function deltaNode(item, metric) {
  if (item.delta === null || item.delta === undefined) return null;
  if (metric === 'recognition') {
    if (!item.delta) return h('span', { class: 'delta delta-flat' }, 'same');
    return h('span', { class: `delta delta-${item.delta > 0 ? 'up' : 'down'}` }, `${item.delta > 0 ? '+' : ''}${item.delta}`);
  }
  if (metric === 'product_pct') {
    const d = Number(item.delta);
    if (Math.abs(d) < 0.05) return h('span', { class: 'delta delta-flat' }, '0.0 pts');
    return h('span', { class: `delta delta-${d > 0 ? 'up' : 'down'}` }, ui.icon(d > 0 ? 'arrowUp' : 'arrowDown', 12), `${Math.abs(d).toFixed(1)} pts`);
  }
  return ui.delta(item.delta);
}

function identity(item, size) {
  const person = item.type === 'stylist' || item.type === 'user';
  const pic = person
    ? ui.avatar({ id: item.id, name: item.label, avatar_url: item.avatar_url }, size)
    : h('span', { class: 'score-glyph', style: { width: `${size}px`, height: `${size}px` } }, ui.icon(item.type === 'district' ? 'users' : 'store', Math.round(size * 0.45)));
  return { pic, person };
}

function podium(items, metric) {
  const order = [items[1], items[0], items[2]].filter(Boolean);
  if (items.length < 3) return null;
  return h('div', { class: 'podium' }, order.map((item) => {
    const { pic } = identity(item, item.rank === 1 ? 76 : 60);
    const href = hrefFor(item);
    const card = h(href ? 'a' : 'div', { class: ['podium-card', `podium-${item.rank}`, item.is_me && 'is-me'], href },
      h('div', { class: 'podium-pic' }, pic, h('span', { class: 'podium-place t-num' }, String(item.rank))),
      h('div', { class: 'podium-name t-clip' }, item.label),
      h('div', { class: 't-xs t-muted t-clip' }, item.sub_label || ''),
      h('div', { class: 'podium-value t-num' }, item.value_label ?? '–'),
      h('div', { class: 'podium-delta' }, deltaNode(item, metric)),
      h('div', { class: 'podium-step' }));
    return ui.reveal(card, item.rank === 1 ? 0 : item.rank === 2 ? 90 : 180);
  }));
}

function row(item, metric, max) {
  const { pic } = identity(item, 36);
  const href = hrefFor(item);
  const width = max > 0 ? Math.max(2, Math.min(100, (Math.abs(Number(item.value) || 0) / max) * 100)) : 0;
  const fill = h('span', { class: 'score-bar-fill' });
  const el = h(href ? 'a' : 'div', { class: ['score-row', item.is_me && 'is-me'], href },
    h('span', { class: 'rank', dataset: { top: item.rank } }, String(item.rank)),
    pic,
    h('span', { class: 'score-who' },
      h('span', { class: 't-strong t-clip' }, item.label, item.is_me ? ui.badge('You', 'brand') : null),
      h('span', { class: 't-xs t-muted t-clip' }, item.sub_label || '')),
    h('span', { class: 'score-bar hide-mobile' }, fill),
    h('span', { class: 'score-val' },
      h('span', { class: 't-num t-strong' }, item.value_label ?? '–'),
      deltaNode(item, metric)));
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${width}%`; }));
  return el;
}

export default {
  title: 'Scoreboard',
  css: true,
  async render(ctx) {
    const st = {
      group: ['salon', 'stylist', 'district'].includes(ctx.query.group) ? ctx.query.group : (ctx.user.role === 'stylist' ? 'stylist' : 'salon'),
      metric: METRICS.some((m) => m.key === ctx.query.metric) ? ctx.query.metric : 'pace',
      period: 'mtd',
      seq: 0,
    };
    const body = h('div', { class: 'stack-lg' });
    const pin = h('div', { class: 'score-pin', hidden: true });
    const blurb = h('p', { class: 't-sm t-muted score-blurb' });

    async function load() {
      const seq = ++st.seq;
      io?.disconnect();
      pin.hidden = true;
      blurb.textContent = METRICS.find((m) => m.key === st.metric)?.blurb || '';
      mount(body, [ui.skeleton('card', 1), ui.skeleton('table', 8)]);
      try {
        const r = await api.get('/leaderboards', { metric: st.metric, group: st.group, period: st.period });
        if (seq !== st.seq) return;
        const items = (r.items || []).map((x, i) => ({ ...x, rank: x.rank || i + 1 }));
        if (!items.length) {
          mount(body, h('div', { class: 'card' }, ui.empty({
            icon: 'trophy', title: 'No results for this view yet',
            body: st.period === 'wtd' ? 'The week has only just started. Check back after the first day is in.' : 'Numbers will appear once the daily report is loaded.',
          })));
          return;
        }
        const max = Math.max(...items.map((x) => Math.abs(Number(x.value) || 0)));
        const rest = items.length >= 3 ? items.slice(3) : items;
        const list = h('div', { class: 'card score-list' }, rest.map((x) => row(x, st.metric, max)));
        mount(body, [
          podium(items, st.metric),
          rest.length ? list : null,
          h('p', { class: 't-xs t-faint t-center' },
            r.updated_through ? `Numbers through ${dateShort(r.updated_through)}. ` : '',
            'Dollar figures show for your own salon. Elsewhere you see an index, where 100 is the company average.'),
        ]);
        // keep the caller's own row in view: pin a copy to the bottom while the real row is off screen
        const me = items.find((x) => x.is_me);
        const meEl = body.querySelector('.is-me');
        if (me && meEl && 'IntersectionObserver' in window) {
          mount(pin, row(me, st.metric, max));
          io = new IntersectionObserver(([entry]) => { pin.hidden = entry.isIntersecting; }, { threshold: 0.2 });
          io.observe(meEl);
        }
      } catch (err) {
        if (seq !== st.seq) return;
        mount(body, ui.errorState(err, load));
      }
    }

    // Stylists carry no sales goal, so "pace to goal" is only offered for salons and districts.
    // Sales are reported by salon, not by person, so people are ranked on recognition only.
    const metricsFor = () => (st.group === 'stylist' ? METRICS.filter((m) => m.key === 'recognition') : METRICS);
    if (st.group === 'stylist') st.metric = 'recognition';
    const metricSel = h('select', { class: 'select score-metric-select', 'aria-label': 'Measure' });
    const metricSeg = h('div', { class: 'score-metric-seg' });
    const onMetric = (k) => { st.metric = k; metricSel.value = k; load(); };
    const paintMetrics = () => {
      const list = metricsFor();
      if (!list.some((m) => m.key === st.metric)) st.metric = 'sales';
      mount(metricSel, list.map((m) => h('option', { value: m.key, selected: m.key === st.metric }, m.label)));
      mount(metricSeg, ui.segmented(list, st.metric, onMetric));
    };
    metricSel.addEventListener('change', () => { st.metric = metricSel.value; paintMetrics(); load(); });
    paintMetrics();

    const el = h('div', { class: 'scoreboard' },
      ui.pageHeader({
        eyebrow: 'Scoreboard',
        title: 'Who is leading',
        sub: 'Friendly competition across every salon. Updated each morning with the daily report.',
        actions: ui.segmented(PERIODS, st.period, (k) => { st.period = k; load(); }),
      }),
      h('div', { class: 'score-controls' },
        ui.segmented(GROUPS, st.group, (k) => { st.group = k; if (k === 'stylist') st.metric = 'recognition'; paintMetrics(); load(); }),
        metricSeg, metricSel),
      blurb, body, pin);
    load();
    return el;
  },
  teardown() {
    io?.disconnect();
    io = null;
  },
};

// My pay plan (v1.1): the plan for the person's state (California, Nevada or Arizona), the measures it is
// built on as the salon stands this month, and the link to iSolved for benefits. No hourly wages, ever.
// Personal figures and an estimated bonus arrive once a per-stylist report is connected (phase 1.1).

import { h, markdown } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, dateShort } from '../core/format.js';
import { region } from './admin/kit.js';

const STATE = { CA: 'California', NV: 'Nevada', AZ: 'Arizona' };

function measures(s) {
  const tile = (label, value, hint) => h('div', { class: 'card card-pad' }, ui.stat({ label, value, hint }));
  return h('div', { class: 'grid grid-3' },
    tile('Salon net revenue run-rate', money(s.projected_c), s.sales_goal_c ? `Goal ${money(s.sales_goal_c)}` : null),
    tile('Salon percent to goal', s.pace_pct === null || s.pace_pct === undefined ? '–' : pct(s.pace_pct), 'From the daily sales report'),
    tile('Salon TSTH', money(s.srph_c, { cents: true }), 'Total sales per total hour'),
    tile('Salon haircuts', num(s.haircuts_mtd), 'Month to date'),
    tile('Supercut Plus', num(s.supercut_plus), s.supercut_plus_pct !== null && s.supercut_plus_pct !== undefined ? `${pct(s.supercut_plus_pct)} of haircuts` : null),
    tile('Product share', pct(s.product_pct), 'Of salon net revenue'));
}

export default {
  title: 'My pay plan',
  css: true,
  render(ctx) {
    const u = ctx.user;
    const plan = u.pay_plan || u.salon?.state || null;
    const host = h('div');
    const isolved = ctx.settings?.isolved_url;
    region(host, async () => {
      const [{ items = [] }, stats] = await Promise.all([
        api.get('/resources', { section: 'hr' }),
        u.salon ? api.get('/me/stats').catch(() => null) : Promise.resolve(null),
      ]);
      const plans = items.filter((r) => r.category === 'Pay plan');
      const mine = plans.find((r) => plan && r.title.startsWith(STATE[plan] || '---'));
      const doc = mine ? await api.get(`/resources/${mine.id}`).then((x) => x.resource).catch(() => null) : null;
      return h('div', { class: 'stack-lg' },
        doc
          ? ui.card({ title: doc.title, action: ui.badge(STATE[plan] || plan) }, markdown(doc.body_md || ''))
          : ui.card({ title: 'Your pay plan' }, h('p', { class: 't-muted' }, plan ? 'Your plan is being posted. Ask HR privately if you need it today.' : 'We do not know which plan you are on yet. Ask HR privately and they will confirm it.')),
        stats ? h('section', { class: 'stack' },
          h('div', { class: 'row row-between gap-3 row-wrap' },
            h('h2', null, 'Where the salon stands this month'),
            h('span', { class: 't-sm t-muted' }, stats.updated_through ? `Salon totals through ${dateShort(stats.updated_through)}` : 'Salon totals')),
          measures(stats),
          h('p', { class: 't-sm t-muted' }, 'These are your salon’s figures from the daily sales report, not yours alone. Your own total sales, TSTH, Supercut Plus, haircuts, wet services and product sales will show here once the per-stylist report is connected.')) : null,
        plans.length > 1 ? ui.card({ title: 'Other state plans', flush: true },
          h('div', { class: 'list' }, plans.filter((r) => r !== mine).map((r) => h('a', { href: `#/standards/${r.id}` }, ui.icon('book', 18), h('span', { class: 'grow' }, r.title), ui.icon('chevronRight', 14))))) : null);
    }, { skeleton: 'card', count: 2 });
    return h('div', null,
      ui.pageHeader({
        eyebrow: 'My job',
        title: 'My pay plan',
        sub: 'How your pay plan works and the measures it is built on.',
        actions: isolved ? h('a', { class: 'btn btn-secondary', href: isolved, target: '_blank', rel: 'noopener' }, ui.icon('external', 18), 'Benefits in iSolved') : null,
      }),
      host);
  },
};

// My job: the personal hub. To-dos, sign-offs, my numbers and the links people ask HR for most.

import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, greeting, dateShort } from '../core/format.js';
import { region, daysUntil } from './admin/kit.js';

const TODO_ICON = { ack: 'edit', announcement: 'megaphone', checklist: 'checklist', training: 'play' };
const TODO_LABEL = { ack: 'Sign-off', announcement: 'Announcement', checklist: 'Checklist', training: 'Training' };

function tile({ icon, title, body, href, external }) {
  return h('a', { class: 'card card-link job-tile', href, ...(external ? { target: '_blank', rel: 'noopener' } : {}) },
    h('span', { class: 'job-tile-icon' }, ui.icon(icon, 22)),
    h('div', { class: 'grow' },
      h('h3', null, title),
      h('p', { class: 't-sm t-muted' }, body)),
    ui.icon(external ? 'external' : 'chevronRight', 18));
}

function todoCard() {
  const host = h('div');
  region(host, async () => {
    const { items = [] } = await api.get('/me/todo');
    if (!items.length) {
      return ui.empty({ icon: 'check', title: 'You are all caught up', body: 'Nothing needs your attention right now. New sign-offs and announcements will show up here.' });
    }
    return h('div', { class: 'list' }, items.map((t) => {
      const d = daysUntil(t.due_on);
      return h('a', { href: `#${t.link || '/'}` },
        h('span', { class: 'todo-icon', dataset: { kind: t.kind } }, ui.icon(TODO_ICON[t.kind] || 'flag', 18)),
        h('div', { class: 'grow' },
          h('div', { class: 't-strong t-clamp-2' }, t.title),
          h('div', { class: 't-xs t-muted' }, TODO_LABEL[t.kind] || 'To do')),
        t.due_on ? ui.badge(d < 0 ? 'Overdue' : d === 0 ? 'Today' : `Due ${dateShort(t.due_on)}`, d <= 0 ? 'bad' : 'neutral') : null,
        ui.icon('chevronRight', 16));
    }));
  }, { skeleton: 'list', count: 4 });
  return ui.card({ title: 'Needs your attention', flush: true }, host);
}

function statsCard(ctx) {
  const host = h('div');
  region(host, async () => {
    let s;
    try {
      s = await api.get('/me/stats');
    } catch (err) {
      if (err.status === 404 || err.status === 403) s = null; else throw err;
    }
    if (!s || (s.service_c === undefined && s.guests === undefined)) {
      return h('div', { class: 'col gap-3' },
        h('p', { class: 't-sm t-muted' }, 'Personal numbers show here for people who work behind the chair. For salon and company results, open the scoreboard.'),
        h('div', null, ui.button('Open the scoreboard', { variant: 'secondary', size: 'sm', icon: 'trophy', onClick: () => ctx.navigate('/scoreboard') })));
    }
    const value = (el, to, fmt) => { ui.countUp(el.valueEl, to, fmt); return el; };
    return h('div', { class: 'col gap-4' },
      h('div', { class: 'grid grid-2 job-stats' },
        value(ui.stat({ label: 'Salon net sales', hint: 'This month' }), (s.net_sales_c ?? s.service_c) || 0, (n) => money(n)),
        value(ui.stat({ label: 'Guests', hint: 'This month' }), s.guests || 0, (n) => num(Math.round(n))),
        value(ui.stat({ label: 'Product share', hint: 'Of salon sales' }), s.product_pct || 0, (n) => pct(n)),
        value(ui.stat({ label: 'Shout-outs', hint: 'Received' }), s.shoutouts_received || 0, (n) => num(Math.round(n)))),
      s.trend && s.trend.length > 1 ? h('div', { class: 'row row-between gap-3' },
        h('span', { class: 't-xs t-muted' }, 'Daily salon sales'),
        ui.sparkline(s.trend.map((p) => p.service_c), { w: 160, h: 36, tone: 'brand' })) : null,
      h('div', { class: 'row row-between gap-3 row-wrap t-sm' },
        s.rank_salon ? h('span', null, 'Rank in your salon ', h('strong', { class: 't-num' }, `#${s.rank_salon}`)) : null,
        s.rank_company ? h('span', { class: 't-muted' }, `Salon rank #${s.rank_company}${s.of_company ? ` of ${num(s.of_company)}` : ''}`) : null));
  }, { skeleton: 'list', count: 3 });
  return ui.card({ title: 'My salon this month', action: h('a', { class: 't-link t-sm', href: '#/scoreboard' }, 'Scoreboard') }, host);
}

function signoffCard() {
  const host = h('div');
  region(host, async () => {
    const { items = [] } = await api.get('/resources');
    const need = items.filter((r) => r.requires_ack);
    if (!need.length) return h('p', { class: 't-sm t-muted' }, 'No documents need a sign-off right now.');
    const done = need.filter((r) => r.acknowledged_at).length;
    return h('div', { class: 'col gap-4' },
      ui.progress((done / need.length) * 100, { tone: done === need.length ? 'good' : 'brand', label: `${done} of ${need.length} signed` }),
      h('ul', { class: 'signoff-list' }, need.map((r) => h('li', null,
        h('a', { class: 'row gap-3', href: `#/standards/${r.id}` },
          h('span', { class: ['dot', r.acknowledged_at ? 'dot-good' : 'dot-bad'] }),
          h('span', { class: 'grow t-sm t-clip' }, r.title),
          h('span', { class: 't-xs t-muted' }, r.acknowledged_at ? dateShort(r.acknowledged_at) : 'To sign'))))));
  }, { skeleton: 'list', count: 3 });
  return ui.card({ title: 'Policy sign-offs' }, host);
}

export default {
  title: 'My job',
  css: true,
  render(ctx) {
    const u = ctx.user;
    const tiles = [
      { icon: 'lifebuoy', title: ctx.can('hr.inbox') ? 'HR inbox' : 'Ask HR', body: ctx.can('hr.inbox') ? 'Questions from the team, waiting for an answer.' : 'A private question about pay, your schedule, benefits or leave.', href: '#/hr' },
      { icon: 'book', title: 'Employee handbook', body: 'The handbook and the policies we all work by.', href: '#/standards?section=hr' },
      { icon: 'play', title: 'Training', body: 'Short videos on technique, guests, retail and running the salon.', href: '#/tube' },
      { icon: 'gift', title: 'Pay and benefits', body: 'How pay works, benefits you can enrol in, and who to ask.', href: '#/standards?section=policies' },
      { icon: 'calendar', title: 'My schedule', body: 'Your manager posts the schedule in the salon. Changes go through them. Key dates are on the calendar.', href: '#/operations?tab=calendar' },
      { icon: 'users', title: 'Directory', body: 'Find your district leader, the home office or another salon.', href: '#/directory' },
    ];
    return h('div', null,
      ui.pageHeader({
        eyebrow: 'My job',
        title: `${greeting()}, ${u.first_name || (u.name || '').split(' ')[0]}.`,
        sub: 'Everything about working here that is yours: what needs doing, your numbers, and where to get help.',
        actions: ui.button(ctx.can('hr.inbox') ? 'Open HR inbox' : 'Ask HR a question', { variant: 'secondary', icon: 'lifebuoy', onClick: () => ctx.navigate(ctx.can('hr.inbox') ? '/hr' : '/hr?new=1') }),
      }),
      h('div', { class: 'layout-rail' },
        h('div', { class: 'stack-lg' },
          todoCard(),
          h('div', null,
            h('div', { class: 'group-title' }, h('h2', null, 'Quick links')),
            h('div', { class: 'grid grid-2 job-tiles' }, tiles.map((t, i) => ui.reveal(tile(t), i * 40))))),
        h('aside', { class: 'rail stack' }, statsCard(ctx), signoffCard())));
  },
};

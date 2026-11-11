// Promos: what is running now, what is coming, what has ended, and how to talk about each one.

import { h, markdown } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { region, daysUntil, dateRange, backLink, cover } from './admin/kit.js';

function timing(p) {
  const toStart = daysUntil(p.starts_on);
  const toEnd = daysUntil(p.ends_on);
  if (toStart !== null && toStart > 0) return { text: toStart === 1 ? 'Starts tomorrow' : `Starts in ${toStart} days`, tone: 'info' };
  if (toEnd !== null && toEnd < 0) return { text: 'Ended', tone: 'neutral' };
  if (toEnd === null) return { text: 'Running now', tone: 'good' };
  if (toEnd === 0) return { text: 'Last day', tone: 'bad' };
  if (toEnd <= 7) return { text: `${toEnd} ${toEnd === 1 ? 'day' : 'days'} left`, tone: 'warn' };
  return { text: `${toEnd} days left`, tone: 'good' };
}

function promoCard(p, i) {
  const t = timing(p);
  const card = h('a', { class: 'card card-link promo-card', href: `#/promos/${p.id}` },
    h('div', { class: 'promo-card-media' },
      cover(p.image_url, { iconName: 'tag' }),
      h('span', { class: 'promo-card-timing' }, ui.badge(t.text, t.tone === 'neutral' ? 'dark' : t.tone))),
    h('div', { class: 'card-pad col gap-2' },
      p.tag ? h('div', { class: 't-eyebrow' }, p.tag) : null,
      h('h3', { class: 't-lg' }, p.title),
      p.summary ? h('p', { class: 't-sm t-muted t-clamp-3' }, p.summary) : null,
      h('div', { class: 'row gap-2 t-xs t-muted promo-card-dates' }, ui.icon('calendar', 14), dateRange(p.starts_on, p.ends_on))));
  return ui.reveal(card, Math.min(i, 6) * 50);
}

function listView() {
  const host = h('div');
  let status = 'active';
  const EMPTY = {
    active: ['No promos are running right now', 'When the next offer starts it will show up here with everything you need to explain it.'],
    upcoming: ['Nothing scheduled yet', 'Upcoming offers appear here ahead of their start date so the team can get ready.'],
    past: ['No past promos', 'Offers that have ended are kept here for reference.'],
  };
  const reload = region(host, async () => {
    const { items = [] } = await api.get('/promos', { status });
    if (!items.length) return ui.empty({ icon: 'tag', title: EMPTY[status][0], body: EMPTY[status][1] });
    return h('div', { class: 'grid promo-grid' }, items.map(promoCard));
  });
  return h('div', null,
    ui.pageHeader({ eyebrow: 'Sell', title: 'Promos', sub: 'Every current offer, with the dates, how to ring it and what to say at the chair.' }),
    ui.tabs([{ key: 'active', label: 'Running now' }, { key: 'upcoming', label: 'Coming up' }, { key: 'past', label: 'Ended' }], status, (k) => { status = k; reload(); }),
    host);
}

function detailView(id) {
  const host = h('div');
  region(host, async () => {
    const { promo: p } = await api.get(`/promos/${encodeURIComponent(id)}`);
    const t = timing(p);
    const toEnd = daysUntil(p.ends_on);
    const total = p.starts_on && p.ends_on ? daysUntil(p.ends_on) - daysUntil(p.starts_on) : null;
    const elapsed = total && toEnd !== null ? Math.max(0, Math.min(100, ((total - toEnd) / total) * 100)) : null;
    const running = t.tone !== 'info' && t.tone !== 'neutral';
    return h('article', { class: 'stack-lg' },
      backLink('#/promos', 'All promos'),
      h('div', { class: 'promo-hero' },
        cover(p.image_url, { iconName: 'tag' }),
        h('div', { class: 'promo-hero-copy' },
          h('div', { class: 'row gap-2 row-wrap' }, ui.badge(t.text, t.tone === 'neutral' ? 'dark' : t.tone), p.tag ? ui.badge(p.tag) : null),
          h('h1', null, p.title),
          p.summary ? h('p', { class: 't-lg' }, p.summary) : null)),
      h('div', { class: 'layout-rail' },
        ui.card({}, p.body ? markdown(p.body) : h('p', { class: 't-muted' }, 'Details for this offer have not been added yet. Ask your district leader if you need them today.')),
        h('aside', { class: 'rail stack' },
          ui.card({ title: 'Dates' },
            h('div', { class: 'col gap-4' },
              h('div', { class: 'row gap-3' }, ui.icon('calendar', 18), h('span', { class: 't-strong' }, dateRange(p.starts_on, p.ends_on) || 'No end date set')),
              running && elapsed !== null ? ui.progress(elapsed, { tone: toEnd <= 7 ? 'warn' : 'good', label: 'Through the offer' }) : null,
              h('p', { class: 't-sm t-muted' }, running
                ? 'Mention it to every guest it fits. A quick, friendly offer at the chair works better than a sign on the door.'
                : t.tone === 'info' ? 'Not live yet. Use the time to read the steps and practise the wording with your team.' : 'This offer has ended and should no longer be applied at checkout.'))),
          ui.card({ title: 'Questions' },
            h('p', { class: 't-sm t-muted' }, 'Not sure how to ring it or whether a guest qualifies? Ask your salon manager first, then your district leader.'),
            h('div', { style: { marginTop: 'var(--s-3)' } }, ui.button('Open a support ticket', { variant: 'secondary', size: 'sm', icon: 'ticket', onClick: () => { location.hash = '/tickets?new=marketing'; } }))))));
  }, { count: 2 });
  return host;
}

export default {
  title: 'Promos',
  css: true,
  render(ctx) {
    return ctx.params.id ? detailView(ctx.params.id) : listView();
  },
};

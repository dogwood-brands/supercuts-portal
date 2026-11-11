// Profile page for one person: who they are, where they work, the recognition they have earned.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, roleLabel, plural, dateShort } from '../core/format.js';
import { postCard } from './home.js';

function ensureHomeCss() {
  if (document.querySelector('link[href="/css/pages/home.css"]')) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: '/css/pages/home.css' }));
}

function tenure(hireDate) {
  if (!hireDate) return null;
  const [y, m, d] = String(hireDate).slice(0, 10).split('-').map(Number);
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months -= 1;
  if (months < 1) return 'New this month';
  const yrs = Math.floor(months / 12);
  const mo = months % 12;
  if (!yrs) return `${mo} ${mo === 1 ? 'month' : 'months'}`;
  return `${yrs} ${yrs === 1 ? 'year' : 'years'}${mo ? `, ${mo} ${mo === 1 ? 'month' : 'months'}` : ''}`;
}

export default {
  title: 'Profile',
  css: true,
  async render(ctx) {
    ensureHomeCss();
    const r = await api.get(`/people/${ctx.params.id}`);
    const p = r.person || {};
    const isMe = p.id === ctx.user.id;
    const since = tenure(p.hire_date);

    const facts = [
      p.salon ? h('a', { href: `#/salon/${p.salon.id}` }, ui.icon('store', 16), h('span', null, `${p.salon.name}  #${p.salon.salon_number}`)) : null,
      p.salon?.market ? h('span', null, ui.icon('pin', 16), h('span', null, p.salon.market)) : null,
      since ? h('span', null, ui.icon('clock', 16), h('span', null, `With the team ${since}`)) : null,
      p.phone ? h('a', { href: `tel:${String(p.phone).replace(/[^\d+]/g, '')}` }, ui.icon('phone', 16), h('span', null, p.phone)) : null,
      p.email ? h('a', { href: `mailto:${p.email}` }, ui.icon('mail', 16), h('span', null, p.email)) : null,
    ].filter(Boolean);

    const hero = h('header', { class: 'card profile-hero' },
      h('div', { class: 'profile-band' }),
      h('div', { class: 'profile-main' },
        h('div', { class: 'profile-avatar' }, ui.avatar(p, 104)),
        h('div', { class: 'grow profile-id' },
          h('h1', null, p.name || 'Team member'),
          h('div', { class: 'row row-wrap gap-2' },
            h('span', { class: 't-muted' }, p.title || roleLabel(p.role)),
            ui.badge(roleLabel(p.role), p.role === 'stylist' ? 'neutral' : 'dark'))),
        isMe ? ui.button('Edit my profile', { variant: 'secondary', icon: 'edit', onClick: () => ctx.navigate('/account') }) : null),
      p.bio ? h('p', { class: 'profile-bio' }, p.bio) : null,
      facts.length ? h('div', { class: 'profile-facts' }, facts) : null);

    // own numbers (stylists and managers see their own; leaders see a salon's stylists on the salon page)
    const statsHost = h('div');
    if (isMe && ctx.user.salon) {
      mount(statsHost, ui.skeleton('stat'));
      api.get('/me/stats').then((s) => {
        // Sales are reported by salon, not by person; the salon page carries those numbers.
        if (s.level === 'salon') { mount(statsHost, null); return; }
        const tile = (label, value) => h('div', { class: 'card card-pad' }, ui.stat({ label, value }));
        mount(statsHost, h('section', null,
          h('div', { class: 'row row-between profile-section-head' }, h('h2', null, 'My month so far'), h('span', { class: 't-sm t-muted' }, 'Only you and your leaders see these')),
          h('div', { class: 'grid grid-4' },
            tile('Service sales', money(s.service_c)),
            tile('Guests served', num(s.guests)),
            tile('Sales per hour', money(s.srph_c, { cents: true })),
            tile('Product share', pct(s.product_pct))),
          s.trend?.length > 1 ? h('div', { class: 'profile-trend' }, ui.card({ title: 'My daily service sales' }, ui.lineChart({
            series: [{ label: 'Service sales', tone: 'brand', points: s.trend.map((d) => ({ x: d.date, y: (d.service_c || 0) / 100 })) }],
            yFormat: (v) => money(v * 100),
            xFormat: (x) => dateShort(x),
            height: 180,
          }))) : null));
      }).catch(() => mount(statsHost, null));
    }

    const shoutouts = r.shoutouts || [];
    const recognition = h('section', null,
      h('div', { class: 'row row-between profile-section-head' },
        h('h2', null, 'Recognition'),
        h('span', { class: 'row gap-2 t-sm' }, ui.icon('star', 16), h('b', { class: 't-num' }, String(r.shoutout_count ?? shoutouts.length)), h('span', { class: 't-muted' }, (r.shoutout_count ?? shoutouts.length) === 1 ? 'shout-out received' : 'shout-outs received'))),
      shoutouts.length
        ? h('div', { class: 'stack profile-posts' }, shoutouts.map((post, i) => ui.reveal(postCard(post, ctx), Math.min(i, 4) * 50)))
        : h('div', { class: 'card' }, ui.empty({
          icon: 'star',
          title: isMe ? 'No shout-outs yet' : `No shout-outs for ${p.first_name || 'them'} in the last 90 days`,
          body: isMe ? 'When a teammate recognises you it will show up here.' : 'Seen them do something great? Head to the home feed and send one.',
          action: isMe ? null : ui.button('Send a shout-out', { variant: 'secondary', icon: 'star', onClick: () => ctx.navigate('/') }),
        })));

    return h('div', { class: 'profile stack-lg' }, hero, statsHost, recognition,
      shoutouts.length >= 10 ? h('p', { class: 't-xs t-faint t-center' }, `Showing the latest ${plural(shoutouts.length, 'shout-out')}.`) : null);
  },
};

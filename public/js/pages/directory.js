// Directory (v1.1): portfolio leadership, district leaders, and every salon A to Z by state with its address,
// phone, email and manager. No list of every stylist: it would go stale as people join and leave, and
// questions should go through the salon and its leaders.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { region, searchBox } from './admin/kit.js';

function contactLinks(p) {
  return [
    p.phone ? h('a', { class: 'row gap-2 t-sm contact-link', href: `tel:${String(p.phone).replace(/[^\d+]/g, '')}` }, ui.icon('phone', 14), p.phone) : null,
    p.email ? h('a', { class: 'row gap-2 t-sm contact-link', href: `mailto:${p.email}` }, ui.icon('mail', 14), h('span', { class: 't-clip' }, p.email)) : null,
  ].filter(Boolean);
}

function personCard(p, sub) {
  const contact = contactLinks(p);
  return h('div', { class: 'card person-card' },
    h('a', { class: 'person-card-main', href: `#/people/${p.id}` },
      ui.avatar(p, 52),
      h('div', { class: 'grow' },
        h('div', { class: 't-strong t-clip' }, p.name),
        h('div', { class: 't-sm t-muted t-clip' }, p.title || ''),
        sub ? h('div', { class: 't-xs t-faint t-clip' }, sub) : null)),
    contact.length ? h('div', { class: 'person-card-contact' }, contact) : null);
}

function salonRow(s) {
  const addr = [s.address, [s.city, s.state].filter(Boolean).join(', '), s.zip].filter(Boolean).join(' · ');
  return h('div', { class: 'dir-salon' },
    h('a', { class: 'dir-salon-name', href: `#/salon/${s.id}` },
      h('span', { class: 't-strong' }, s.name), h('span', { class: 't-xs t-faint t-num' }, ` #${s.salon_number}`)),
    h('div', { class: 't-sm t-muted dir-salon-addr' }, addr),
    h('div', { class: 'dir-salon-contact' },
      s.phone ? h('a', { class: 'row gap-2 t-sm contact-link', href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}` }, ui.icon('phone', 14), s.phone) : null,
      s.email ? h('a', { class: 'row gap-2 t-sm contact-link', href: `mailto:${s.email}` }, ui.icon('mail', 14), h('span', { class: 't-clip' }, s.email)) : null),
    h('div', { class: 't-sm dir-salon-mgr' }, s.manager ? h('span', null, h('span', { class: 't-muted' }, 'Manager '), s.manager.name) : h('span', { class: 't-muted' }, 'Manager position open')));
}

export default {
  title: 'Directory',
  css: true,
  render(ctx) {
    const host = h('div');
    let q = ctx.query.q || '';
    const load = region(host, async () => {
      const d = await api.get('/directory', { q });
      const salons = (d.states || []).reduce((n, st) => n + st.salons.length, 0);
      const sections = [];
      if ((d.leadership || []).length) {
        sections.push(h('section', { class: 'stack' },
          h('h2', null, 'Portfolio leadership'),
          h('div', { class: 'grid people-grid' }, d.leadership.map((p) => personCard(p)))));
      }
      if ((d.district_leaders || []).length) {
        sections.push(h('section', { class: 'stack' },
          h('h2', null, 'District leaders'),
          h('div', { class: 'grid people-grid' }, d.district_leaders.map((p) => personCard(p, p.district ? `${p.district.name} · ${p.district.salons} salons` : null)))));
      }
      for (const st of d.states || []) {
        sections.push(h('section', { class: 'stack' },
          h('div', { class: 'row row-between' }, h('h2', null, st.name), h('span', { class: 't-sm t-muted' }, `${st.salons.length} ${st.salons.length === 1 ? 'salon' : 'salons'}`)),
          ui.card({ flush: true }, h('div', { class: 'dir-salons' }, st.salons.map(salonRow)))));
      }
      if (!sections.length) return ui.empty({ icon: 'search', title: `Nothing matches "${q}"`, body: 'Try a salon name, a city or a salon number.' });
      return h('div', { class: 'stack-lg' }, q ? h('p', { class: 't-sm t-muted' }, `${salons} ${salons === 1 ? 'salon' : 'salons'} match.`) : null, sections);
    }, { skeleton: 'list', count: 6 });

    return h('div', null,
      ui.pageHeader({ eyebrow: 'My job', title: 'Directory', sub: 'Leadership, district leaders and every salon. For anyone on a salon team, call or email their salon.' }),
      h('div', { class: 'toolbar' }, searchBox('Search a salon, city, number or leader', (v) => { q = v; load(); }, q)),
      host);
  },
};

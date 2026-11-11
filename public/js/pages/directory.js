// Directory: find a person or a salon.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { roleLabel, whereLabel, pct } from '../core/format.js';
import { region, cover, searchBox } from './admin/kit.js';

const ROLES = [
  { value: '', label: 'Everyone' },
  { value: 'stylist', label: 'Stylists' },
  { value: 'salon_manager', label: 'Salon managers' },
  { value: 'district_leader', label: 'District leaders' },
  { value: 'hr', label: 'HR' },
  { value: 'executive', label: 'Leadership' },
  { value: 'admin', label: 'Home office' },
];
const PAGE = 48;

function personCard(p) {
  const contact = [
    p.phone ? h('a', { class: 'row gap-2 t-sm contact-link', href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, ui.icon('phone', 14), p.phone) : null,
    p.email ? h('a', { class: 'row gap-2 t-sm contact-link', href: `mailto:${p.email}` }, ui.icon('mail', 14), h('span', { class: 't-clip' }, p.email)) : null,
  ].filter(Boolean);
  return h('div', { class: 'card person-card' },
    h('a', { class: 'person-card-main', href: `#/people/${p.id}` },
      ui.avatar(p, 52),
      h('div', { class: 'grow' },
        h('div', { class: 't-strong t-clip' }, p.name),
        h('div', { class: 't-sm t-muted t-clip' }, p.title || roleLabel(p.role)),
        p.salon ? h('div', { class: 't-xs t-faint t-clip' }, whereLabel(p)) : null)),
    contact.length ? h('div', { class: 'person-card-contact' }, contact) : null);
}

function salonCard(s) {
  return h('a', { class: 'card card-link content-card', href: `#/salon/${s.id}` },
    cover(s.photo_url, { iconName: 'store' }),
    h('div', { class: 'card-pad col gap-2' },
      h('div', { class: 'row row-between gap-2' },
        h('h3', { class: 't-clip' }, s.name),
        h('span', { class: 't-xs t-faint t-num' }, `#${s.salon_number}`)),
      h('div', { class: 't-sm t-muted' }, [s.city, s.state].filter(Boolean).join(', '), s.market ? ` · ${s.market}` : ''),
      h('div', { class: 'row row-between gap-2 t-xs t-muted' },
        h('span', { class: 't-clip' }, s.manager ? `Manager: ${s.manager.name}` : 'Manager position open'),
        s.pace_pct !== null && s.pace_pct !== undefined ? ui.badge(`${pct(s.pace_pct, 0)} to goal`, s.pace_pct >= 100 ? 'good' : s.pace_pct >= 90 ? 'warn' : 'neutral') : null)));
}

export default {
  title: 'Directory',
  css: true,
  render(ctx) {
    const host = h('div');
    const f = { tab: ctx.query.tab === 'salons' ? 'salons' : 'people', q: ctx.query.q || '', role: '', market_id: '' };
    let shown = PAGE;
    let data = { people: [], salons: [], markets: [] };

    const marketSelect = h('select', { class: 'select', 'aria-label': 'Market', onChange: (e) => { f.market_id = e.target.value; load(); } }, h('option', { value: '' }, 'All markets'));
    const roleSelect = h('select', { class: 'select', 'aria-label': 'Role', onChange: (e) => { f.role = e.target.value; load(); } }, ROLES.map((r) => h('option', { value: r.value }, r.label)));
    const tabsHost = h('div');
    const paintTabs = () => mount(tabsHost, ui.tabs([
      { key: 'people', label: 'People', count: data.people.length },
      { key: 'salons', label: 'Salons', count: data.salons.length },
    ], f.tab, (k) => { f.tab = k; shown = PAGE; roleSelect.hidden = k !== 'people'; mount(host, view()); }));

    const view = () => {
      if (f.tab === 'people') {
        if (!data.people.length) return ui.empty({ icon: 'users', title: 'No one matches', body: 'Check the spelling, or clear the filters to see everyone.' });
        const rows = data.people.slice(0, shown);
        return h('div', null,
          h('div', { class: 'grid people-grid' }, rows.map(personCard)),
          data.people.length > shown ? h('div', { class: 't-center', style: { marginTop: 'var(--s-6)' } },
            ui.button(`Show more (${data.people.length - shown} left)`, { variant: 'secondary', onClick: () => { shown += PAGE; mount(host, view()); } })) : null);
      }
      if (!data.salons.length) {
        return ui.empty({ icon: 'store', title: 'No salons match', body: f.role ? 'Salons are hidden while a role filter is on. Switch back to People, or clear the filter.' : 'Try the city or the salon number.' });
      }
      return h('div', { class: 'grid content-grid' }, data.salons.map(salonCard));
    };

    const load = region(host, async () => {
      const res = await api.get('/directory', { q: f.q, role: f.role, market_id: f.market_id });
      data = { people: res.people || [], salons: res.salons || [], markets: res.markets || data.markets };
      if (marketSelect.options.length === 1 && data.markets.length) {
        for (const m of data.markets) marketSelect.appendChild(h('option', { value: m.id }, m.state ? `${m.name}, ${m.state}` : m.name));
      }
      shown = PAGE;
      paintTabs();
      return view();
    }, { skeleton: 'list', count: 8 });

    roleSelect.hidden = f.tab !== 'people';
    return h('div', null,
      ui.pageHeader({ eyebrow: 'My job', title: 'Directory', sub: 'Everyone on the team and every salon. Search by name, title, salon or city.' }),
      h('div', { class: 'toolbar' }, searchBox('Search by name, salon or city', (v) => { f.q = v; load(); }, f.q), roleSelect, marketSelect),
      tabsHost,
      host);
  },
};

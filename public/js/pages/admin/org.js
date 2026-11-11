// Admin: salons, districts and markets.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { crudSection } from './crud.js';

const ref = { markets: [], districts: [], entities: [], leaders: [] };
const byId = (list, id) => list.find((x) => x.id === id);
const withBlank = (label, list, text) => [{ value: '', label }, ...list.map((x) => ({ value: x.id, label: text(x) }))];

async function loadRefs() {
  const [m, d, u] = await Promise.all([
    api.get('/admin/markets').catch(() => ({ items: [] })),
    api.get('/admin/districts').catch(() => ({ items: [] })),
    api.get('/admin/users', { role: 'district_leader', status: 'active' }).catch(() => ({ items: [] })),
  ]);
  ref.markets = m.items || [];
  ref.districts = d.items || [];
  ref.leaders = u.items || [];
}

const SECTIONS = {
  salons: () => crudSection({
    path: 'salons', noun: 'salon', plural: 'Salons', before: loadRefs,
    intro: 'Every salon in the portal. Closing a salon hides it from scoreboards and the directory but keeps its history.',
    search: (r) => `${r.name} ${r.salon_number} ${r.city || ''}`,
    columns: [
      { key: 'name', label: 'Salon', render: (r) => h('div', null, h('div', { class: 't-strong' }, r.name), h('div', { class: 't-xs t-muted' }, [r.city, r.state].filter(Boolean).join(', '))) },
      { key: 'salon_number', label: 'Number', render: (r) => h('span', { class: 't-num' }, `#${r.salon_number}`) },
      { key: 'market_id', label: 'Market', render: (r) => (byId(ref.markets, r.market_id) || {}).name || h('span', { class: 't-faint' }, 'Not set') },
      { key: 'district_id', label: 'District', render: (r) => (byId(ref.districts, r.district_id) || {}).name || h('span', { class: 't-faint' }, 'Not set') },
      { key: 'status', label: 'Status', render: (r) => (r.status === 'active' ? ui.badge('Open', 'good') : ui.badge('Closed')) },
    ],
    fields: [
      [{ name: 'name', label: 'Name', required: true, maxLength: 80 }, { name: 'salon_number', label: 'Salon number', required: true, maxLength: 8, hint: '3 to 8 digits.' }],
      { name: 'address', label: 'Street address', maxLength: 160 },
      [{ name: 'city', label: 'City', maxLength: 80 }, { name: 'state', label: 'State', maxLength: 2, placeholder: 'CA', set: (v) => (v ? v.toUpperCase() : null) }],
      [{ name: 'zip', label: 'ZIP', maxLength: 10 }, { name: 'phone', label: 'Phone', type: 'tel', maxLength: 30 }],
      { name: 'shopping_center', label: 'Shopping center', maxLength: 120 },
      [{ name: 'market_id', label: 'Market', type: 'select', numeric: true, options: () => withBlank('Not set', ref.markets, (x) => x.name) },
        { name: 'district_id', label: 'District', type: 'select', numeric: true, options: () => withBlank('Not set', ref.districts, (x) => x.name) }],
      [{ name: 'concept', label: 'Concept', type: 'select', default: 'SUPERCUTS', options: [{ value: 'SUPERCUTS', label: 'Supercuts' }, { value: 'SMARTSTYLE', label: 'SmartStyle' }] },
        { name: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Open' }, { value: 'closed', label: 'Closed' }] }],
      { name: 'photo_url', label: 'Salon photo', type: 'image' },
    ],
    validate: (b) => { if (!/^\d{3,8}$/.test(b.salon_number || '')) throw new Error('The salon number is 3 to 8 digits.'); },
  }),
  districts: () => crudSection({
    path: 'districts', noun: 'district', plural: 'Districts', before: loadRefs,
    intro: 'A district is the group of salons one district leader looks after.',
    columns: [
      { key: 'name', label: 'District', render: (r) => h('div', { class: 't-strong' }, r.name) },
      { key: 'leader_user_id', label: 'Leader', render: (r) => (byId(ref.leaders, r.leader_user_id) || {}).name || h('span', { class: 't-faint' }, 'Open') },
    ],
    fields: [
      { name: 'name', label: 'Name', required: true, maxLength: 80 },
      { name: 'leader_user_id', label: 'District leader', type: 'select', numeric: true, options: () => withBlank('Open', ref.leaders, (x) => x.name), hint: 'People with the District Leader role.' },
    ],
  }),
  markets: () => crudSection({
    path: 'markets', noun: 'market', plural: 'Markets',
    intro: 'Markets are the areas shown next to a person\'s name on every post, such as Inland Empire or Las Vegas.',
    columns: [{ key: 'name', label: 'Market', render: (r) => h('div', { class: 't-strong' }, r.name) }, { key: 'state', label: 'State' }],
    fields: [[{ name: 'name', label: 'Name', required: true, maxLength: 80 }, { name: 'state', label: 'State', required: true, maxLength: 2, placeholder: 'CA', set: (v) => (v || '').toUpperCase() }]],
  }),
};

export default function org() {
  const body = h('div');
  let tab = 'salons';
  const paint = () => mount(body, SECTIONS[tab]());
  paint();
  return h('div', null,
    h('h2', { style: { marginBottom: 'var(--s-4)' } }, 'Salons and districts'),
    ui.tabs([{ key: 'salons', label: 'Salons' }, { key: 'districts', label: 'Districts' }, { key: 'markets', label: 'Markets' }], tab, (k) => { tab = k; paint(); }),
    body);
}

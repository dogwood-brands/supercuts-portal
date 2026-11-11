// Brand standards, operations guides, policies and HR documents. Some need a sign-off ("acknowledge").

import { h, mount, markdown } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { dateLong, dateShort } from '../core/format.js';
import { region, backLink, cover, searchBox } from './admin/kit.js';

const SECTIONS = [
  { key: 'brand', label: 'Brand standards', icon: 'star', blurb: 'How every guest should be greeted, consulted, cut and finished, in every salon.' },
  { key: 'ops', label: 'Operations guides', icon: 'checklist', blurb: 'Opening, closing, cash, safety and state board readiness.' },
  { key: 'policies', label: 'Policies', icon: 'shield', blurb: 'The rules we all work by. Some need your sign-off.' },
  { key: 'hr', label: 'HR and handbook', icon: 'briefcase', blurb: 'The handbook, benefits and getting started.' },
];
const SECTION_LABEL = { ...Object.fromEntries(SECTIONS.map((s) => [s.key, s.label])), products: 'Products' };
const SECTION_ICON = { ...Object.fromEntries(SECTIONS.map((s) => [s.key, s.icon])), products: 'bottle' };

function ackFlag(r) {
  if (!r.requires_ack) return null;
  return r.acknowledged_at ? ui.badge('Acknowledged', 'good') : ui.badge('Needs your sign-off', 'brand');
}

function resourceCard(r, i) {
  const flag = ackFlag(r);
  return ui.reveal(h('a', { class: 'card card-link content-card', href: `#/standards/${r.id}` },
    h('div', { class: 'content-card-media' },
      cover(r.image_url, { ratio: '4x3', iconName: SECTION_ICON[r.section] || 'book' }),
      flag ? h('span', { class: 'content-card-flag' }, flag) : null),
    h('div', { class: 'card-pad col gap-2' },
      h('h3', null, r.title),
      r.summary ? h('p', { class: 't-sm t-muted t-clamp-2' }, r.summary) : null)), Math.min(i, 6) * 40);
}

function listView(ctx) {
  let section = SECTIONS.some((s) => s.key === ctx.query.section) ? ctx.query.section : 'brand';
  let q = '';
  let items = [];
  const blurb = h('p', { class: 't-muted', style: { marginBottom: 'var(--s-5)' } });
  const body = h('div');
  const view = () => {
    const needle = q.toLowerCase();
    const shown = needle ? items.filter((r) => `${r.title} ${r.summary || ''} ${r.category || ''}`.toLowerCase().includes(needle)) : items;
    if (!items.length) return ui.empty({ icon: 'book', title: 'Nothing has been added here yet', body: 'Guides for this section will appear once the home office publishes them.' });
    if (!shown.length) return ui.empty({ icon: 'search', title: `Nothing matches "${q}"`, body: 'Try a shorter word, or look in another section.' });
    const groups = new Map();
    for (const r of shown) {
      const key = r.category || 'General';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const pending = items.filter((r) => r.requires_ack && !r.acknowledged_at);
    return h('div', null,
      pending.length && !needle ? h('div', { class: 'card card-pad notice row gap-3' },
        h('span', { class: 'notice-icon' }, ui.icon('edit', 18)),
        h('div', { class: 'grow' },
          h('div', { class: 't-strong' }, `${pending.length} ${pending.length === 1 ? 'document needs' : 'documents need'} your sign-off`),
          h('div', { class: 't-sm t-muted' }, pending.map((r) => r.title).join(', '))),
        ui.button('Start', { variant: 'brand', size: 'sm', onClick: () => ctx.navigate(`/standards/${pending[0].id}`) })) : null,
      [...groups.entries()].map(([name, rows]) => [
        h('div', { class: 'group-title' }, h('h2', null, name), h('span', null, `${rows.length} ${rows.length === 1 ? 'guide' : 'guides'}`)),
        h('div', { class: 'grid content-grid' }, rows.map(resourceCard)),
      ]));
  };
  const load = region(body, async () => {
    blurb.textContent = SECTIONS.find((s) => s.key === section).blurb;
    const res = await api.get('/resources', { section });
    items = res.items || [];
    return view();
  });
  const search = searchBox('Search these guides', (v) => { q = v; mount(body, view()); });
  return h('div', null,
    ui.pageHeader({ eyebrow: 'Standards and training', title: 'Brand standards', sub: 'One way of doing things, written down. If a guide and what you were told disagree, the guide wins. Tell your manager so it can be fixed.' }),
    ui.tabs(SECTIONS.map((s) => ({ key: s.key, label: s.label })), section, (k) => { section = k; q = ''; search.value = ''; load(); }),
    h('div', { class: 'toolbar' }, search),
    blurb,
    body);
}

function detailView(ctx) {
  const host = h('div');
  region(host, async () => {
    const { resource: r } = await api.get(`/resources/${encodeURIComponent(ctx.params.id)}`);
    const isProduct = r.section === 'products';
    const ackHost = h('div');
    const paintAck = () => {
      if (!r.requires_ack) return;
      if (r.acknowledged_at) {
        mount(ackHost, ui.card({ class: 'ack-card is-done' },
          h('div', { class: 'row gap-3' },
            h('span', { class: 'ack-tick' }, ui.icon('check', 20)),
            h('div', null,
              h('div', { class: 't-strong' }, 'You acknowledged this'),
              h('div', { class: 't-sm t-muted' }, dateLong(r.acknowledged_at))))));
        return;
      }
      const check = h('input', { type: 'checkbox' });
      const btn = ui.button('Acknowledge', { variant: 'brand', block: true, disabled: true, onClick: async () => {
        try {
          const res = await api.post(`/resources/${r.id}/ack`);
          r.acknowledged_at = res.acknowledged_at || new Date().toISOString();
          paintAck();
          ui.toast('Thank you. Your sign-off is recorded.', 'good');
        } catch (err) {
          ui.toast(err.message, 'bad');
        }
      } });
      check.addEventListener('change', () => { btn.disabled = !check.checked; });
      mount(ackHost, ui.card({ title: 'Your sign-off', class: 'ack-card' },
        h('p', { class: 't-sm t-muted' }, 'Read the whole document first. Your sign-off is recorded with today\'s date.'),
        h('label', { class: 'checkbox ack-check' }, check, h('span', null, 'I have read this and I understand it.')),
        btn));
    };
    paintAck();
    return h('article', { class: 'stack-lg' },
      backLink(isProduct ? '#/products' : `#/standards?section=${r.section}`, isProduct ? 'All products' : SECTION_LABEL[r.section] || 'All guides'),
      h('div', { class: 'layout-rail' },
        h('div', { class: 'stack' },
          h('header', null,
            h('div', { class: 't-eyebrow', style: { marginBottom: 'var(--s-2)' } }, [SECTION_LABEL[r.section], r.category].filter(Boolean).join(' · ')),
            h('h1', null, r.title),
            r.summary ? h('p', { class: 'page-header-sub t-lg' }, r.summary) : null),
          r.image_url ? cover(r.image_url, { ratio: '16x9' }) : null,
          ui.card({}, r.body_md ? markdown(r.body_md) : h('p', { class: 't-muted' }, 'The full text has not been added yet.')),
          r.file_url ? h('div', null, h('a', { class: 'btn btn-secondary', href: r.file_url, target: '_blank', rel: 'noopener' }, ui.icon('download', 18), 'Open the attached file')) : null),
        h('aside', { class: 'rail stack' },
          ackHost,
          ui.card({ title: 'About this guide' },
            h('dl', { class: 'detail-meta' },
              h('dt', null, 'Section'), h('dd', null, SECTION_LABEL[r.section] || r.section),
              r.category ? [h('dt', null, 'Topic'), h('dd', null, r.category)] : null,
              r.updated_at ? [h('dt', null, 'Updated'), h('dd', null, dateShort(r.updated_at))] : null),
            h('p', { class: 't-sm t-muted', style: { marginTop: 'var(--s-4)' } }, 'Spot something out of date? Tell your district leader so it gets fixed for everyone.')))));
  }, { count: 2 });
  return host;
}

export default {
  title: (ctx) => (ctx.params.id ? 'Guide' : 'Brand standards'),
  css: true,
  render(ctx) {
    return ctx.params.id ? detailView(ctx) : listView(ctx);
  },
};

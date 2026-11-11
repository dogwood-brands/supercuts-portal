// Products: what we sell at the desk, who each one is for and how to recommend it.

import { h, mount, markdown } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { region, cover, searchBox } from './admin/kit.js';

function openProduct(r) {
  const body = h('div', { class: 'stack' }, ui.skeleton('list', 5));
  ui.drawer({ title: r.title, body });
  api.get(`/resources/${r.id}`).then(({ resource }) => {
    mount(body, [
      resource.image_url ? cover(resource.image_url, { ratio: '4x3', iconName: 'bottle' }) : null,
      resource.category ? h('div', { class: 't-eyebrow' }, resource.category) : null,
      resource.summary ? h('p', { class: 't-lg' }, resource.summary) : null,
      resource.body_md ? markdown(resource.body_md) : h('p', { class: 't-muted' }, 'A full product sheet has not been added yet.'),
      h('div', { class: 'card card-pad tip' },
        h('div', { class: 't-eyebrow' }, 'At the chair'),
        h('p', { class: 't-sm' }, 'Recommend what you used on the guest today and say why it suits their hair. One product, one reason, no pressure.')),
    ]);
  }).catch((err) => mount(body, ui.errorState(err)));
}

export default {
  title: 'Products',
  css: true,
  render() {
    const host = h('div');
    const filters = h('div', { class: 'toolbar' });
    let items = [];
    let category = 'all';
    let q = '';
    const view = () => {
      const needle = q.toLowerCase();
      const shown = items.filter((r) => (category === 'all' || (r.category || 'General') === category)
        && (!needle || `${r.title} ${r.summary || ''}`.toLowerCase().includes(needle)));
      if (!items.length) return ui.empty({ icon: 'bottle', title: 'No products have been added yet', body: 'Product sheets will appear here once the home office publishes them.' });
      if (!shown.length) return ui.empty({ icon: 'search', title: 'No products match', body: 'Try another category or a shorter search.' });
      return h('div', { class: 'grid content-grid' }, shown.map((r, i) => {
        const card = h('button', { class: 'card card-link content-card product-card', type: 'button', onClick: () => openProduct(r) },
          cover(r.image_url, { ratio: '4x3', iconName: 'bottle' }),
          h('div', { class: 'card-pad col gap-2' },
            h('div', { class: 't-eyebrow' }, r.category || 'General'),
            h('h3', null, r.title),
            r.summary ? h('p', { class: 't-sm t-muted t-clamp-3' }, r.summary) : null,
            h('span', { class: 't-link t-sm row gap-1 product-card-more' }, 'How to recommend it', ui.icon('arrowRight', 14))));
        return ui.reveal(card, Math.min(i, 6) * 40);
      }));
    };
    region(host, async () => {
      const res = await api.get('/resources', { section: 'products' });
      items = res.items || [];
      const cats = [...new Set(items.map((r) => r.category || 'General'))];
      mount(filters, [
        searchBox('Search products', (v) => { q = v; mount(host, view()); }),
        cats.length > 1 ? ui.segmented([{ key: 'all', label: 'All' }, ...cats.map((c) => ({ key: c, label: c }))], category, (k) => { category = k; mount(host, view()); }) : null,
      ]);
      return view();
    });
    return h('div', null,
      ui.pageHeader({ eyebrow: 'Sell', title: 'Products', sub: 'Know what is on the shelf. Guests buy what their stylist used and can explain in one sentence.' }),
      filters,
      host);
  },
};

// Admin console shell. Each section is its own module in ./admin/, loaded when first opened.
// Sections are shown only when the signed-in person's permissions allow them; the server enforces the same rules.

import { h, mount } from '../core/dom.js';
import { ui } from '../core/ui.js';

const SECTIONS = [
  { key: 'overview', label: 'Overview', icon: 'chart', any: ['admin.users', 'admin.content', 'admin.settings'] },
  { key: 'people', label: 'People', icon: 'users', any: ['admin.users'] },
  { key: 'org', label: 'Salons and districts', icon: 'store', any: ['admin.settings'] },
  { key: 'content', label: 'Content', icon: 'book', any: ['admin.content'] },
  { key: 'goals', label: 'Goals', icon: 'target', any: ['admin.settings'] },
  { key: 'import', label: 'Data import', icon: 'upload', any: ['admin.settings'] },
  { key: 'moderation', label: 'Moderation', icon: 'flag', any: ['moderate'] },
  { key: 'audit', label: 'Audit log', icon: 'shield', any: ['admin.settings'] },
  { key: 'settings', label: 'Settings', icon: 'settings', any: ['admin.settings'] },
];

let active = null;

export default {
  title: 'Admin console',
  css: true,
  async render(ctx) {
    const allowed = SECTIONS.filter((s) => s.any.some((p) => ctx.can(p)));
    if (!allowed.length) {
      return ui.empty({ icon: 'lock', title: 'The admin console is for the home office', body: 'If you need something changed, ask your district leader or open a support ticket.', action: ui.button('Go home', { onClick: () => ctx.navigate('/') }) });
    }
    const key = ctx.params.section || allowed[0].key;
    const section = allowed.find((s) => s.key === key);
    const body = h('div', { class: 'admin-body' });
    const nav = h('nav', { class: 'admin-nav', 'aria-label': 'Admin sections' }, allowed.map((s) => h('a', {
      class: 'admin-nav-link', href: `#/admin/${s.key}`, 'aria-current': s.key === key ? 'page' : null,
    }, ui.icon(s.icon, 18), h('span', null, s.label))));

    if (!section) {
      mount(body, ui.empty({ icon: 'lock', title: 'You do not have access to this section', body: 'Pick another section from the list.' }));
    } else {
      mount(body, ui.skeleton('card', 3));
      import(`./admin/${section.key}.js`).then(async (mod) => {
        active = mod;
        mount(body, await mod.default(ctx));
      }).catch((err) => {
        console.error(err);
        mount(body, ui.errorState(err, () => ctx.navigate(`/admin/${section.key}`)));
      });
    }
    requestAnimationFrame(() => {
      const cur = nav.querySelector('[aria-current="page"]');
      if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - 16;
    });
    return h('div', null,
      ui.pageHeader({ eyebrow: 'Home office', title: 'Admin console', sub: 'People, content, goals and settings for the whole portal. Every change here is recorded in the audit log.' }),
      h('div', { class: 'admin' }, nav, body));
  },
  teardown() {
    if (active && typeof active.teardown === 'function') active.teardown();
    active = null;
  },
};

// SC Portal: boot, session, login, app shell and router.

import { h, clear, mount, debounce } from './core/dom.js';
import { api, setUnauthorizedHandler } from './core/api.js';
import { ui } from './core/ui.js';
import { icon } from './core/icons.js';
import { roleLabel, whereLabel } from './core/format.js';
import { pwa } from './core/pwa.js';

const root = document.getElementById('app');
const state = { user: null, settings: null, unread: 0 };
const can = (perm) => !!(state.user && state.user.permissions && state.user.permissions.includes(perm));

/* ---------- routes ---------- */

const ROUTES = [
  ['/', 'home'],
  ['/salon', 'salon'],
  ['/salon/:id', 'salon'],
  ['/scoreboard', 'scoreboard'],
  ['/company', 'company'],
  ['/promos', 'promos'],
  ['/promos/:id', 'promos'],
  ['/standards', 'standards'],
  ['/standards/:id', 'standards'],
  ['/products', 'products'],
  ['/operations', 'operations'],
  ['/tickets', 'tickets'],
  ['/tickets/:id', 'tickets'],
  ['/my-job', 'my-job'],
  ['/hr', 'hr'],
  ['/hr/:id', 'hr'],
  ['/tube', 'tube'],
  ['/directory', 'directory'],
  ['/people/:id', 'people'],
  ['/notifications', 'notifications'],
  ['/account', 'account'],
  ['/admin', 'admin'],
  ['/admin/:section', 'admin'],
].map(([pattern, page]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { pattern, page, keys, re };
});

function navModel() {
  const u = state.user;
  const hasSalon = !!(u && u.salon);
  const groups = [
    {
      label: null,
      items: [
        { path: '/', label: 'Home', icon: 'home' },
        hasSalon ? { path: '/salon', label: 'My salon', icon: 'store' } : { path: '/salon', label: 'Salons', icon: 'store' },
        { path: '/scoreboard', label: 'Scoreboard', icon: 'trophy' },
        can('kpi.company') || u.role === 'district_leader' ? { path: '/company', label: u.role === 'district_leader' ? 'My district' : 'Company', icon: 'chart' } : null,
      ],
    },
    {
      label: 'Sell',
      items: [
        { path: '/promos', label: 'Promos', icon: 'tag' },
        { path: '/products', label: 'Products', icon: 'bottle' },
      ],
    },
    {
      label: 'Standards and training',
      items: [
        { path: '/standards', label: 'Brand standards', icon: 'book' },
        { path: '/tube', label: 'SC Tube', icon: 'play' },
      ],
    },
    {
      label: 'Run the salon',
      items: [
        { path: '/operations', label: 'Operations', icon: 'checklist' },
        { path: '/tickets', label: 'Support tickets', icon: 'ticket' },
      ],
    },
    {
      label: 'My job',
      items: [
        { path: '/my-job', label: 'My job', icon: 'briefcase' },
        { path: '/hr', label: can('hr.inbox') ? 'HR inbox' : 'Ask HR', icon: 'lifebuoy' },
        { path: '/directory', label: 'Directory', icon: 'users' },
      ],
    },
  ];
  if (can('admin.users') || can('admin.content') || can('admin.settings') || can('moderate')) {
    groups.push({ label: 'Home office', items: [{ path: '/admin', label: 'Admin console', icon: 'settings' }] });
  }
  return groups.map((g) => ({ ...g, items: g.items.filter(Boolean) }));
}

/* ---------- login ---------- */

function renderLogin(message) {
  document.title = 'Sign in · SC Portal';
  const error = h('div', { class: 'login-error', role: 'alert', hidden: !message }, message || '');
  const username = ui.field({ label: 'Username', name: 'username', autocomplete: 'username', required: true, placeholder: 'first.last' });
  const password = ui.field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  username.input.autocapitalize = 'none';
  username.input.spellcheck = false;
  const submit = ui.button('Sign in', { type: 'submit', block: true });
  const form = h('form', { class: 'form' }, error, username, password, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.classList.add('is-busy');
    try {
      await api.post('/auth/login', { username: username.input.value.trim(), password: password.input.value });
      await boot();
    } catch (err) {
      error.textContent = err.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : err.status === 401 || err.status === 400 ? 'That username and password do not match. Please try again.' : err.message;
      error.hidden = false;
      password.input.value = '';
      password.input.focus();
    } finally {
      submit.classList.remove('is-busy');
    }
  });

  const heroImg = h('img', { src: '/media/login-hero.webp', alt: '' });
  heroImg.addEventListener('load', () => heroImg.classList.add('is-in'));
  heroImg.addEventListener('error', () => heroImg.remove());

  mount(root, h('div', { class: 'login' },
    h('div', { class: 'login-panel' },
      brand(),
      h('div', { class: 'login-form' },
        h('h1', null, 'Welcome back.'),
        h('p', null, 'Sign in to see your salon, your numbers and what the team is celebrating today.'),
        form,
        h('p', { class: 't-sm t-muted', style: { marginTop: 'var(--s-5)' } }, 'First time here, or locked out? Ask your salon manager or district leader for a sign-in.')),
      h('div', { class: 'login-foot' }, `SC Entities team portal · ${new Date().getFullYear()}`)),
    h('div', { class: 'login-hero' },
      heroImg,
      h('div', { class: 'login-hero-copy' },
        h('h2', null, 'Every salon. One team. One front door.'),
        h('p', null, 'Daily numbers, promos, standards, training and shout-outs for everyone behind the chair and everyone who supports them.'),
        h('div', { class: 'login-hero-stats' },
          h('div', null, h('b', null, '51'), h('span', null, 'salons')),
          h('div', null, h('b', null, '3'), h('span', null, 'states')),
          h('div', null, h('b', null, '8'), h('span', null, 'markets')))))));
  username.input.focus();
}

function brand() {
  return h('a', { class: 'brand', href: '#/' },
    h('span', { class: 'brand-mark' }, 'SC'),
    h('span', { class: 'brand-name' }, 'SC Portal', h('small', null, 'Supercuts · SC Entities')));
}

/* ---------- shell ---------- */

let shell = null;

function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  const paintNav = () => {
    clear(nav);
    for (const group of navModel()) {
      nav.appendChild(h('div', { class: group.label ? 'nav-group' : null },
        group.label ? h('div', { class: 'nav-group-label' }, group.label) : null,
        group.items.map((item) => h('a', { class: 'nav-link', href: `#${item.path}`, dataset: { path: item.path } }, icon(item.icon, 18), h('span', null, item.label)))));
    }
  };
  paintNav();

  const userBtn = h('button', { class: 'sidebar-user', type: 'button', 'aria-haspopup': 'menu' },
    ui.avatar(state.user, 36),
    h('span', { class: 'user-chip-text' },
      h('span', { class: 'user-chip-name' }, state.user.name),
      h('span', { class: 'user-chip-sub' }, whereLabel(state.user) || roleLabel(state.user.role))));
  const openUserMenu = (anchor) => ui.menu(anchor, [
    { label: 'My profile', icon: 'user', href: `#/people/${state.user.id}` },
    { label: 'Account and password', icon: 'lock', href: '#/account' },
    pwa.isStandalone() ? null : { label: 'Install the app', icon: 'phoneDevice', onClick: installFlow },
    'divider',
    { label: 'Sign out', icon: 'logout', onClick: signOut },
  ], { align: 'left' });
  userBtn.addEventListener('click', () => openUserMenu(userBtn));

  const sidebar = h('aside', { class: 'sidebar' }, brand(), nav, h('div', { class: 'sidebar-foot' }, userBtn));

  // top bar
  const title = h('div', { class: 'topbar-title' });
  const menuBtn = h('button', { class: 'icon-btn only-compact', type: 'button', 'aria-label': 'Open menu', onClick: () => app.classList.add('nav-open') }, icon('menu', 22));
  const bellPip = h('span', { class: 'pip', hidden: !state.unread });
  const bell = h('a', { class: 'icon-btn', href: '#/notifications', 'aria-label': 'Notifications' }, icon('bell', 20), bellPip);
  const avatarBtn = h('button', { class: 'icon-btn only-compact', type: 'button', 'aria-label': 'Account menu' }, ui.avatar(state.user, 30));
  avatarBtn.addEventListener('click', () => openUserMenu(avatarBtn));

  const topbar = h('header', { class: 'topbar' },
    menuBtn, title, buildSearch(), h('div', { class: 'topbar-spacer' }),
    state.settings && state.settings.sample_data ? h('span', { class: 'sample-pill', title: 'Sales come from the daily DSR and DHR reports. Team names, posts and per-stylist splits are sample data while the portal is in preview.' }, h('span', { class: 'dot dot-warn' }), 'Preview', h('span', null, '· live sales, sample team')) : null,
    bell, avatarBtn);

  const content = h('main', { class: 'content', id: 'content', tabIndex: -1 });
  const scrim = h('div', { class: 'scrim', onClick: () => app.classList.remove('nav-open') });

  const moreBtn = h('button', { type: 'button', onClick: () => app.classList.add('nav-open') }, icon('menu', 22), 'More');
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Quick' },
    h('a', { href: '#/', dataset: { path: '/' } }, icon('home', 22), 'Home'),
    h('a', { href: '#/salon', dataset: { path: '/salon' } }, icon('store', 22), state.user.salon ? 'My salon' : 'Salons'),
    h('a', { href: '#/scoreboard', dataset: { path: '/scoreboard' } }, icon('trophy', 22), 'Scores'),
    h('a', { href: '#/promos', dataset: { path: '/promos' } }, icon('tag', 22), 'Promos'),
    moreBtn);

  const routeBar = h('div', { class: 'route-bar' });
  const app = h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, topbar, content), scrim, tabbar, routeBar);

  nav.addEventListener('click', (e) => { if (e.target.closest('a')) app.classList.remove('nav-open'); });
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  mount(root, app);
  return {
    app, content, title, routeBar,
    setActive(path) {
      const top = `/${path.split('/')[1] || ''}`;
      for (const a of app.querySelectorAll('[data-path]')) {
        if (a.dataset.path === top) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
    setUnread(n) {
      bellPip.hidden = !n;
    },
  };
}

function buildSearch() {
  const input = h('input', { type: 'search', placeholder: 'Search people, salons, standards', 'aria-label': 'Search', autocomplete: 'off' });
  const results = h('div', { class: 'search-results card', hidden: true });
  const wrap = h('div', { class: 'search' }, icon('search', 16), input, results);
  const close = () => { results.hidden = true; };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return close();
    try {
      const r = await api.get('/search', { q });
      const rows = [
        ...(r.people || []).map((p) => ({ href: `#/people/${p.id}`, node: ui.userChip(p, { size: 32, link: false }) })),
        ...(r.salons || []).map((s) => ({ href: `#/salon/${s.id}`, node: h('span', { class: 'row' }, icon('store', 18), h('span', null, s.name, h('span', { class: 't-muted t-sm' }, `  #${s.salon_number}${s.city ? ` · ${s.city}` : ''}`))) })),
        ...(r.resources || []).map((x) => ({ href: `#/standards/${x.id}`, node: h('span', { class: 'row' }, icon('book', 18), x.title) })),
        ...(r.promos || []).map((x) => ({ href: `#/promos/${x.id}`, node: h('span', { class: 'row' }, icon('tag', 18), x.title) })),
      ];
      mount(results, rows.length
        ? h('div', { class: 'list' }, rows.map((row) => h('a', { href: row.href, onClick: () => { close(); input.value = ''; } }, row.node)))
        : h('div', { class: 'card-pad t-muted t-sm' }, `Nothing found for "${q}".`));
      results.hidden = false;
    } catch {
      close();
    }
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); input.blur(); } });
  document.addEventListener('mousedown', (e) => { if (!wrap.contains(e.target)) close(); });
  return wrap;
}

/* ---------- router ---------- */

const cssLoaded = new Set();
function ensureCss(name) {
  if (cssLoaded.has(name)) return Promise.resolve();
  cssLoaded.add(name);
  return new Promise((resolve) => {
    const link = h('link', { rel: 'stylesheet', href: `/css/pages/${name}.css` });
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    document.head.appendChild(link);
    setTimeout(resolve, 1500);
  });
}

function parseHash() {
  const raw = (location.hash || '#/').slice(1) || '/';
  const [path, queryString] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  for (const route of ROUTES) {
    const m = path.match(route.re);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { path, page: route.page, params, query };
    }
  }
  return { path, page: null, params: {}, query };
}

function navigate(path) {
  if (`#${path}` === location.hash) route();
  else location.hash = path;
}

let current = null;
let routeSeq = 0;

async function route() {
  if (!state.user) return;
  const seq = ++routeSeq;
  const match = parseHash();
  const bar = shell.routeBar;
  bar.className = 'route-bar is-on';
  shell.app.classList.remove('nav-open');
  shell.setActive(match.path);

  if (current && current.teardown) {
    try { current.teardown(); } catch { /* a page's cleanup must never block navigation */ }
  }
  current = null;

  const ctx = { user: state.user, settings: state.settings, params: match.params, query: match.query, navigate, can, refreshUnread };
  let node;
  let title = 'SC Portal';
  try {
    if (!match.page) throw Object.assign(new Error('That page does not exist.'), { notFound: true });
    const mod = (await import(`./pages/${match.page}.js`)).default;
    if (mod.css) await ensureCss(match.page);
    if (seq !== routeSeq) return;
    title = typeof mod.title === 'function' ? mod.title(ctx) : mod.title;
    mount(shell.content, h('div', { class: 'page' }, ui.skeleton('card', 3)));
    node = await mod.render(ctx);
    current = mod;
  } catch (err) {
    console.error(err);
    node = err.notFound
      ? ui.empty({ icon: 'search', title: 'Page not found', body: 'That link does not go anywhere. Head back to the home feed.', action: ui.button('Go home', { onClick: () => navigate('/') }) })
      : ui.errorState(err, () => route());
  }
  if (seq !== routeSeq) return;
  mount(shell.content, h('div', { class: 'page' }, node));
  document.title = `${title} · SC Portal`;
  shell.title.textContent = title;
  window.scrollTo(0, 0);
  bar.className = 'route-bar is-done';
  setTimeout(() => { if (seq === routeSeq) bar.className = 'route-bar'; }, 320);
}

/* ---------- session ---------- */

async function refreshUnread() {
  try {
    const me = await api.get('/auth/me');
    state.unread = me.unread || 0;
    if (shell) shell.setUnread(state.unread);
  } catch { /* handled by the 401 handler */ }
}

async function signOut() {
  try { await api.post('/auth/logout'); } catch { /* signing out locally either way */ }
  state.user = null;
  shell = null;
  renderLogin();
}

function installFlow() {
  if (pwa.canPrompt()) {
    pwa.install().then((ok) => { if (ok) ui.toast('Installed. Look for SC Portal on your home screen.', 'good'); });
    return;
  }
  const steps = pwa.isIos()
    ? ['Open this page in Safari.', 'Tap the Share button at the bottom of the screen.', 'Scroll down and tap "Add to Home Screen".', 'Tap Add. SC Portal now opens like any other app.']
    : ['Open the browser menu (the three dots, top right).', 'Choose "Install app" or "Add to Home screen".', 'Confirm. SC Portal now opens like any other app.'];
  ui.modal({
    title: 'Install SC Portal on your phone',
    size: 'sm',
    body: h('ol', { class: 'prose' }, steps.map((s) => h('li', null, s))),
  });
}

function forcePasswordChange() {
  const m = ui.modal({
    title: 'Choose your own password',
    size: 'sm',
    dismissable: false,
    body: h('div', { class: 'stack' },
      h('p', { class: 't-muted t-sm' }, 'You signed in with a temporary password. Pick one only you know. At least 10 characters.'),
      ui.form({
        fields: [
          { label: 'Temporary password', name: 'current', type: 'password', required: true, autocomplete: 'current-password' },
          { label: 'New password', name: 'next', type: 'password', required: true, autocomplete: 'new-password' },
          { label: 'New password again', name: 'again', type: 'password', required: true, autocomplete: 'new-password' },
        ],
        submitLabel: 'Save password',
        onSubmit: async (v) => {
          if (v.next.length < 10) throw new Error('Use at least 10 characters.');
          if (v.next !== v.again) throw new Error('The two new passwords do not match.');
          await api.post('/auth/password', { current: v.current, next: v.next });
          state.user.must_change_password = false;
          m.close();
          ui.toast('Password saved.', 'good');
        },
      })),
  });
}

async function boot() {
  let me;
  try {
    me = await api.get('/auth/me');
  } catch (err) {
    if (err.status === 401) return renderLogin();
    mount(root, h('div', { class: 'boot' }, ui.errorState(err, () => boot())));
    return;
  }
  state.user = me.user;
  state.settings = me.settings || {};
  state.unread = me.unread || 0;
  shell = buildShell();
  await route();
  if (state.user.must_change_password) forcePasswordChange();
}

setUnauthorizedHandler(() => {
  if (state.user) {
    state.user = null;
    shell = null;
    renderLogin('Your session ended. Please sign in again.');
  }
});
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refreshUnread(); });
pwa.register();
boot();

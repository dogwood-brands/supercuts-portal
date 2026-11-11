// Salon page: the store landing page (numbers, check-the-boxes, alerts, rankings, DSR, team) and the salon finder.

import { h, clear, mount, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, dateShort, signed, roleLabel, refreshNote, loadedNote } from '../core/format.js';

const paceTone = (p) => (p === null || p === undefined ? '' : p >= 100 ? 'good' : p >= 92 ? 'warn' : 'brand');
const ordinal = (n) => (n ? `#${n}` : '–');

/* ---------- salon finder ---------- */

async function finder(ctx) {
  const { user } = ctx;
  const { items = [] } = await api.get('/salons');
  const markets = [...new Set(items.map((s) => s.market).filter(Boolean))].sort();
  const districts = [...new Set(items.map((s) => s.district).filter(Boolean))].sort();
  const st = { q: '', market: '', district: '', mine: user.scope === 'district' };

  const grid = h('div', { class: 'grid grid-auto salon-grid' });
  const count = h('span', { class: 't-sm t-muted' });
  const paint = () => {
    const q = st.q.toLowerCase();
    const rows = items.filter((s) =>
      (!q || `${s.name} ${s.city} ${s.salon_number} ${s.manager?.name || ''}`.toLowerCase().includes(q))
      && (!st.market || s.market === st.market)
      && (!st.district || s.district === st.district)
      && (!st.mine || s.in_scope));
    count.textContent = `${rows.length} of ${items.length} salons`;
    if (!rows.length) {
      mount(grid, h('div', { class: 'card salon-grid-empty' }, ui.empty({ icon: 'search', title: 'No salons match', body: 'Try a different name, city or filter.' })));
      return;
    }
    mount(grid, rows.map((s, i) => {
      const card = h('a', { class: 'card card-link salon-card', href: `#/salon/${s.id}` },
        h('div', { class: 'media salon-card-photo' },
          s.photo_url ? h('img', { src: s.photo_url, alt: '', loading: 'lazy' }) : null,
          s.rank_company ? h('span', { class: 'salon-card-rank t-num' }, `#${s.rank_company}`) : null),
        h('div', { class: 'salon-card-body' },
          h('div', { class: 'grow' },
            h('h3', { class: 't-clip' }, s.name),
            h('div', { class: 't-xs t-muted t-clip' }, `#${s.salon_number} · ${[s.city, s.state].filter(Boolean).join(', ')}`),
            h('div', { class: 't-xs t-muted t-clip salon-card-mgr' }, s.manager?.name ? `Manager: ${s.manager.name}` : 'Manager: open'),
            s.concept && s.concept !== 'SUPERCUTS' ? ui.badge(s.concept === 'SMARTSTYLE' ? 'SmartStyle' : s.concept, 'info') : null),
          s.pace_pct !== null && s.pace_pct !== undefined
            ? ui.ring(s.pace_pct, { size: 64, stroke: 6, tone: paceTone(s.pace_pct), label: 'pace' })
            : null));
      return i < 12 ? ui.reveal(card, i * 30) : card;
    }));
  };

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by salon, city, number or manager', 'aria-label': 'Search salons' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); paint(); }, 120));
  const sel = (label, options, key) => {
    const el = h('select', { class: 'select', 'aria-label': label },
      h('option', { value: '' }, label), options.map((o) => h('option', { value: o }, o)));
    el.addEventListener('change', () => { st[key] = el.value; paint(); });
    return el;
  };
  const filters = h('div', { class: 'salon-filters' }, search, sel('All markets', markets, 'market'), sel('All districts', districts, 'district'));
  paint();
  return h('div', null,
    ui.pageHeader({
      eyebrow: 'Salons',
      title: user.scope === 'district' ? 'My district and beyond' : 'All salons',
      sub: 'Pace to goal for every salon. Open one to see its page.',
      actions: user.salon ? ui.button('Back to my salon', { variant: 'secondary', icon: 'chevronLeft', onClick: () => ctx.navigate('/salon') }) : null,
    }),
    filters,
    h('div', { class: 'row row-between salon-grid-meta' }, count,
      user.scope === 'district' ? ui.segmented([{ key: 'mine', label: 'My district' }, { key: 'all', label: 'All salons' }], 'mine', (k) => { st.mine = k === 'mine'; paint(); }) : null),
    grid);
}

/* ---------- salon detail blocks ---------- */

function hoursBlock(hours) {
  if (!hours) return null;
  if (typeof hours === 'string') return h('div', { class: 't-sm' }, hours);
  const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const fmt = (v) => {
    if (!v) return 'Closed';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(' to ');
    if (v.closed) return 'Closed';
    return [v.open, v.close].filter(Boolean).join(' to ') || 'Closed';
  };
  let rows = [];
  if (Array.isArray(hours)) rows = hours.map((d) => [d.label || d.day || d.days || '', fmt(d.hours ?? d)]);
  else rows = ORDER.filter((k) => k in hours).map((k) => [NAMES[k], fmt(hours[k])]);
  if (!rows.length) rows = Object.entries(hours).map(([k, v]) => [k, fmt(v)]);
  // collapse runs of identical hours: "Mon to Fri  9:00 AM to 8:00 PM"
  const groups = [];
  for (const [day, val] of rows) {
    const last = groups[groups.length - 1];
    if (last && last.val === val) last.to = day;
    else groups.push({ from: day, to: day, val });
  }
  const todayKey = NAMES[ORDER[(new Date().getDay() + 6) % 7]];
  return h('dl', { class: 'salon-hours' }, groups.map((g) => {
    const isToday = rows.some(([d]) => d === todayKey) && (() => {
      const idx = rows.findIndex(([d]) => d === g.from);
      const end = rows.findIndex(([d]) => d === g.to);
      const t = rows.findIndex(([d]) => d === todayKey);
      return t >= idx && t <= end;
    })();
    return h('div', { class: isToday ? 'is-today' : null },
      h('dt', null, g.from === g.to ? g.from : `${g.from} to ${g.to}`), h('dd', null, g.val));
  }));
}

function heroKpi(d) {
  const k = d.kpis;
  const pace = k.goal?.pace_pct;
  const sales = h('div', { class: 'salon-hero-sales t-num' });
  ui.countUp(sales, k.mtd?.net_sales_c || 0, (n) => money(n));
  const mini = (label, value, delta) => h('div', { class: 'salon-hero-mini' },
    h('div', { class: 't-eyebrow' }, label),
    h('div', { class: 'salon-hero-mini-val t-num' }, value),
    delta !== undefined && delta !== null ? h('div', { class: 't-xs' }, ui.delta(delta), h('span', { class: 't-muted' }, ' vs last week')) : null);
  const gap = (k.goal?.projected_c ?? 0) - (k.goal?.sales_goal_c ?? 0);
  return h('section', { class: 'card card-dark salon-hero' },
    h('div', { class: 'salon-hero-ring' }, ui.ring(pace ?? 0, { size: 148, stroke: 12, label: 'pace to goal', format: (n) => `${Math.round(n)}%` })),
    h('div', { class: 'salon-hero-main' },
      h('div', { class: 't-eyebrow' }, `Net sales, month to date${d.updated_through ? ` · through ${dateShort(d.updated_through)}` : ''}`),
      sales,
      h('div', { class: 'salon-hero-goal' },
        h('span', null, 'Projected ', h('b', { class: 't-num' }, money(k.goal?.projected_c))),
        h('span', null, 'Goal ', h('b', { class: 't-num' }, money(k.goal?.sales_goal_c))),
        k.goal?.sales_goal_c ? h('span', { class: ['salon-hero-gap', gap >= 0 ? 'is-up' : 'is-down'] }, gap >= 0 ? `${money(gap)} ahead` : `${money(-gap)} to find`) : null),
      refreshNote(d.refresh) ? h('div', { class: 'salon-hero-refresh', title: d.refresh.schedule_label || '' },
        ui.icon('clock', 14),
        h('span', null, 'From the daily sales and hours reports. ', loadedNote(d.refresh), '. ', h('b', null, refreshNote(d.refresh)), '.')) : null),
    h('div', { class: 'salon-hero-minis' },
      mini('Yesterday', money(k.yesterday?.net_sales_c)),
      mini('Guests', num(k.mtd?.guests), k.wow?.guests_pct),
      mini('Average ticket', money(k.mtd?.atv_c, { cents: true }), k.wow?.atv_pct),
      mini('Sales per hour', money(k.mtd?.srph_c, { cents: true }))));
}

function boxesBlock(boxes) {
  if (!boxes?.length) return null;
  const hit = boxes.filter((b) => b.state === 'ok').length;
  return h('section', { class: 'salon-section' },
    h('div', { class: 'row row-between salon-section-head' },
      h('h2', null, 'Check the boxes'),
      h('span', { class: 't-sm t-muted' }, h('b', { class: 't-num' }, `${hit} of ${boxes.length}`), ' on track')),
    h('div', { class: 'boxes' }, boxes.map((b, i) => ui.reveal(h('div', { class: ['box', b.state === 'ok' ? 'is-ok' : 'is-action'] },
      h('div', { class: 'box-top' },
        h('span', { class: 'box-mark' }, ui.icon(b.state === 'ok' ? 'check' : 'x', 16)),
        h('span', { class: 'box-label' }, b.label)),
      h('div', { class: 'box-value t-num' }, b.value_label ?? '–'),
      h('div', { class: 'box-goal' }, b.goal_label ? `Goal ${b.goal_label.replace(/^goal:?\s*/i, '')}` : ''),
      b.pct !== null && b.pct !== undefined ? ui.progress(Math.min(100, b.pct), { tone: b.state === 'ok' ? 'good' : 'brand' }) : null), i * 50))));
}

function rankStrip(d) {
  const r = d.rank;
  if (!r) return null;
  const cell = (label, value, sub) => h('div', { class: 'rank-cell' },
    h('div', { class: 't-eyebrow' }, label),
    h('div', { class: 'rank-val t-num' }, value),
    sub ? h('div', { class: 't-xs t-muted' }, sub) : null);
  return h('section', { class: 'card rank-strip' },
    cell('Score', r.score !== null && r.score !== undefined ? Number(r.score).toFixed(1) : '–', 'pace, sales per hour, product, checklists'),
    cell('District', ordinal(r.district), d.salon.district || null),
    cell('Market', ordinal(r.market), d.salon.market || null),
    cell('Company', ordinal(r.company), r.of_company ? `of ${r.of_company} salons` : null),
    h('a', { class: 't-link t-sm rank-link', href: '#/scoreboard' }, 'See the scoreboard'));
}

function alertsBlock(d, ctx) {
  const groups = [
    ['people', 'People', 'users'],
    ['store', 'Store', 'store'],
    ['initiative', 'Initiatives', 'target'],
  ];
  const total = groups.reduce((n, [k]) => n + (d.alerts?.[k]?.length || 0), 0);
  if (!total) return null;
  const canToggle = d.salon.in_scope && ['salon_manager', 'district_leader', 'admin'].includes(ctx.user.role);
  return h('section', { class: 'salon-section' },
    h('div', { class: 'row row-between salon-section-head' },
      h('h2', null, 'Alerts'),
      canToggle ? h('span', { class: 't-sm t-muted' }, 'Tap an item to mark it done or reopen it.') : null),
    h('div', { class: 'grid grid-3' }, groups.map(([key, label, ic]) => {
      const items = d.alerts?.[key] || [];
      const head = h('span', { class: 'row gap-2' }, ui.icon(ic, 18), h('h3', null, label));
      const counter = h('span');
      const paintCount = () => {
        const open = items.filter((a) => a.state === 'action').length;
        mount(counter, open ? ui.badge(`${open} to do`, 'bad') : ui.badge('All clear', 'good'));
      };
      paintCount();
      const list = h('div', { class: 'list alert-list' }, items.length ? items.map((a) => {
        const mark = h('span', { class: 'alert-mark' });
        const row = h(canToggle ? 'button' : 'div', { class: 'alert-row', type: canToggle ? 'button' : null });
        const paint = () => {
          row.classList.toggle('is-action', a.state === 'action');
          mount(mark, ui.icon(a.state === 'action' ? 'alert' : 'check', 14));
          if (canToggle) row.setAttribute('aria-label', `${a.label}: ${a.state === 'action' ? 'needs action, tap to mark done' : 'done, tap to reopen'}`);
        };
        row.append(mark, h('span', { class: 'grow' }, h('span', { class: 'alert-label' }, a.label), a.due_on && a.state === 'action' ? h('span', { class: 't-xs t-muted' }, `Due ${dateShort(a.due_on)}`) : null));
        if (canToggle) {
          row.addEventListener('click', async () => {
            const prev = a.state;
            a.state = prev === 'action' ? 'ok' : 'action';
            paint();
            paintCount();
            try {
              await api.patch(`/alerts/${a.id}`, { state: a.state });
            } catch (err) {
              a.state = prev;
              paint();
              paintCount();
              ui.toast(err.message, 'bad');
            }
          });
        }
        paint();
        return row;
      }) : h('div', { class: 't-sm t-muted' }, 'Nothing to action.'));
      return ui.card({ title: head, action: counter, flush: true }, list);
    })));
}

function dsrBlock(d) {
  const host = h('section', { class: 'salon-section' });
  const body = h('div', { class: 'stack' }, ui.skeleton('card', 1));
  let days = [];
  let span = 30;
  const paint = () => {
    const rows = days.slice(-span);
    if (!rows.length) {
      mount(body, h('div', { class: 'card' }, ui.empty({ icon: 'chart', title: 'No daily numbers yet', body: 'The daily sales report will appear here once it is loaded.' })));
      return;
    }
    const sum = (key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
    const tot = { net: sum('net_sales_c'), service: sum('service_c'), product: sum('product_c'), guests: sum('guests'), hours: sum('hours') };
    const chart = ui.lineChart({
      series: [{ label: 'Net sales', tone: 'brand', points: rows.map((r) => ({ x: r.date, y: (r.net_sales_c || 0) / 100 })) }],
      yFormat: (v) => money(v * 100, { compact: true }),
      xFormat: (x) => dateShort(x),
      height: 220,
    });
    const table = ui.table({
      columns: [
        { key: 'date', label: 'Day', render: (r) => h('span', { class: 't-strong' }, new Date(`${r.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) },
        { key: 'net', label: 'Net sales', align: 'right', render: (r) => money(r.net_sales_c) },
        { key: 'service', label: 'Service', align: 'right', render: (r) => money(r.service_c) },
        { key: 'product', label: 'Product', align: 'right', render: (r) => money(r.product_c) },
        { key: 'guests', label: 'Guests', align: 'right', render: (r) => num(r.guests) },
        { key: 'atv', label: 'Avg ticket', align: 'right', render: (r) => money(r.atv_c, { cents: true }) },
        { key: 'srph', label: 'Sales / hr', align: 'right', render: (r) => money(r.srph_c, { cents: true }) },
        { key: 'ppct', label: 'Product %', align: 'right', render: (r) => pct(r.product_pct) },
        { key: 'hours', label: 'Hours', align: 'right', render: (r) => (r.hours ?? 0).toFixed(1) },
      ],
      rows: [...rows].reverse(),
    });
    const totals = h('div', { class: 'dsr-totals' }, [
      ['Net sales', money(tot.net)],
      ['Service', money(tot.service)],
      ['Product', money(tot.product)],
      ['Guests', num(tot.guests)],
      ['Avg ticket', tot.guests ? money(Math.round(tot.net / tot.guests), { cents: true }) : '–'],
      ['Sales / hr', tot.hours ? money(Math.round(tot.service / tot.hours), { cents: true }) : '–'],
      ['Product %', tot.net ? pct((tot.product / tot.net) * 100) : '–'],
    ].map(([l, v]) => h('div', null, h('div', { class: 't-xs t-muted' }, l), h('div', { class: 't-num t-strong' }, v))));
    mount(body, [
      ui.card({ title: `Net sales, last ${rows.length} days` }, chart),
      ui.card({ title: 'Daily sales report', flush: true }, totals, h('div', { class: 'dsr-table' }, table)),
    ]);
  };
  host.append(
    h('div', { class: 'row row-between salon-section-head' }, h('h2', null, 'Daily numbers'),
      ui.segmented([{ key: '7', label: '7 days' }, { key: '14', label: '14 days' }, { key: '30', label: '30 days' }], '30', (k) => { span = Number(k); paint(); })),
    body);
  (async () => {
    try {
      const to = d.updated_through || new Date().toISOString().slice(0, 10);
      const fromDate = new Date(`${to}T12:00:00`);
      fromDate.setDate(fromDate.getDate() - 29);
      const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
      const r = await api.get(`/salons/${d.salon.id}/dsr`, { from, to });
      days = r.days || [];
      paint();
    } catch (err) {
      mount(body, ui.errorState(err));
    }
  })();
  return host;
}

function stylistBlock(d, ctx) {
  const host = h('section', { class: 'salon-section' }, h('div', { class: 'salon-section-head' }, h('h2', null, 'Stylist leaderboard')));
  const body = h('div', null, ui.skeleton('table', 5));
  host.append(body);
  api.get(`/salons/${d.salon.id}/stylists`).then((r) => {
    const items = r.items || [];
    if (!items.length) {
      host.remove(); // sales are reported by salon; this section returns when a per-stylist feed exists
      return;
    }
    const top = Math.max(1, ...items.map((x) => x.service_c || 0));
    mount(body, ui.card({ flush: true }, ui.table({
      columns: [
        { key: 'rank', label: '#', render: (x, i) => h('span', { class: 'rank', dataset: { top: x.rank || i + 1 } }, String(x.rank || i + 1)) },
        { key: 'user', label: 'Stylist', render: (x) => ui.userChip(x.user, { size: 34, sub: x.user?.title || roleLabel(x.user?.role) }) },
        { key: 'service', label: 'Service sales', align: 'right', render: (x) => h('div', { class: 'stylist-bar' }, h('span', { class: 't-num t-strong' }, money(x.service_c)), h('span', { class: 'stylist-bar-track' }, h('span', { class: 'stylist-bar-fill', style: { width: `${Math.max(3, ((x.service_c || 0) / top) * 100)}%` } }))) },
        { key: 'guests', label: 'Guests', align: 'right', render: (x) => num(x.guests) },
        { key: 'srph', label: 'Sales / hr', align: 'right', render: (x) => money(x.srph_c, { cents: true }) },
        { key: 'ppct', label: 'Product %', align: 'right', render: (x) => pct(x.product_pct) },
      ],
      rows: items,
      rowClass: (x) => (x.user?.id === ctx.user.id ? 'is-me' : null),
    })));
  }).catch((err) => {
    if (err.status === 403) host.remove();
    else mount(body, ui.errorState(err));
  });
  return host;
}

function teamBlock(d) {
  const team = d.team || [];
  return h('section', { class: 'salon-section' },
    h('div', { class: 'row row-between salon-section-head' }, h('h2', null, 'The team'), h('span', { class: 't-sm t-muted' }, `${team.length} ${team.length === 1 ? 'person' : 'people'}`)),
    team.length
      ? h('div', { class: 'grid grid-auto-sm team-grid' }, team.map((p) => h('a', { class: 'card card-link team-card', href: `#/people/${p.id}` },
        ui.avatar(p, 52),
        h('div', { class: 't-strong t-clip' }, p.name),
        h('div', { class: 't-xs t-muted t-clip' }, p.title || roleLabel(p.role)),
        p.tenure_label ? h('div', { class: 't-xs t-faint' }, p.tenure_label) : null)))
      : h('div', { class: 'card' }, ui.empty({ icon: 'users', title: 'No team members listed yet' })));
}

function accordions(d) {
  const k = d.kpis;
  if (!k) return null;
  const line = (label, value) => h('div', { class: 'acc-line' }, h('span', { class: 't-muted' }, label), h('span', { class: 't-num t-strong' }, value));
  const acc = (ic, title, summary, children, open) => h('details', { class: 'acc card', open },
    h('summary', null, h('span', { class: 'acc-icon' }, ui.icon(ic, 18)), h('span', { class: 'grow' }, h('span', { class: 'acc-title' }, title), h('span', { class: 't-sm t-muted acc-sum' }, summary)), ui.icon('chevronDown', 18)),
    h('div', { class: 'acc-body' }, children));
  const m = k.mtd || {};
  const team = d.team || [];
  return h('section', { class: 'salon-section stack' },
    h('div', { class: 'salon-section-head' }, h('h2', null, 'More detail')),
    acc('chart', 'Sales', `${money(m.net_sales_c)} this month`, [
      line('Service sales', money(m.service_c)),
      line('Product sales', money(m.product_c)),
      line('Product share of sales', `${pct(m.product_pct)}${k.goal?.product_pct_goal ? `  (goal ${pct(k.goal.product_pct_goal)})` : ''}`),
      line('Haircuts', num(m.haircuts)),
      line('Supercut Plus upgrades', num(m.supercut_plus)),
      line('Average ticket', money(m.atv_c, { cents: true })),
      line('Sales vs same days last week', signed(k.wow?.net_sales_pct)),
    ], true),
    acc('checklist', 'Operations', `${num(Math.round(m.hours || 0))} clocked hours this month`, [
      line('Clocked hours', (m.hours ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })),
      line('Sales per clocked hour', `${money(m.srph_c, { cents: true })}${k.goal?.srph_goal_c ? `  (goal ${money(k.goal.srph_goal_c, { cents: true })})` : ''}`),
      line('Guests per clocked hour', m.hours ? (m.guests / m.hours).toFixed(2) : '–'),
      h('div', { class: 'acc-links' },
        h('a', { class: 't-link', href: '#/operations' }, 'Open and close checklists'),
        h('a', { class: 't-link', href: '#/tickets' }, 'Support tickets')),
    ]),
    acc('users', 'People', `${team.length} on the team`, [
      line('Team members', String(team.length)),
      line('Manager', d.salon.manager?.name || 'Open position'),
      line('District', d.salon.district || '–'),
      h('div', { class: 'acc-links' },
        h('a', { class: 't-link', href: '#/directory' }, 'Open the directory'),
        h('a', { class: 't-link', href: '#/tube' }, 'Training videos')),
    ]));
}

/* ---------- salon detail ---------- */

async function detail(ctx, id) {
  const { user } = ctx;
  const d = await api.get(`/salons/${id}`);
  const s = d.salon;
  const wide = user.scope !== 'salon' || !user.salon;
  const isMine = user.salon?.id === s.id;

  let switcher = null;
  if (wide) {
    switcher = h('select', { class: 'select salon-switch', 'aria-label': 'Switch salon' }, h('option', { value: s.id }, s.name));
    api.get('/salons').then((r) => {
      const list = (r.items || []).filter((x) => user.scope === 'all' || x.in_scope || x.id === s.id);
      mount(switcher, list.map((x) => h('option', { value: x.id, selected: x.id === s.id }, `${x.name}  #${x.salon_number}`)));
    }).catch(() => {});
    switcher.addEventListener('change', () => ctx.navigate(`/salon/${switcher.value}`));
  }

  const addr = [s.address, [s.city, s.state].filter(Boolean).join(', '), s.zip].filter(Boolean).join(' · ');
  const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(`${s.address || ''} ${s.city || ''} ${s.state || ''} ${s.zip || ''}`)}`;
  const header = h('header', { class: 'card salon-head' },
    h('div', { class: 'media salon-head-photo' }, s.photo_url ? h('img', { src: s.photo_url, alt: `${s.name} salon` }) : null),
    h('div', { class: 'salon-head-main' },
      h('div', { class: 'row row-wrap gap-2' },
        h('span', { class: 't-eyebrow' }, `Salon #${s.salon_number}`),
        s.concept === 'SMARTSTYLE' ? ui.badge('SmartStyle', 'info') : null,
        isMine ? ui.badge('My salon', 'brand') : null),
      h('h1', null, s.name),
      h('div', { class: 'salon-head-meta' },
        addr ? h('a', { href: mapsUrl, target: '_blank', rel: 'noopener' }, ui.icon('pin', 15), h('span', null, addr)) : null,
        s.phone ? h('a', { href: `tel:${String(s.phone).replace(/[^\d+]/g, '')}` }, ui.icon('phone', 15), h('span', null, s.phone)) : null,
        s.shopping_center ? h('span', null, ui.icon('building', 15), h('span', null, s.shopping_center)) : null),
      h('div', { class: 'salon-head-tags' },
        s.market ? ui.badge(s.market) : null,
        s.district ? ui.badge(`District: ${s.district}`) : null,
        s.entity && ctx.can('kpi.company') ? ui.badge(s.entity) : null)),
    h('div', { class: 'salon-head-side' },
      h('div', null,
        h('div', { class: 't-eyebrow' }, 'Salon manager'),
        s.manager ? ui.userChip(s.manager, { size: 40, sub: s.manager.title || 'Salon Manager' }) : h('div', { class: 't-sm t-muted' }, 'Open position')),
      d.salon.hours ? h('div', null, h('div', { class: 't-eyebrow' }, 'Hours'), hoursBlock(s.hours)) : null),
    h('div', { class: 'salon-head-tools' },
      switcher,
      h('a', { class: 'btn btn-secondary btn-sm', href: '#/salon?all=1' }, ui.icon('store', 16), 'All salons')));

  const blocks = [header];
  if (d.kpis) {
    blocks.push(heroKpi(d), boxesBlock(d.boxes), rankStrip(d), alertsBlock(d, ctx), dsrBlock(d), stylistBlock(d, ctx), teamBlock(d), accordions(d));
  } else {
    blocks.push(
      h('section', { class: 'card salon-public' },
        s.pace_pct !== null && s.pace_pct !== undefined ? ui.ring(s.pace_pct, { size: 120, stroke: 10, tone: paceTone(s.pace_pct), label: 'pace to goal' }) : null,
        h('div', { class: 'grow' },
          h('h2', null, s.pace_pct >= 100 ? 'On pace this month' : 'Chasing goal this month'),
          h('p', { class: 't-muted' }, 'Detailed sales numbers are shared with this salon’s own team and its leaders. Everyone can see pace and rank.'))),
      rankStrip(d), teamBlock(d));
  }
  return h('div', { class: 'salon stack-lg' }, blocks.filter(Boolean));
}

export default {
  title: (ctx) => (ctx.params.id || (ctx.user.salon && !ctx.query.all) ? (ctx.user.salon && !ctx.params.id ? 'My salon' : 'Salon') : 'Salons'),
  css: true,
  async render(ctx) {
    const id = ctx.params.id || (!ctx.query.all && ctx.user.salon?.id);
    if (id) return detail(ctx, id);
    return finder(ctx);
  },
};

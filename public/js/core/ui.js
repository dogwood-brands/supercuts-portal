// Shared UI components. Signatures are fixed by SPEC.md §7; pages build everything from these.

import { h, clear, mount } from './dom.js';
import { icon } from './icons.js';
import { initials, whereLabel } from './format.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- identity ---------- */

function toneFor(user) {
  const key = String((user && (user.id ?? user.name)) || '');
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum = (sum * 31 + key.charCodeAt(i)) % 997;
  return sum % 6;
}

function avatar(user, size = 40) {
  const el = h('span', { class: 'avatar', style: { '--size': `${size}px` }, dataset: { tone: toneFor(user) }, 'aria-hidden': 'true' });
  if (user && user.avatar_url) {
    const img = h('img', { src: user.avatar_url, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => mount(el, initials(user.name)));
    el.appendChild(img);
  } else {
    el.textContent = initials(user && user.name);
  }
  return el;
}

function userChip(user, { size = 40, sub, link = true } = {}) {
  const text = h('span', { class: 'user-chip-text' },
    h('span', { class: 'user-chip-name' }, user ? user.name : 'Unknown'),
    h('span', { class: 'user-chip-sub' }, sub !== undefined ? sub : whereLabel(user)));
  const attrs = { class: 'user-chip' };
  if (link && user && user.id) return h('a', { ...attrs, href: `#/people/${user.id}` }, avatar(user, size), text);
  return h('span', attrs, avatar(user, size), text);
}

function badge(text, tone = 'neutral') {
  return h('span', { class: ['badge', tone !== 'neutral' && `badge-${tone}`] }, text);
}

/* ---------- actions ---------- */

function button(label, { variant = 'primary', icon: iconName, onClick, type = 'button', busy = false, size, block, title, disabled } = {}) {
  const el = h('button', {
    class: ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', !label && 'btn-icon', busy && 'is-busy'],
    type,
    title,
    disabled,
    'aria-label': !label ? title : null,
  }, iconName ? icon(iconName, size === 'sm' ? 16 : 18) : null, label || null);
  if (onClick) {
    el.addEventListener('click', async (e) => {
      const out = onClick(e);
      if (out && typeof out.then === 'function') {
        el.classList.add('is-busy');
        try {
          await out;
        } finally {
          el.classList.remove('is-busy');
        }
      }
    });
  }
  return el;
}

/* ---------- containers ---------- */

function card({ title, action, pad = true, flush = false, dark = false, class: cls } = {}, ...children) {
  const el = h('section', { class: ['card', dark && 'card-dark', cls] });
  if (title || action) {
    el.appendChild(h('header', { class: 'card-head' }, typeof title === 'string' ? h('h3', null, title) : title, action || null));
  }
  if (flush || !pad) {
    for (const c of children.flat()) if (c) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  } else {
    el.appendChild(h('div', { class: 'card-body' }, children));
  }
  return el;
}

function pageHeader({ title, eyebrow, sub, actions } = {}) {
  return h('header', { class: 'page-header' },
    h('div', null,
      eyebrow ? h('div', { class: 't-eyebrow' }, eyebrow) : null,
      h('h1', null, title),
      sub ? h('p', { class: 'page-header-sub' }, sub) : null),
    actions ? h('div', { class: 'page-header-actions' }, actions) : null);
}

/* ---------- numbers ---------- */

function deltaEl(delta) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null;
  const dir = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  return h('span', { class: `delta delta-${dir}` },
    dir === 'flat' ? null : icon(dir === 'up' ? 'arrowUp' : 'arrowDown', 12),
    `${Math.abs(delta).toFixed(1)}%`);
}

/** delta is a percent change (4.2 means +4.2%). */
function stat({ label, value, delta, hint, tone } = {}) {
  const valueEl = h('div', { class: ['stat-value', tone && `t-${tone}`] }, value ?? '–');
  const el = h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    valueEl,
    delta !== undefined || hint ? h('div', { class: 'stat-foot' }, deltaEl(delta), hint ? h('span', null, hint) : null) : null);
  el.valueEl = valueEl;
  return el;
}

function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) {
    requestAnimationFrame(fn);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      requestAnimationFrame(fn);
    }
  }, { threshold: 0.15 });
  io.observe(el);
}

function progress(value, { tone, label } = {}) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const bar = h('div', { class: 'progress-bar' });
  const el = h('div', { class: 'progress', dataset: { tone: tone || '' }, role: 'progressbar', 'aria-valuenow': Math.round(v), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    label ? h('div', { class: 'progress-head' }, h('span', null, label), h('span', { class: 't-num t-strong' }, `${Math.round(value)}%`)) : null,
    h('div', { class: 'progress-track' }, bar));
  whenVisible(el, () => { bar.style.width = `${v}%`; });
  return el;
}

/** Animate a number from 0 to `to`. `formatFn` turns the running value into text. */
function countUp(el, to, formatFn = (n) => String(Math.round(n))) {
  const target = Number(to) || 0;
  if (reduceMotion()) {
    el.textContent = formatFn(target);
    return el;
  }
  el.textContent = formatFn(0);
  whenVisible(el, () => {
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatFn(target * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return el;
}

function reveal(el, delay = 0) {
  el.classList.add('reveal');
  if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
  whenVisible(el, () => el.classList.add('is-in'));
  return el;
}

/* ---------- navigation within a page ---------- */

function tabs(items, active, onChange) {
  const el = h('div', { class: 'tabs', role: 'tablist' });
  const paint = (key) => {
    clear(el);
    for (const item of items) {
      el.appendChild(h('button', {
        class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(item.key === key),
        onClick: () => { if (item.key !== key) { paint(item.key); onChange(item.key); } },
      }, item.label, item.count !== undefined && item.count !== null ? h('span', { class: 'tab-count' }, String(item.count)) : null));
    }
  };
  paint(active);
  return el;
}

function segmented(items, active, onChange) {
  const el = h('div', { class: 'segmented', role: 'group' });
  const paint = (key) => {
    clear(el);
    for (const item of items) {
      el.appendChild(h('button', {
        type: 'button', 'aria-pressed': String(item.key === key),
        onClick: () => { if (item.key !== key) { paint(item.key); onChange(item.key); } },
      }, item.label));
    }
  };
  paint(active);
  return el;
}

/* ---------- data ---------- */

function table({ columns, rows, onRow, empty: emptyState, rowClass } = {}) {
  if (!rows || !rows.length) return emptyState || empty({ title: 'Nothing here yet' });
  const align = (c) => (c.align === 'right' ? 'is-right' : c.align === 'center' ? 'is-center' : null);
  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr', { class: [onRow && 'is-clickable', rowClass && rowClass(row)] },
      columns.map((c) => h('td', { class: align(c) }, c.render ? c.render(row, i) : row[c.key] ?? '–')));
    if (onRow) {
      tr.tabIndex = 0;
      tr.addEventListener('click', () => onRow(row));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(row); });
    }
    tbody.appendChild(tr);
  });
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      h('thead', null, h('tr', null, columns.map((c) => h('th', { class: align(c), scope: 'col' }, c.label)))),
      tbody));
}

function empty({ icon: iconName = 'sparkle', title, body, action } = {}) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, 22)),
    h('h3', null, title),
    body ? h('p', null, body) : null,
    action || null);
}

/** A readable failure state with a retry. Use in every page's catch block. */
function errorState(err, retry) {
  const el = empty({
    icon: 'alert',
    title: err && err.status === 403 ? 'You do not have access to this' : 'This did not load',
    body: (err && err.message) || 'Something went wrong. Please try again.',
    action: retry ? button('Try again', { variant: 'secondary', onClick: retry }) : null,
  });
  el.classList.add('error-state');
  return el;
}

function skeleton(kind = 'card', count = 3) {
  const wrap = h('div', { 'aria-busy': 'true', 'aria-label': 'Loading' });
  if (kind === 'stat') {
    wrap.className = 'grid grid-4';
    for (let i = 0; i < 4; i++) wrap.appendChild(h('div', { class: 'skeleton skeleton-stat' }));
  } else if (kind === 'table' || kind === 'list') {
    for (let i = 0; i < Math.max(count, 6); i++) wrap.appendChild(h('div', { class: 'skeleton skeleton-row' }));
  } else {
    wrap.className = 'stack';
    for (let i = 0; i < count; i++) wrap.appendChild(h('div', { class: 'skeleton skeleton-card' }));
  }
  return wrap;
}

/* ---------- forms ---------- */

let fieldSeq = 0;
function field({ label, name, type = 'text', value, options, required, hint, rows, placeholder, maxLength, autocomplete, min, max } = {}) {
  const id = `f${++fieldSeq}`;
  let input;
  if (type === 'textarea') {
    input = h('textarea', { class: 'textarea', id, name, rows: rows || 4, required, placeholder, maxLength });
    if (value) input.value = value;
  } else if (type === 'select') {
    input = h('select', { class: 'select', id, name, required },
      (options || []).map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return h('option', { value: opt.value, selected: String(opt.value) === String(value ?? '') }, opt.label);
      }));
  } else {
    input = h('input', { class: 'input', id, name, type, required, placeholder, maxLength, autocomplete, min, max });
    if (value !== undefined && value !== null) input.value = value;
  }
  const el = h('div', { class: 'field' },
    label ? h('label', { class: 'field-label', for: id }, label) : null,
    input,
    hint ? h('div', { class: 'field-hint' }, hint) : null);
  el.input = input;
  return el;
}

/** onSubmit(values) may be async; throwing shows the error message under the form. */
function form({ fields, submitLabel = 'Save', onSubmit, onCancel, cancelLabel = 'Cancel' } = {}) {
  const fieldEls = fields.map((f) => (f instanceof Node ? f : field(f)));
  const error = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const submit = button(submitLabel, { type: 'submit' });
  const el = h('form', { class: 'form', novalidate: false }, fieldEls, error,
    h('div', { class: 'form-actions' },
      onCancel ? button(cancelLabel, { variant: 'ghost', onClick: onCancel }) : null,
      submit));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {};
    for (const node of el.querySelectorAll('[name]')) {
      values[node.name] = node.type === 'checkbox' ? node.checked : node.value.trim();
    }
    error.hidden = true;
    submit.classList.add('is-busy');
    try {
      await onSubmit(values, el);
    } catch (err) {
      error.textContent = err.message || 'That did not save. Please try again.';
      error.hidden = false;
    } finally {
      submit.classList.remove('is-busy');
    }
  });
  return el;
}

/* ---------- overlays ---------- */

function trapKeys(overlay, close) {
  const prev = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const focusable = overlay.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  overlay.addEventListener('keydown', onKey);
  return () => {
    if (prev && prev.focus) prev.focus();
  };
}

function overlayShell({ title, body, actions, size, drawerMode, dismissable = true }) {
  let closed = false;
  let restore = () => {};
  const closeBtn = dismissable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x', 18)) : null;
  const panel = h('div', { class: drawerMode ? 'drawer' : 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, dataset: { size: size || '' }, tabIndex: -1 },
    h('div', { class: 'modal-head' }, h('h2', null, title), closeBtn),
    h('div', { class: 'modal-body' }, body),
    actions && actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  const overlay = h('div', { class: ['overlay', drawerMode && 'drawer-overlay'] }, panel);
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.documentElement.style.overflow = '';
    restore();
    if (api.onClose) api.onClose();
  }
  if (dismissable) overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
  restore = trapKeys(overlay, dismissable ? close : () => {});
  const first = panel.querySelector('input, textarea, select');
  (first || panel).focus();
  const api = { el: panel, close, onClose: null };
  return api;
}

function modal({ title, body, actions, size, dismissable } = {}) {
  return overlayShell({ title, body, actions, size, dismissable });
}

function drawer({ title, body, actions } = {}) {
  return overlayShell({ title, body, actions, drawerMode: true });
}

function confirm({ title, body, confirmLabel = 'Confirm', tone } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
      m.close();
    };
    const m = modal({
      title,
      size: 'sm',
      body: h('p', { class: 't-muted' }, body),
      actions: [
        button('Cancel', { variant: 'ghost', onClick: () => done(false) }),
        button(confirmLabel, { variant: tone === 'danger' ? 'danger' : 'primary', onClick: () => done(true) }),
      ],
    });
    m.onClose = () => done(false);
  });
}

let toastHost;
function toast(message, tone = 'neutral') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: 'toast', dataset: { tone } }, tone === 'bad' ? null : h('span', { class: 'toast-dot' }), message);
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }, tone === 'bad' ? 5200 : 3200);
  return el;
}

/** A small popover menu anchored under a button. items: [{label, icon?, onClick, href?} | 'divider'] */
function menu(anchor, items, { align = 'right' } = {}) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const el = h('div', { class: 'menu', role: 'menu' });
  const close = () => {
    el.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  for (const item of items) {
    if (!item) continue;
    if (item === 'divider') { el.appendChild(h('hr')); continue; }
    const node = item.href
      ? h('a', { href: item.href, role: 'menuitem', onClick: close }, item.icon ? icon(item.icon, 16) : null, item.label)
      : h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); item.onClick(); } }, item.icon ? icon(item.icon, 16) : null, item.label);
    el.appendChild(node);
  }
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
  return { el, close };
}

/* ---------- charts (SVG, no library) ---------- */

function sparkline(values, { w = 96, h: hgt = 28, tone } = {}) {
  const vals = (values || []).map(Number).filter((v) => !Number.isNaN(v));
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (w - 4), hgt - 3 - ((v - min) / span) * (hgt - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  svg.appendChild(h('path', { class: 'series-line', d, 'data-tone': tone || '' }));
  const last = pts[pts.length - 1];
  svg.appendChild(h('circle', { cx: last[0], cy: last[1], r: 2.4, fill: tone === 'brand' ? 'var(--brand)' : tone === 'good' ? 'var(--good)' : 'var(--ink)' }));
  return svg;
}

function barChart({ rows, max } = {}) {
  const top = max || Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  const el = h('div', { class: 'bars' });
  rows.forEach((r, i) => {
    const fill = h('div', { class: 'bar-fill', dataset: { tone: r.tone || '' } });
    el.appendChild(h('div', { class: 'bar-row' },
      h('span', { class: 't-clip' }, r.label),
      h('div', { class: 'bar-track' }, fill),
      h('span', { class: 'bar-value' }, r.valueLabel ?? String(r.value))));
    whenVisible(el, () => setTimeout(() => { fill.style.width = `${Math.max(2, Math.min(100, ((Number(r.value) || 0) / top) * 100))}%`; }, i * 40));
  });
  return el;
}

/**
 * series: [{label, tone?, points: [{x: 'label' | ISO date, y: number}]}]
 * The first series gets a soft area fill. Hover or touch shows values for that x.
 */
function lineChart({ series, yFormat = (v) => String(Math.round(v)), xFormat = (x) => x, height = 220 } = {}) {
  const H = height;
  const pad = { l: 48, r: 12, t: 12, b: 26 };
  const host = h('div', { class: 'chart-host' });
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v !== null && v !== undefined);
  if (!all.length) {
    host.appendChild(empty({ icon: 'chart', title: 'No data for this period yet' }));
    return host;
  }
  let animated = false;
  const draw = (W) => {
  clear(host);
  const n = Math.max(...series.map((s) => s.points.length));
  let max = Math.max(...all);
  let min = Math.min(0, ...all);
  if (max === min) max = min + 1;
  max += (max - min) * 0.08;
  const X = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((s) => s.label).join(', '), width: W, height: H });
  for (let g = 0; g <= 3; g++) {
    const v = min + ((max - min) * g) / 3;
    svg.appendChild(h('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.appendChild(h('text', { x: pad.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, yFormat(v)));
  }
  const base = series[0].points;
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 110))));
  for (let i = 0; i < n; i += step) {
    if (base[i]) svg.appendChild(h('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' }, xFormat(base[i].x)));
  }
  const lines = [];
  series.forEach((s, si) => {
    const pts = s.points.map((p, i) => [X(i), Y(p.y ?? min)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    if (si === 0 && pts.length > 1) {
      svg.appendChild(h('path', { class: 'series-area', 'data-tone': s.tone || '', d: `${d} L${pts[pts.length - 1][0]} ${Y(min)} L${pts[0][0]} ${Y(min)} Z` }));
    }
    const path = h('path', { class: 'series-line', 'data-tone': s.tone || '', d });
    svg.appendChild(path);
    lines.push(path);
  });
  const cursor = h('line', { class: 'grid-line', y1: pad.t, y2: H - pad.b, x1: 0, x2: 0, style: { opacity: 0, stroke: 'var(--ink)' } });
  svg.appendChild(cursor);
  host.appendChild(svg);

  if (!reduceMotion() && !animated) {
    animated = true;
    for (const path of lines) {
      if (path.dataset.tone === 'muted') continue;
      const len = path.getTotalLength ? path.getTotalLength() : 0;
      if (!len) continue;
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      whenVisible(host, () => {
        path.classList.add('is-drawing');
        path.style.strokeDashoffset = '0';
        setTimeout(() => { path.classList.remove('is-drawing'); path.style.strokeDasharray = ''; }, 1250);
      });
    }
  }

  const tip = h('div', { class: 'chart-tip', hidden: true });
  host.appendChild(tip);
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const rel = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((rel - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
    const xPx = (X(i) / W) * r.width;
    cursor.setAttribute('x1', X(i));
    cursor.setAttribute('x2', X(i));
    cursor.style.opacity = 0.25;
    mount(tip, [
      h('div', { class: 't-strong' }, base[i] ? xFormat(base[i].x) : ''),
      series.map((s) => (s.points[i] ? h('div', null, `${s.label}: ${yFormat(s.points[i].y)}`) : null)),
    ]);
    tip.hidden = false;
    tip.style.left = `${Math.max(60, Math.min(r.width - 60, xPx))}px`;
    tip.style.top = `${(Y(series[0].points[i] ? series[0].points[i].y : min) / H) * r.height}px`;
  };
  const leave = () => { tip.hidden = true; cursor.style.opacity = 0; };
  svg.addEventListener('mousemove', (e) => move(e.clientX));
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchstart', (e) => move(e.touches[0].clientX), { passive: true });
  svg.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
  svg.addEventListener('touchend', leave);
  };
  // Drawn at the host's real pixel width so text never stretches; redrawn when the card resizes.
  let lastW = 0;
  const fit = () => {
    const w = Math.round(host.clientWidth);
    if (w > 0 && Math.abs(w - lastW) > 1) { lastW = w; draw(Math.max(280, w)); }
  };
  host.style.minHeight = `${H}px`;
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(host);
  else requestAnimationFrame(fit);
  return host;
}

function ring(value, { size = 120, label, tone, stroke = 10, format } = {}) {
  const v = Math.max(0, Number(value) || 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const bar = h('circle', { class: 'ring-bar', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c });
  const numEl = h('span');
  const el = h('div', { class: 'ring', dataset: { tone: tone || '' }, style: { width: `${size}px`, height: `${size}px` } },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      h('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), bar),
    h('div', { class: 'ring-label', style: { fontSize: `${Math.round(size * 0.24)}px` } }, numEl, label ? h('small', null, label) : null));
  countUp(numEl, v, format || ((n) => `${Math.round(n)}%`));
  whenVisible(el, () => { bar.style.strokeDashoffset = String(c * (1 - Math.min(1, v / 100))); });
  return el;
}

export const ui = {
  avatar, userChip, badge, button, icon, card, pageHeader, stat, delta: deltaEl, progress, countUp, reveal,
  tabs, segmented, table, empty, errorState, skeleton, field, form, modal, drawer, confirm, toast, menu,
  sparkline, barChart, lineChart, ring,
};
export default ui;

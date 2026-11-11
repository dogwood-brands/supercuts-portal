// Small helpers shared by the modules pages (promos, standards, operations, tickets, HR, admin ...).

import { h, mount } from '../../core/dom.js';
import { ui } from '../../core/ui.js';

/**
 * Fill `host` from an async builder, with a skeleton while it loads and a retry on failure.
 * Returns a function that reloads the region. Late results from an older load are dropped.
 */
export function region(host, build, { skeleton = 'card', count = 3 } = {}) {
  let seq = 0;
  async function run({ quiet = false } = {}) {
    const mine = ++seq;
    if (!quiet || !host.firstChild) mount(host, ui.skeleton(skeleton, count));
    try {
      const node = await build();
      if (mine === seq) mount(host, node);
    } catch (err) {
      if (mine === seq) mount(host, ui.errorState(err, () => run()));
    }
  }
  run();
  return run;
}

/** Today's calendar date in the person's own timezone, as YYYY-MM-DD. */
export function today() {
  return isoDate(new Date());
}

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Whole days from today to `iso` (negative when it is in the past). */
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((parseDate(iso) - parseDate(today())) / 86400000);
}

export function dateRange(from, to) {
  const fmt = (iso, year) => parseDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  if (!from && !to) return '';
  if (!to || from === to) return fmt(from || to, true);
  if (!from) return `Until ${fmt(to, true)}`;
  return `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} to ${fmt(to, true)}`;
}

const STATUS = {
  open: ['Open', 'brand'],
  in_progress: ['In progress', 'info'],
  waiting: ['Waiting on you', 'warn'],
  resolved: ['Resolved', 'good'],
  closed: ['Closed', 'neutral'],
};
export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, [label]]) => ({ value, label }));
export const statusLabel = (s) => (STATUS[s] ? STATUS[s][0] : s || 'Open');
export const statusBadge = (s) => ui.badge(statusLabel(s), STATUS[s] ? STATUS[s][1] : 'neutral');
export const isOpenStatus = (s) => s === 'open' || s === 'in_progress' || s === 'waiting';

/** A back link shown above detail views. */
export function backLink(href, label) {
  return h('a', { class: 'back-link row gap-2 t-sm t-strong t-muted', href }, ui.icon('chevronLeft', 16), label);
}

/** A search box that looks like the rest of the inputs. onInput receives the trimmed text. */
export function searchBox(placeholder, onInput, value = '') {
  const input = h('input', { class: 'input', type: 'search', placeholder, 'aria-label': placeholder, value, autocomplete: 'off' });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onInput(input.value.trim()), 200);
  });
  return input;
}

/** Cover image with a calm placeholder when there is no image or it fails to load. */
export function cover(url, { ratio = '16x9', iconName = 'image', alt = '' } = {}) {
  const el = h('div', { class: `media media-${ratio}` });
  const placeholder = () => mount(el, h('div', { class: 'cover-empty' }, ui.icon(iconName, 28)));
  if (url) {
    const img = h('img', { src: url, alt, loading: 'lazy' });
    img.addEventListener('error', placeholder);
    el.appendChild(img);
  } else {
    placeholder();
  }
  return el;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast('Copied.', 'good');
  } catch {
    ui.toast('Copy did not work here. Select the text and copy it by hand.', 'bad');
  }
}

/** A message thread (tickets and HR share this). items: [{author, body, created_at, status_to}] */
export function thread(items, { me, timeFn, statusFn }) {
  return h('ol', { class: 'thread' }, items.map((m) => h('li', { class: ['thread-item', m.author && me && m.author.id === me.id && 'is-mine'] },
    ui.avatar(m.author, 32),
    h('div', { class: 'thread-bubble' },
      h('div', { class: 'row row-between gap-2' },
        h('span', { class: 't-strong t-sm' }, m.author ? m.author.name : 'Someone'),
        h('span', { class: 't-xs t-faint' }, timeFn(m.created_at))),
      m.body ? h('p', { class: 'thread-body' }, m.body) : null,
      m.status_to ? h('div', { class: 'thread-status t-xs t-muted' }, 'Status changed to ', h('strong', null, statusFn(m.status_to))) : null))));
}

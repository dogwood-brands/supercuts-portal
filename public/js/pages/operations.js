// Operations: today's checklists for a salon, and the operations calendar.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { dateLong, dateTime } from '../core/format.js';
import { region, today, addDays, parseDate, isoDate, daysUntil } from './admin/kit.js';

const EVENT_KINDS = {
  payroll: ['Payroll', 'info'],
  meeting: ['Meeting', 'neutral'],
  promo: ['Promo', 'brand'],
  holiday: ['Holiday', 'good'],
  deadline: ['Deadline', 'bad'],
  inventory: ['Inventory', 'warn'],
  training: ['Training', 'info'],
};
const kindOf = (k) => EVENT_KINDS[k] || [k ? k[0].toUpperCase() + k.slice(1) : 'Event', 'neutral'];

/* ---------- checklists ---------- */

function checklistCard({ template, run }, { salonId, date, canSignOff, editable, onChange }) {
  const items = template.items || [];
  const done = new Set((run.done || []).map(String));
  let completed = run.completed_at ? { at: run.completed_at, by: run.completed_by } : null;
  let timer = null;
  let saving = false;
  let dirty = false;
  let painted = false;

  const pct0 = items.length ? (done.size / items.length) * 100 : 0;
  const bar = ui.progress(pct0, { tone: run.completed_at || pct0 === 100 ? 'good' : 'brand' });
  const count = h('span', { class: 't-num t-strong' });
  const saved = h('span', { class: 't-xs t-faint save-state' });
  const foot = h('div', { class: 'checklist-foot' });
  const card = ui.card({ class: 'checklist-card', title: h('div', { class: 'row gap-3 grow' }, h('h3', null, template.name), count), action: saved, flush: true });

  const paintHead = () => {
    const p = items.length ? (done.size / items.length) * 100 : 0;
    count.textContent = `${done.size} of ${items.length}`;
    bar.dataset.tone = completed || p === 100 ? 'good' : 'brand';
    bar.setAttribute('aria-valuenow', String(Math.round(p)));
    if (painted) bar.querySelector('.progress-bar').style.width = `${p}%`;
    painted = true;
    card.classList.toggle('is-complete', !!completed);
    mount(foot, completed
      ? h('div', { class: 'row gap-3 signoff' },
        h('span', { class: 'signoff-tick' }, ui.icon('check', 18)),
        h('div', null,
          h('div', { class: 't-strong t-sm' }, 'Signed off'),
          h('div', { class: 't-xs t-muted' }, `${completed.by ? completed.by.name : 'A manager'} · ${dateTime(completed.at)}`)))
      : done.size === items.length && items.length
        ? canSignOff
          ? ui.button('Sign off this checklist', { variant: 'brand', icon: 'check', onClick: () => save(true) })
          : h('p', { class: 't-sm t-muted' }, 'Every item is done. Your manager signs it off from here.')
        : h('p', { class: 't-sm t-muted' }, editable ? 'Tick each item as you go. It saves by itself.' : 'This day can no longer be changed.'));
  };

  async function save(complete = false) {
    clearTimeout(timer);
    if (saving) { dirty = true; return; }
    saving = true;
    saved.textContent = 'Saving';
    try {
      const res = await api.put(`/checklists/${template.id}/run`, { salon_id: salonId, date, done: [...done], complete });
      const r = res.run || {};
      completed = r.completed_at ? { at: r.completed_at, by: r.completed_by } : null;
      saved.textContent = 'Saved';
      if (complete && completed) ui.toast(`${template.name} signed off.`, 'good');
      paintHead();
      onChange();
    } catch (err) {
      saved.textContent = 'Not saved';
      ui.toast(err.message, 'bad');
    } finally {
      saving = false;
      paintHead();
      if (dirty) { dirty = false; save(); }
    }
  }

  const list = h('ul', { class: 'checklist-items' }, items.map((item) => {
    const id = String(item.id);
    const input = h('input', { type: 'checkbox', checked: done.has(id), disabled: !editable });
    input.addEventListener('change', () => {
      if (input.checked) done.add(id); else done.delete(id);
      if (completed) completed = null; // changing an item reopens the checklist until it is signed off again
      paintHead();
      saved.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(() => save(false), 600);
    });
    return h('li', null, h('label', { class: 'checkbox' }, input, h('span', null, item.label)));
  }));

  card.appendChild(h('div', { class: 'checklist-progress' }, bar));
  card.appendChild(list);
  card.appendChild(foot);
  paintHead();
  card.flush = () => { if (timer) { clearTimeout(timer); timer = null; save(false); } };
  return card;
}

function checklistsView(ctx, live) {
  const u = ctx.user;
  const canSignOff = u.role !== 'stylist';
  const host = h('div');
  const controls = h('div', { class: 'toolbar' });
  const state = { salonId: u.salon ? u.salon.id : null, date: today(), salons: [] };

  const summary = h('div');
  const load = region(host, async () => {
    if (!state.salonId) {
      const res = await api.get('/salons');
      state.salons = (res.items || []).filter((s) => s.in_scope !== false);
      if (!state.salons.length) return ui.empty({ icon: 'store', title: 'No salon to show', body: 'Checklists belong to a salon. Ask the home office to link your sign-in to one.' });
      state.salonId = state.salons[0].id;
      paintControls();
    }
    const res = await api.get('/checklists', { salon_id: state.salonId, date: state.date });
    const items = res.items || [];
    if (!items.length) return ui.empty({ icon: 'checklist', title: 'No checklists are set up', body: 'The home office can add opening, closing and weekly checklists in the admin console.' });
    const editable = state.date <= today() && state.date >= addDays(today(), -7);
    const paintSummary = () => {
      const total = live.cards.length;
      const signed = live.cards.filter((c) => c.classList.contains('is-complete')).length;
      mount(summary, h('p', { class: 't-sm t-muted' }, signed === total ? 'Everything is signed off for this day. Nice work.' : `${signed} of ${total} checklists signed off.`));
    };
    live.cards = items.map((it) => checklistCard(it, { salonId: state.salonId, date: state.date, canSignOff, editable, onChange: () => paintSummary() }));
    paintSummary();
    return h('div', { class: 'stack' }, summary, h('div', { class: 'grid checklist-grid' }, live.cards.map((c, i) => ui.reveal(c, i * 60))));
  });

  const dateLabel = h('span', { class: 't-strong date-label' });
  const next = ui.button('', { variant: 'secondary', icon: 'chevronRight', title: 'Next day', onClick: () => shift(1) });
  const prev = ui.button('', { variant: 'secondary', icon: 'chevronLeft', title: 'Previous day', onClick: () => shift(-1) });
  function shift(n) {
    live.cards.forEach((c) => c.flush && c.flush());
    state.date = addDays(state.date, n);
    paintControls();
    load();
  }
  function paintControls() {
    const d = daysUntil(state.date);
    dateLabel.textContent = d === 0 ? `Today, ${dateLong(state.date).replace(/, \d{4}$/, '')}` : d === -1 ? `Yesterday, ${dateLong(state.date).replace(/, \d{4}$/, '')}` : dateLong(state.date);
    next.disabled = state.date >= today();
    prev.disabled = state.date <= addDays(today(), -7);
    const picker = state.salons.length > 1
      ? h('select', { class: 'select', 'aria-label': 'Salon', onChange: (e) => { live.cards.forEach((c) => c.flush && c.flush()); state.salonId = Number(e.target.value); load(); } },
        state.salons.map((s) => h('option', { value: s.id, selected: s.id === state.salonId }, `${s.name} #${s.salon_number}`)))
      : null;
    mount(controls, [h('div', { class: 'row gap-2' }, prev, dateLabel, next), picker]);
  }
  paintControls();
  if (u.salon && u.scope && u.scope !== 'salon') {
    api.get('/salons').then((res) => { state.salons = (res.items || []).filter((s) => s.in_scope !== false); paintControls(); }).catch(() => {});
  }
  return h('div', null, controls, host);
}

/* ---------- calendar ---------- */

function monthGrid(monthStart, byDate, onPick, picked) {
  const first = parseDate(monthStart);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(h('span', { class: 'cal-cell is-blank' }));
  for (let d = 1; d <= days; d++) {
    const iso = isoDate(new Date(first.getFullYear(), first.getMonth(), d));
    const evs = byDate.get(iso) || [];
    cells.push(h('button', {
      class: ['cal-cell', iso === today() && 'is-today', evs.length && 'has-events', iso === picked && 'is-picked'], type: 'button',
      'aria-label': `${dateLong(iso)}${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'event' : 'events'}` : ''}`,
      onClick: () => onPick(iso),
    }, h('span', null, String(d)), evs.length ? h('span', { class: 'cal-dots' }, evs.slice(0, 3).map((e) => h('i', { dataset: { tone: kindOf(e.kind)[1] } }))) : null));
  }
  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', null, d))),
    h('div', { class: 'cal-grid' }, cells));
}

function calendarView() {
  const host = h('div');
  let month = `${today().slice(0, 7)}-01`;
  let picked = null;
  const load = region(host, async () => {
    const first = parseDate(month);
    const end = isoDate(new Date(first.getFullYear(), first.getMonth() + 2, 0));
    const res = await api.get('/events', { from: month, to: end });
    const events = (res.items || []).slice().sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const byDate = new Map();
    for (const e of events) {
      let d = e.starts_on;
      const last = e.ends_on && e.ends_on >= e.starts_on ? e.ends_on : e.starts_on;
      for (let n = 0; d <= last && n < 62; n++, d = addDays(d, 1)) {
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(e);
      }
    }
    const agendaHost = h('div');
    const gridHost = h('div');
    const paint = () => {
      const from = picked || (month.slice(0, 7) === today().slice(0, 7) ? today() : month);
      const list = picked ? (byDate.get(picked) || []) : events.filter((e) => (e.ends_on || e.starts_on) >= from);
      const groups = new Map();
      for (const e of list) {
        const key = picked || (e.starts_on < from ? from : e.starts_on);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      mount(agendaHost, groups.size ? h('div', { class: 'agenda' }, [...groups.entries()].map(([date, evs]) => {
        const d = parseDate(date);
        return h('div', { class: ['agenda-day', date === today() && 'is-today'] },
          h('div', { class: 'agenda-date' }, h('b', null, String(d.getDate())), h('span', null, d.toLocaleDateString('en-US', { month: 'short', weekday: 'short' }))),
          h('div', { class: 'agenda-events' }, evs.map((e) => {
            const [label, tone] = kindOf(e.kind);
            return h('div', { class: 'agenda-event' },
              h('div', { class: 'grow' },
                h('div', { class: 't-strong' }, e.title),
                e.ends_on && e.ends_on !== e.starts_on ? h('div', { class: 't-xs t-muted' }, `Through ${dateLong(e.ends_on).replace(/, \d{4}$/, '')}`) : null),
              ui.badge(label, tone));
          })));
      })) : ui.empty({ icon: 'calendar', title: picked ? 'Nothing on this day' : 'Nothing scheduled', body: picked ? 'Pick another day, or clear the day to see what is coming up.' : 'Dates for counts, promos, calls and payroll cut-offs will appear here.' }));
      mount(gridHost, monthGrid(month, byDate, (iso) => { picked = picked === iso ? null : iso; paint(); }, picked));
    };
    paint();
    const title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const go = (n) => { month = isoDate(new Date(first.getFullYear(), first.getMonth() + n, 1)); picked = null; load(); };
    return h('div', { class: 'layout-rail' },
      ui.card({ title: 'Coming up', flush: true }, h('div', { class: 'card-body' }, agendaHost)),
      h('aside', { class: 'rail' },
        ui.card({
          title: title,
          action: h('div', { class: 'row gap-1' },
            ui.button('', { variant: 'ghost', size: 'sm', icon: 'chevronLeft', title: 'Previous month', onClick: () => go(-1) }),
            ui.button('', { variant: 'ghost', size: 'sm', icon: 'chevronRight', title: 'Next month', onClick: () => go(1) })),
        }, gridHost,
        h('div', { class: 'cal-legend' }, Object.values(EVENT_KINDS).filter((v, i, a) => a.findIndex((x) => x[0] === v[0]) === i).map(([label, tone]) => h('span', null, h('i', { dataset: { tone } }), label))))));
  }, { count: 2 });
  return host;
}

/* ---------- page ---------- */

const live = { cards: [] };

export default {
  title: 'Operations',
  css: true,
  render(ctx) {
    const body = h('div');
    let tab = ctx.query.tab === 'calendar' ? 'calendar' : 'checklists';
    const paint = () => {
      live.cards.forEach((c) => c.flush && c.flush());
      live.cards = [];
      mount(body, tab === 'calendar' ? calendarView() : checklistsView(ctx, live));
    };
    paint();
    return h('div', null,
      ui.pageHeader({ eyebrow: 'Run the salon', title: 'Operations', sub: 'The same open, the same close, every day, in every salon. Plus the dates that matter this month.' }),
      ui.tabs([{ key: 'checklists', label: 'Checklists' }, { key: 'calendar', label: 'Calendar' }], tab, (k) => { tab = k; paint(); }),
      body);
  },
  teardown() {
    live.cards.forEach((c) => c.flush && c.flush());
    live.cards = [];
  },
};

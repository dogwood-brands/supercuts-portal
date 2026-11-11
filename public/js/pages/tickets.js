// Support tickets: something broken, missing or needed at a salon. IT, facilities, supplies, marketing.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { timeAgo, dateTime } from '../core/format.js';
import { region, statusBadge, statusLabel, isOpenStatus, STATUS_OPTIONS, backLink, thread } from './admin/kit.js';

const CATEGORIES = {
  it: { label: 'IT', icon: 'monitor', hint: 'Point of sale, check-in screen, printer, internet, phones' },
  facilities: { label: 'Facilities', icon: 'wrench', hint: 'Plumbing, lights, heating and air, doors, chairs, signs' },
  supplies: { label: 'Supplies', icon: 'box', hint: 'Back bar, retail stock, towels, capes, cleaning products' },
  marketing: { label: 'Marketing', icon: 'megaphone', hint: 'Posters, promo signs, local offers, online listing' },
};
const PRIORITIES = [
  { value: 'low', label: 'Low. Whenever you can' },
  { value: 'normal', label: 'Normal. This week' },
  { value: 'high', label: 'High. It is hurting the day' },
  { value: 'urgent', label: 'Urgent. We cannot serve guests' },
];
const PRIORITY_BADGE = { low: null, normal: null, high: ['High', 'warn'], urgent: ['Urgent', 'bad'] };
const cat = (k) => CATEGORIES[k] || { label: k || 'Other', icon: 'ticket' };

async function scopeSalons(user) {
  if (user.scope === 'salon' && user.salon) return [user.salon];
  try {
    const res = await api.get('/salons');
    const rows = (res.items || []).filter((s) => s.in_scope !== false);
    return rows.length ? rows : user.salon ? [user.salon] : [];
  } catch {
    return user.salon ? [user.salon] : [];
  }
}

async function newTicket(ctx, preset, onCreated) {
  const salons = await scopeSalons(ctx.user);
  if (!salons.length) {
    ui.toast('Tickets belong to a salon, and your sign-in is not linked to one.', 'bad');
    return;
  }
  const hint = h('div', { class: 'field-hint' });
  const category = ui.field({ label: 'What is it about?', name: 'category', type: 'select', value: CATEGORIES[preset] ? preset : 'it', options: Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: c.label })) });
  const paintHint = () => { hint.textContent = cat(category.input.value).hint || ''; };
  category.input.addEventListener('change', paintHint);
  category.appendChild(hint);
  paintHint();
  const m = ui.modal({
    title: 'New support ticket',
    body: ui.form({
      fields: [
        salons.length > 1 ? { label: 'Salon', name: 'salon_id', type: 'select', value: ctx.user.salon ? ctx.user.salon.id : salons[0].id, options: salons.map((s) => ({ value: s.id, label: `${s.name} #${s.salon_number}` })) } : null,
        category,
        { label: 'How urgent is it?', name: 'priority', type: 'select', value: 'normal', options: PRIORITIES },
        { label: 'Short summary', name: 'subject', required: true, maxLength: 140, placeholder: 'Receipt printer at the front desk will not print' },
        { label: 'Details', name: 'body', type: 'textarea', required: true, maxLength: 4000, rows: 5, hint: 'What happened, since when, and what you have already tried.' },
      ].filter(Boolean),
      submitLabel: 'Send ticket',
      onCancel: () => m.close(),
      onSubmit: async (v) => {
        if (v.subject.length < 4) throw new Error('Add a short summary so the right person can pick it up.');
        if (v.body.length < 10) throw new Error('Add a few details: what happened and what you have tried.');
        const res = await api.post('/tickets', { salon_id: Number(v.salon_id || salons[0].id), category: v.category, priority: v.priority, subject: v.subject, body: v.body });
        m.close();
        ui.toast('Ticket sent. You will get a notification when someone replies.', 'good');
        onCreated(res.ticket);
      },
    }),
  });
}

function listView(ctx) {
  const host = h('div');
  const tabsHost = h('div');
  let tab = 'open';
  let items = [];
  const view = () => {
    const shown = items.filter((t) => (tab === 'all' ? true : tab === 'open' ? isOpenStatus(t.status) : !isOpenStatus(t.status)));
    mount(tabsHost, ui.tabs([
      { key: 'open', label: 'Open', count: items.filter((t) => isOpenStatus(t.status)).length },
      { key: 'done', label: 'Resolved', count: items.filter((t) => !isOpenStatus(t.status)).length },
      { key: 'all', label: 'All' },
    ], tab, (k) => { tab = k; mount(host, view()); }));
    if (!shown.length) {
      return ui.empty(tab === 'open'
        ? { icon: 'check', title: 'No open tickets', body: 'Nothing is waiting. If something breaks or runs out, raise it here so it does not get lost.', action: ui.button('New ticket', { icon: 'plus', onClick: create }) }
        : { icon: 'ticket', title: 'Nothing here yet' });
    }
    const wide = ctx.user.scope !== 'salon';
    return ui.card({ flush: true }, h('div', { class: 'list ticket-list' }, shown.map((t) => {
      const c = cat(t.category);
      const pr = PRIORITY_BADGE[t.priority];
      return h('a', { href: `#/tickets/${t.id}` },
        h('span', { class: 'ticket-icon', dataset: { cat: t.category } }, ui.icon(c.icon, 18)),
        h('div', { class: 'grow' },
          h('div', { class: 't-strong t-clip' }, t.subject),
          h('div', { class: 't-xs t-muted t-clip' }, [c.label, wide && t.salon ? t.salon.name : null, t.author ? t.author.name : null, `Updated ${timeAgo(t.updated_at || t.created_at)}`].filter(Boolean).join(' · '))),
        pr && isOpenStatus(t.status) ? ui.badge(pr[0], pr[1]) : null,
        statusBadge(t.status));
    })));
  };
  const load = region(host, async () => {
    const res = await api.get('/tickets');
    items = res.items || [];
    return view();
  }, { skeleton: 'list' });
  function create(preset) {
    return newTicket(ctx, typeof preset === 'string' ? preset : null, (t) => { if (t && t.id) ctx.navigate(`/tickets/${t.id}`); else load(); });
  }
  if (ctx.query.new !== undefined) setTimeout(() => create(ctx.query.new), 50);
  return h('div', null,
    ui.pageHeader({
      eyebrow: 'Run the salon', title: 'Support tickets',
      sub: 'Something broken, missing or needed? Raise it once, here, and follow it until it is fixed.',
      actions: ui.button('New ticket', { icon: 'plus', onClick: () => create() }),
    }),
    tabsHost,
    host);
}

function detailView(ctx) {
  const host = h('div');
  const load = region(host, async () => {
    const data = await api.get(`/tickets/${encodeURIComponent(ctx.params.id)}`);
    return build(data);
  }, { count: 2 });

  function build({ ticket: t, events = [] }) {
    const c = cat(t.category);
    const pr = PRIORITY_BADGE[t.priority];
    const open = isOpenStatus(t.status);
    const text = h('textarea', { class: 'textarea', rows: 3, maxLength: 4000, placeholder: open ? 'Add an update or a reply' : 'Add a note to reopen the conversation', 'aria-label': 'Your update' });
    const status = t.can_work ? h('select', { class: 'select', 'aria-label': 'Set status' }, h('option', { value: '' }, 'Keep status'), STATUS_OPTIONS.filter((o) => o.value !== t.status).map((o) => h('option', { value: o.value }, `Set to ${o.label.toLowerCase()}`))) : null;
    const send = async (statusTo) => {
      const body = text.value.trim();
      const to = statusTo || (status && status.value) || undefined;
      if (!body && !to) { text.focus(); ui.toast('Write a short update first.', 'bad'); return; }
      try {
        const next = await api.post(`/tickets/${t.id}/events`, { body, ...(to ? { status_to: to } : {}) });
        mount(host, build(next));
        ui.toast(to ? `Ticket set to ${statusLabel(to).toLowerCase()}.` : 'Update added.', 'good');
      } catch (err) {
        ui.toast(err.message, 'bad');
      }
    };
    const all = [{ author: t.author, body: t.body, created_at: t.created_at }, ...events];
    return h('div', { class: 'stack-lg' },
      backLink('#/tickets', 'All tickets'),
      h('header', { class: 'row row-top gap-4 row-wrap' },
        h('span', { class: 'ticket-icon is-lg', dataset: { cat: t.category } }, ui.icon(c.icon, 24)),
        h('div', { class: 'grow' },
          h('div', { class: 't-eyebrow' }, `Ticket ${t.id} · ${c.label}`),
          h('h1', null, t.subject),
          h('div', { class: 'row gap-2 row-wrap', style: { marginTop: 'var(--s-3)' } }, statusBadge(t.status), pr ? ui.badge(`${pr[0]} priority`, pr[1]) : null))),
      h('div', { class: 'layout-rail' },
        h('div', { class: 'stack' },
          thread(all, { me: ctx.user, timeFn: dateTime, statusFn: statusLabel }),
          ui.card({ title: open ? 'Add an update' : 'This ticket is closed' },
            h('div', { class: 'col' },
              text,
              h('div', { class: 'row gap-2 row-wrap reply-actions' },
                status,
                h('span', { class: 'grow' }),
                t.can_close && open && !t.can_work ? ui.button('Mark as resolved', { variant: 'secondary', icon: 'check', onClick: () => send('resolved') }) : null,
                ui.button('Send', { icon: 'send', onClick: () => send() }))))),
        h('aside', { class: 'rail' },
          ui.card({ title: 'Details' },
            h('dl', { class: 'detail-meta' },
              h('dt', null, 'Salon'), h('dd', null, t.salon ? h('a', { class: 't-link', href: `#/salon/${t.salon.id}` }, `${t.salon.name} #${t.salon.salon_number}`) : 'Not set'),
              h('dt', null, 'Raised by'), h('dd', null, t.author ? t.author.name : 'Unknown'),
              h('dt', null, 'Opened'), h('dd', null, dateTime(t.created_at)),
              h('dt', null, 'Last update'), h('dd', null, timeAgo(t.updated_at || t.created_at)),
              h('dt', null, 'Working on it'), h('dd', null, t.assignee ? t.assignee.name : 'Not picked up yet'))))));
  }
  void load;
  return host;
}

export default {
  title: (ctx) => (ctx.params.id ? `Ticket ${ctx.params.id}` : 'Support tickets'),
  css: true,
  render(ctx) {
    return ctx.params.id ? detailView(ctx) : listView(ctx);
  },
};

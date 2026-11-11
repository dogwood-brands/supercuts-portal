// Ask HR: private questions between one person and HR. HR and home office admins get an inbox view.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { timeAgo, dateTime, whereLabel } from '../core/format.js';
import { region, statusBadge, statusLabel, isOpenStatus, STATUS_OPTIONS, backLink, thread } from './admin/kit.js';

const TOPICS = {
  pay: { label: 'Pay', icon: 'tag', hint: 'A missing or wrong paycheck, tips, commission, a pay stub.' },
  schedule: { label: 'Schedule', icon: 'calendar', hint: 'Hours, availability, a change your manager could not solve.' },
  benefits: { label: 'Benefits', icon: 'gift', hint: 'Enrolment, coverage, what you are eligible for.' },
  leave: { label: 'Leave', icon: 'clock', hint: 'Sick time, family or medical leave, time off.' },
  concern: { label: 'A concern', icon: 'shield', hint: 'Something that does not feel right at work. You can raise it here safely.' },
  other: { label: 'Something else', icon: 'comment', hint: 'Anything that does not fit the other topics.' },
};
const topic = (k) => TOPICS[k] || TOPICS.other;

function privacyCard(isHr) {
  return ui.card({ class: 'privacy-card' },
    h('div', { class: 'row row-top gap-3' },
      h('span', { class: 'privacy-icon' }, ui.icon('lock', 20)),
      h('div', { class: 'col gap-2' },
        h('h3', null, isHr ? 'These conversations are confidential' : 'This is private'),
        h('p', { class: 't-sm t-muted' }, isHr
          ? 'Only the person who wrote in, HR and home office admins can open an inquiry. Do not copy details into tickets, the feed or email.'
          : 'Only you, HR and home office admins can see what you write here. Your manager, your district leader and your team cannot.'),
        isHr ? null : h('p', { class: 't-sm t-muted' }, 'If you are in danger or need urgent help, call 911 first. For anything else, write to us and HR will reply here.'))));
}

function newInquiry(ctx, onCreated) {
  const hint = h('div', { class: 'field-hint' });
  const cat = ui.field({ label: 'Topic', name: 'category', type: 'select', value: 'pay', options: Object.entries(TOPICS).map(([value, t]) => ({ value, label: t.label })) });
  const paintHint = () => { hint.textContent = topic(cat.input.value).hint; };
  cat.input.addEventListener('change', paintHint);
  cat.appendChild(hint);
  paintHint();
  const m = ui.modal({
    title: 'Ask HR',
    body: h('div', { class: 'stack' },
      h('p', { class: 't-sm t-muted row gap-2' }, ui.icon('lock', 16), 'Private. Only you, HR and home office admins can read this.'),
      ui.form({
        fields: [
          cat,
          { label: 'Subject', name: 'subject', required: true, maxLength: 140, placeholder: 'My last paycheck looks short' },
          { label: 'Your message', name: 'body', type: 'textarea', required: true, maxLength: 6000, rows: 6, hint: 'Include dates and amounts if you have them. It helps HR answer the first time.' },
        ],
        submitLabel: 'Send to HR',
        onCancel: () => m.close(),
        onSubmit: async (v) => {
          if (v.subject.length < 3) throw new Error('Add a short subject.');
          if (v.body.length < 10) throw new Error('Tell HR a little more so they can help.');
          const res = await api.post('/hr/inquiries', v);
          m.close();
          ui.toast('Sent to HR. You will get a notification when they reply.', 'good');
          onCreated(res.inquiry);
        },
      })),
  });
}

function listView(ctx) {
  const isHr = ctx.can('hr.inbox');
  const host = h('div');
  const tabsHost = h('div');
  let tab = 'open';
  let items = [];
  const create = () => newInquiry(ctx, (q) => { if (q && q.id) ctx.navigate(`/hr/${q.id}`); else load(); });

  const view = () => {
    const mine = (q) => q.author && q.author.id === ctx.user.id;
    const filters = {
      open: (q) => isOpenStatus(q.status),
      unassigned: (q) => isOpenStatus(q.status) && !q.assignee,
      mine: (q) => isOpenStatus(q.status) && q.assignee && q.assignee.id === ctx.user.id,
      done: (q) => !isOpenStatus(q.status),
    };
    const tabs = isHr
      ? [{ key: 'open', label: 'Open', count: items.filter(filters.open).length }, { key: 'unassigned', label: 'Not picked up', count: items.filter(filters.unassigned).length },
        { key: 'mine', label: 'Assigned to me', count: items.filter(filters.mine).length }, { key: 'done', label: 'Resolved' }]
      : [{ key: 'open', label: 'Open', count: items.filter(filters.open).length }, { key: 'done', label: 'Resolved' }];
    mount(tabsHost, items.length ? ui.tabs(tabs, tab, (k) => { tab = k; mount(host, view()); }) : null);
    const shown = items.filter(filters[tab] || filters.open);
    if (!items.length) {
      return ui.empty(isHr
        ? { icon: 'check', title: 'The inbox is empty', body: 'New questions from the team will appear here.' }
        : { icon: 'lifebuoy', title: 'You have not asked HR anything yet', body: 'Questions about pay, your schedule, benefits or leave go straight to HR, privately.', action: ui.button('Ask HR a question', { icon: 'plus', onClick: create }) });
    }
    if (!shown.length) return ui.empty({ icon: 'check', title: 'Nothing in this view' });
    return ui.card({ flush: true }, h('div', { class: 'list ticket-list' }, shown.map((q) => {
      const t = topic(q.category);
      return h('a', { href: `#/hr/${q.id}` },
        h('span', { class: 'ticket-icon' }, ui.icon(t.icon, 18)),
        h('div', { class: 'grow' },
          h('div', { class: 't-strong t-clip' }, q.subject),
          h('div', { class: 't-xs t-muted t-clip' }, [
            t.label,
            isHr && !mine(q) && q.author ? `${q.author.name}${q.author.salon ? `, ${q.author.salon.name}` : ''}` : null,
            isHr ? (q.assignee ? `With ${q.assignee.name}` : 'Not picked up') : null,
            `Updated ${timeAgo(q.updated_at || q.created_at)}`,
          ].filter(Boolean).join(' · '))),
        statusBadge(q.status));
    })));
  };
  const load = region(host, async () => {
    const res = await api.get('/hr/inquiries');
    items = res.items || [];
    return view();
  }, { skeleton: 'list' });
  if (ctx.query.new !== undefined) setTimeout(create, 50);

  return h('div', null,
    ui.pageHeader({
      eyebrow: 'My job', title: isHr ? 'HR inbox' : 'Ask HR',
      sub: isHr ? 'Private questions from the team. Reply here so the whole conversation stays in one confidential place.' : 'A private line to HR for pay, schedule, benefits, leave or a concern.',
      actions: ui.button(isHr ? 'New inquiry' : 'Ask a question', { icon: 'plus', onClick: create }),
    }),
    h('div', { class: 'layout-rail' },
      h('div', null, tabsHost, host),
      h('aside', { class: 'rail stack' },
        privacyCard(isHr),
        isHr ? null : ui.card({ title: 'Before you write' },
          h('ul', { class: 'prose t-sm' },
            h('li', null, 'Schedule swaps and time off go to your salon manager first.'),
            h('li', null, 'Broken equipment or supplies belong in a support ticket.'),
            h('li', null, 'Policies and the handbook are under Brand standards.'))))));
}

function detailView(ctx) {
  const isHr = ctx.can('hr.inbox');
  const host = h('div');
  region(host, async () => build(await api.get(`/hr/inquiries/${encodeURIComponent(ctx.params.id)}`)), { count: 2 });

  function build({ inquiry: q, messages = [] }) {
    const t = topic(q.category);
    const open = isOpenStatus(q.status);
    const isAuthor = q.author && q.author.id === ctx.user.id;
    const text = h('textarea', { class: 'textarea', rows: 4, maxLength: 6000, placeholder: isHr && !isAuthor ? 'Write your reply' : 'Add to this conversation', 'aria-label': 'Your message' });
    const status = isHr ? h('select', { class: 'select', 'aria-label': 'Set status' }, h('option', { value: '' }, 'Keep status'), STATUS_OPTIONS.filter((o) => o.value !== q.status).map((o) => h('option', { value: o.value }, `Set to ${o.label.toLowerCase()}`))) : null;
    const send = async (statusTo) => {
      const body = text.value.trim();
      const to = statusTo || (status && status.value) || undefined;
      if (!body && !to) { text.focus(); ui.toast('Write a message first.', 'bad'); return; }
      try {
        const next = await api.post(`/hr/inquiries/${q.id}/messages`, { ...(body ? { body } : {}), ...(to ? { status_to: to } : {}) });
        mount(host, build(next));
        ui.toast(to ? `Inquiry set to ${statusLabel(to).toLowerCase()}.` : 'Message sent.', 'good');
        if (ctx.refreshUnread) ctx.refreshUnread();
      } catch (err) {
        ui.toast(err.message, 'bad');
      }
    };
    const closeIt = async () => {
      if (await ui.confirm({ title: 'Close this inquiry?', body: 'Close it once your question is answered. You can always start a new one.', confirmLabel: 'Close inquiry' })) send('closed');
    };
    const all = [{ author: q.author, body: q.body, created_at: q.created_at }, ...messages];
    return h('div', { class: 'stack-lg' },
      backLink('#/hr', isHr ? 'HR inbox' : 'All my questions'),
      h('header', { class: 'row row-top gap-4 row-wrap' },
        h('span', { class: 'ticket-icon is-lg' }, ui.icon(t.icon, 24)),
        h('div', { class: 'grow' },
          h('div', { class: 't-eyebrow row gap-2' }, ui.icon('lock', 12), `Private · ${t.label}`),
          h('h1', null, q.subject),
          h('div', { class: 'row gap-2 row-wrap', style: { marginTop: 'var(--s-3)' } }, statusBadge(q.status)))),
      h('div', { class: 'layout-rail' },
        h('div', { class: 'stack' },
          thread(all, { me: ctx.user, timeFn: dateTime, statusFn: statusLabel }),
          ui.card({ title: open ? 'Reply' : 'This inquiry is closed' },
            h('div', { class: 'col' },
              open ? null : h('p', { class: 't-sm t-muted' }, isHr ? 'Sending a message keeps it closed unless you also set a status.' : 'Need more help on this? Start a new question and mention this one.'),
              open || isHr ? text : null,
              h('div', { class: 'row gap-2 row-wrap reply-actions' },
                status,
                h('span', { class: 'grow' }),
                isAuthor && open && !isHr ? ui.button('My question is answered', { variant: 'secondary', icon: 'check', onClick: closeIt }) : null,
                open || isHr ? ui.button('Send', { icon: 'send', onClick: () => send() }) : ui.button('Ask a new question', { variant: 'secondary', onClick: () => ctx.navigate('/hr?new=1') }))))),
        h('aside', { class: 'rail stack' },
          ui.card({ title: 'Details' },
            h('dl', { class: 'detail-meta' },
              isHr && q.author ? [h('dt', null, 'From'), h('dd', null, h('a', { class: 't-link', href: `#/people/${q.author.id}` }, q.author.name), h('div', { class: 't-xs t-muted' }, whereLabel(q.author)))] : null,
              h('dt', null, 'Topic'), h('dd', null, t.label),
              h('dt', null, 'Sent'), h('dd', null, dateTime(q.created_at)),
              h('dt', null, 'With'), h('dd', null, q.assignee ? q.assignee.name : 'HR team, not picked up yet'))),
          privacyCard(isHr))));
  }
  return host;
}

export default {
  title: (ctx) => (ctx.can('hr.inbox') ? 'HR inbox' : 'Ask HR'),
  css: true,
  render(ctx) {
    return ctx.params.id ? detailView(ctx) : listView(ctx);
  },
};

// Ask HR (v1.1): a private line to HR. The message goes straight to the HR inbox; the portal keeps only who
// wrote in and when, shows a receipt the employee must acknowledge, and never replies or emails the employee.
// HR and admins see messages still waiting to reach the HR inbox, and the who / when log.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { dateTime, whereLabel } from '../core/format.js';
import { region, copyText } from './admin/kit.js';

const PRIVACY = 'Only you and HR can read this.';

function privacyCard(isHr) {
  return ui.card({ class: 'privacy-card' },
    h('div', { class: 'row row-top gap-3' },
      h('span', { class: 'privacy-icon' }, ui.icon('lock', 20)),
      h('div', { class: 'col gap-2' },
        h('h3', null, isHr ? 'Nothing is kept in the portal' : 'This is private'),
        h('p', { class: 't-sm t-muted' }, isHr
          ? 'The portal keeps only who wrote in and when. Messages go to the HR inbox and are then deleted here. Reply to the employee directly, through their main contact.'
          : `${PRIVACY} Your manager, your district leader and your team cannot.`),
        isHr ? null : h('p', { class: 't-sm t-muted' }, 'HR will reach out to you directly. If you are in danger or need urgent help, call 911 first.'))));
}

/** The receipt. It stays open until the employee presses Acknowledge, which is recorded. */
function receipt(submission) {
  const m = ui.modal({
    title: 'Your inquiry was received',
    size: 'sm',
    dismissable: false,
    body: h('div', { class: 'stack' },
      h('p', null, 'Thank you. Your message went to HR. A member of the HR team will reach out to you directly.'),
      h('p', { class: 't-sm t-muted' }, `Sent ${dateTime(submission.created_at)}. ${PRIVACY}`)),
    actions: [ui.button('Acknowledge', {
      icon: 'check',
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('is-busy');
        try {
          await api.post(`/hr/inquiries/${submission.id}/acknowledge`);
          m.close();
        } catch (err) {
          ui.toast(err.message, 'bad');
        } finally {
          btn.classList.remove('is-busy');
        }
      },
    })],
  });
}

function askForm() {
  const host = h('div');
  const build = () => ui.form({
    fields: [
      { label: 'Subject', name: 'subject', required: true, maxLength: 140 },
      { label: 'Message', name: 'body', type: 'textarea', required: true, maxLength: 6000, rows: 8, hint: 'Include all details as applicable.' },
    ],
    submitLabel: 'Send privately to HR',
    onSubmit: async (v) => {
      if (v.subject.trim().length < 3) throw new Error('Add a short subject.');
      if (v.body.trim().length < 10) throw new Error('Tell HR a little more so they can help.');
      const res = await api.post('/hr/inquiries', { subject: v.subject, body: v.body });
      mount(host, build()); // clear the form; nothing of it is kept on screen
      receipt(res.submission);
    },
  });
  mount(host, build());
  return ui.card({ title: 'Private inquiry to Human Resources' },
    h('div', { class: 'stack' },
      h('p', { class: 't-sm t-muted row gap-2' }, ui.icon('lock', 16), PRIVACY),
      h('p', { class: 't-sm t-muted' }, 'For questions about pay, schedules, benefits or leave.'),
      host));
}

function employeeView() {
  return h('div', null,
    ui.pageHeader({ eyebrow: 'My job', title: 'Ask HR privately', sub: 'A private line to HR for pay, schedules, benefits or leave. HR will reach out to you directly.' }),
    h('div', { class: 'layout-rail' },
      askForm(),
      h('aside', { class: 'rail stack' },
        privacyCard(false),
        ui.card({ title: 'Before you write' },
          h('ul', { class: 'prose t-sm' },
            h('li', null, 'Schedule swaps and time off go to your salon manager first.'),
            h('li', null, 'Broken equipment or supplies belong in a support ticket.'),
            h('li', null, 'Your pay plan is under My pay plan. Benefits and eligibility are in iSolved.'))))));
}

function hrView(ctx) {
  const host = h('div');
  const load = region(host, async () => {
    const r = await api.get('/hr/inquiries');
    const waiting = r.waiting || [];
    const items = r.items || [];
    const delivery = r.delivery || {};
    const moved = async (w) => {
      if (!(await ui.confirm({ title: 'Moved to the HR inbox?', body: `Confirm you copied this message into ${delivery.to || 'the HR inbox'}. It is then deleted from the portal and cannot be opened here again.`, confirmLabel: 'Delete from portal' }))) return;
      try { await api.post(`/hr/outbox/${w.id}/moved`); ui.toast('Deleted from the portal.', 'good'); load({ quiet: true }); } catch (err) { ui.toast(err.message, 'bad'); }
    };
    const waitingBlock = waiting.length
      ? h('div', { class: 'stack' },
        h('div', { class: 'callout' }, ui.icon('alert', 18), h('span', null, delivery.configured
          ? `${waiting.length} waiting to be emailed to ${delivery.to}. The portal retries every five minutes.`
          : `Automatic delivery to ${delivery.to} is not switched on yet. Copy each message into the HR inbox, then delete it here.`)),
        waiting.map((w) => ui.card({ title: w.subject, action: h('span', { class: 't-xs t-muted' }, dateTime(w.created_at)) },
          h('div', { class: 'stack' },
            h('div', { class: 't-sm' }, w.author ? h('a', { class: 't-link', href: `#/people/${w.author.id}` }, w.author.name) : 'Team member', w.author ? h('span', { class: 't-muted' }, ` · ${whereLabel(w.author)}`) : null),
            h('p', { class: 'prewrap' }, w.body),
            h('div', { class: 'row gap-2 row-wrap' },
              ui.button('Copy message', { variant: 'secondary', size: 'sm', icon: 'download', onClick: () => copyText(`Private HR inquiry from ${w.author?.name || 'a team member'}${w.author ? ` (${whereLabel(w.author)})` : ''}\nSent ${dateTime(w.created_at)}\n\nSubject: ${w.subject}\n\n${w.body}`) }),
              h('span', { class: 'grow' }),
              ui.button('Moved to HR inbox', { size: 'sm', icon: 'check', onClick: () => moved(w) }))))))
      : ui.empty({ icon: 'check', title: 'Nothing waiting', body: delivery.configured ? `New inquiries are emailed straight to ${delivery.to}.` : 'New inquiries will wait here until they are moved to the HR inbox.' });
    const log = ui.card({ title: 'Who wrote in', action: h('span', { class: 't-xs t-muted' }, 'Who and when only') , flush: true },
      ui.table({
        columns: [
          { key: 'who', label: 'Employee', render: (x) => (x.author ? ui.userChip(x.author, { size: 30, sub: whereLabel(x.author) }) : 'Former employee') },
          { key: 'sent', label: 'Sent', render: (x) => dateTime(x.created_at) },
          { key: 'ack', label: 'Acknowledged', render: (x) => (x.acknowledged_at ? ui.badge('Yes', 'good') : ui.badge('Not yet')) },
          { key: 'to', label: 'In HR inbox', render: (x) => (x.delivered_at ? `${x.delivery === 'email' ? 'Emailed' : 'Moved'} ${dateTime(x.delivered_at)}` : ui.badge('Waiting', 'warn')) },
        ],
        rows: items,
        empty: 'No inquiries yet.',
      }));
    return h('div', { class: 'stack-lg' }, waitingBlock, log);
  }, { skeleton: 'list' });
  return h('div', null,
    ui.pageHeader({ eyebrow: 'My job', title: 'HR inbox', sub: 'Private inquiries from the team. HR reviews each one and contacts the employee directly; urgent matters go to the HR lead.' }),
    h('div', { class: 'layout-rail' }, host, h('aside', { class: 'rail stack' }, privacyCard(true))));
}

export default {
  title: (ctx) => (ctx.can('hr.inbox') ? 'HR inbox' : 'Ask HR privately'),
  css: true,
  render(ctx) {
    return ctx.can('hr.inbox') ? hrView(ctx) : employeeView();
  },
};

// Admin overview: is the portal being used, and what is waiting on the home office.

import { h } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { num, pct } from '../../core/format.js';
import { region } from './kit.js';

export default function overview(ctx) {
  const host = h('div');
  region(host, async () => {
    const o = await api.get('/admin/overview');
    const users = o.users || {};
    const activePct = users.total ? (users.active_7d / users.total) * 100 : 0;
    const count = (label, value, hint, fmt = (n) => num(Math.round(n))) => {
      const s = ui.stat({ label, hint });
      ui.countUp(s.valueEl, value || 0, fmt);
      return ui.card({}, s);
    };
    const queue = (icon, label, value, href) => (value === null || value === undefined ? null : h('a', { href },
      h('span', { class: 'ticket-icon' }, ui.icon(icon, 18)),
      h('span', { class: 'grow t-strong' }, label),
      value ? ui.badge(String(value), 'brand') : ui.badge('Clear', 'good'),
      ui.icon('chevronRight', 16)));
    const salons = (o.adoption_by_salon || []).slice().sort((a, b) => a.active_pct - b.active_pct);
    const quiet = salons.filter((s) => s.users > 0).slice(0, 12);
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'grid grid-4' },
        count('People with a sign-in', users.total, `${num(users.never_logged_in || 0)} have never signed in`),
        count('Active this week', users.active_7d, `${pct(activePct, 0)} of the team`),
        count('Posts this week', o.posts_7d, `${num(o.shoutouts_7d || 0)} were shout-outs`),
        count('Checklists completed', o.checklist_completion_pct, 'Average across salons', (n) => pct(n, 0))),
      h('div', { class: 'grid grid-2' },
        ui.card({ title: 'Waiting on the home office', flush: true },
          h('div', { class: 'list' },
            queue('ticket', 'Open support tickets', o.open_tickets, '#/tickets'),
            queue('lifebuoy', 'Open HR inquiries', o.open_hr, '#/hr'),
            ctx.can('moderate') ? queue('flag', 'Reported posts', o.open_reports ?? 0, '#/admin/moderation') : null)),
        ui.card({ title: 'Sign-offs and adoption' },
          h('div', { class: 'row gap-6 row-wrap' },
            ui.ring(o.ack_completion_pct || 0, { size: 112, label: 'Policies signed', tone: (o.ack_completion_pct || 0) >= 80 ? 'good' : 'brand' }),
            ui.ring(activePct, { size: 112, label: 'Active this week', tone: activePct >= 60 ? 'good' : 'warn' }),
            h('p', { class: 't-sm t-muted grow', style: { minWidth: '180px' } }, 'Sign-offs count every active person against every document that needs one. Adoption counts people who signed in during the last seven days.')))),
      ui.card({ title: 'Salons that need a nudge', action: h('span', { class: 't-xs t-muted' }, 'Lowest share of the team signed in this week') },
        quiet.length ? ui.barChart({ rows: quiet.map((s) => ({ label: s.salon.name, value: s.active_pct, valueLabel: pct(s.active_pct, 0), tone: s.active_pct >= 60 ? 'good' : s.active_pct >= 30 ? '' : 'brand' })), max: 100 })
          : ui.empty({ icon: 'store', title: 'No salon data yet' })));
  }, { skeleton: 'stat' });
  return host;
}

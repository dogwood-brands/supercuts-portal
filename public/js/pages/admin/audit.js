// Admin: audit log. Who changed what, and when.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { dateTime } from '../../core/format.js';
import { region, searchBox } from './kit.js';

const VERBS = { created: 'Created', updated: 'Updated', deleted: 'Deleted', import: 'Imported', reset_password: 'Reset password', login: 'Signed in' };

function describe(action) {
  const [thing, verb] = String(action || '').split('.');
  const noun = (thing || '').replace(/_/g, ' ');
  const v = VERBS[verb] || (verb || '').replace(/_/g, ' ');
  return v ? `${v[0].toUpperCase()}${v.slice(1)} · ${noun}` : noun;
}

function metaText(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

export default function audit() {
  const host = h('div');
  let action = '';
  let rows = [];
  let cursor = null;
  const view = () => {
    if (!rows.length) return ui.empty({ icon: 'shield', title: action ? 'No entries match' : 'Nothing has been recorded yet', body: 'Changes to people, roles, content, goals, moderation and settings are written here automatically.' });
    const more = ui.button('Show older entries', { variant: 'secondary', onClick: async () => {
      try {
        const res = await api.get('/admin/audit', { cursor, action });
        rows = rows.concat(res.items || []);
        cursor = res.next_cursor || null;
        mount(host, view());
      } catch (err) {
        ui.toast(err.message, 'bad');
      }
    } });
    return h('div', { class: 'stack' },
      ui.card({ flush: true }, ui.table({
        columns: [
          { key: 'created_at', label: 'When', render: (r) => h('span', { class: 't-sm', style: { whiteSpace: 'nowrap' } }, dateTime(r.created_at)) },
          { key: 'actor', label: 'Who', render: (r) => (r.actor ? ui.userChip(r.actor, { size: 28, link: false, sub: '' }) : h('span', { class: 't-faint' }, 'System')) },
          { key: 'action', label: 'What', render: (r) => h('div', null, h('div', { class: 't-strong t-sm' }, describe(r.action)), h('div', { class: 't-xs t-muted' }, [r.target_id ? `#${r.target_id}` : null, metaText(r.meta)].filter(Boolean).join(' · '))) },
        ],
        rows,
      })),
      cursor ? h('div', { class: 't-center' }, more) : null);
  };
  const load = region(host, async () => {
    const res = await api.get('/admin/audit', { action });
    rows = res.items || [];
    cursor = res.next_cursor || null;
    return view();
  }, { skeleton: 'table' });
  return h('div', { class: 'stack' },
    h('h2', null, 'Audit log'),
    h('p', { class: 't-sm t-muted', style: { maxWidth: '64ch' } }, 'A permanent record of sensitive changes. It cannot be edited from the portal.'),
    h('div', { class: 'toolbar' }, searchBox('Filter by action, for example user or settings', (v) => { action = v; load(); })),
    host);
}

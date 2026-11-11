// Admin: moderation. Posts and comments that someone on the team reported.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { timeAgo, whereLabel } from '../../core/format.js';
import { region } from './kit.js';

export default function moderation() {
  const host = h('div');
  let status = 'open';
  const resolve = async (r, action) => {
    const remove = action === 'remove';
    if (!(await ui.confirm({
      title: remove ? 'Remove this from the feed?' : 'Dismiss this report?',
      body: remove ? 'It disappears for everyone straight away. The author is not told who reported it.' : 'The post stays up and the report is closed.',
      confirmLabel: remove ? 'Remove' : 'Dismiss', tone: remove ? 'danger' : null,
    }))) return;
    try {
      await api.post(`/admin/reports/${r.id}/resolve`, { action });
      ui.toast(remove ? 'Removed from the feed.' : 'Report dismissed.', 'good');
      load({ quiet: true });
    } catch (err) {
      ui.toast(err.message, 'bad');
    }
  };
  const load = region(host, async () => {
    const { items = [] } = await api.get('/admin/reports', { status });
    if (!items.length) {
      return ui.empty(status === 'open'
        ? { icon: 'check', title: 'Nothing has been reported', body: 'When someone flags a post or a comment it lands here for a second look.' }
        : { icon: 'flag', title: 'No resolved reports yet' });
    }
    return h('div', { class: 'stack' }, items.map((r) => {
      const item = r.post || r.comment;
      return ui.card({},
        h('div', { class: 'stack' },
          h('div', { class: 'row row-between gap-3 row-wrap' },
            h('div', { class: 'row gap-2 row-wrap' },
              ui.badge(r.comment ? 'Comment' : 'Post'),
              r.status === 'open' ? ui.badge('Needs a look', 'brand') : ui.badge('Resolved', 'good'),
              item && item.removed ? ui.badge('Removed', 'bad') : null),
            h('span', { class: 't-xs t-muted' }, `Reported ${timeAgo(r.created_at)}${r.reporter ? ` by ${r.reporter.name}` : ''}`)),
          h('div', { class: 'reported' },
            item ? [
              item.author ? ui.userChip(item.author, { size: 32, sub: `${whereLabel(item.author)} · ${timeAgo(item.created_at)}` }) : null,
              h('p', { class: 'thread-body' }, item.body),
            ] : h('p', { class: 't-muted t-sm' }, 'The original has since been deleted.')),
          h('div', null, h('div', { class: 't-eyebrow' }, 'Reason given'), h('p', { class: 't-sm' }, r.reason || 'No reason given')),
          r.status === 'open'
            ? h('div', { class: 'row gap-2 row-wrap' },
              h('span', { class: 'grow' }),
              ui.button('Dismiss report', { variant: 'secondary', onClick: () => resolve(r, 'dismiss') }),
              item && !item.removed ? ui.button('Remove from feed', { variant: 'danger', icon: 'trash', onClick: () => resolve(r, 'remove') }) : null)
            : r.resolved_by ? h('div', { class: 't-xs t-muted' }, `Handled by ${r.resolved_by.name}`) : null));
    }));
  });
  return h('div', null,
    h('h2', { style: { marginBottom: 'var(--s-4)' } }, 'Moderation'),
    ui.tabs([{ key: 'open', label: 'Needs a look' }, { key: 'resolved', label: 'Resolved' }], status, (k) => { status = k; load(); }),
    host);
}

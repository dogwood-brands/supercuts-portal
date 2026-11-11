// Notifications: everything addressed to you, newest first.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { timeAgo } from '../core/format.js';

const ICONS = {
  shoutout: 'star', comment: 'comment', reaction: 'heart', announcement: 'megaphone', ticket: 'ticket',
  hr: 'lifebuoy', ack: 'book', checklist: 'checklist', training: 'play', promo: 'tag', alert: 'alert',
};

export default {
  title: 'Notifications',
  css: true,
  async render(ctx) {
    const r = await api.get('/notifications');
    const items = r.items || [];
    const list = h('div', { class: 'card notif-list' });
    const markAll = ui.button('Mark all as read', {
      variant: 'secondary', icon: 'check',
      onClick: async () => {
        try {
          await api.post('/notifications/read', { all: true });
          items.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); });
          paint();
          ctx.refreshUnread();
        } catch (err) { ui.toast(err.message, 'bad'); }
      },
    });
    const sub = h('p', { class: 'page-header-sub' });

    function paint() {
      const unread = items.filter((n) => !n.read_at).length;
      sub.textContent = unread ? `${unread} unread` : 'You are all caught up.';
      markAll.hidden = !unread;
      if (!items.length) {
        mount(list, ui.empty({ icon: 'bell', title: 'Nothing yet', body: 'Shout-outs, comments, announcements and replies from HR will show up here.' }));
        return;
      }
      mount(list, items.map((n) => {
        const href = n.link ? `#${String(n.link).replace(/^#/, '')}` : null;
        const row = h(href ? 'a' : 'div', { class: ['notif', !n.read_at && 'is-unread'], href },
          h('span', { class: 'notif-icon' }, ui.icon(ICONS[n.kind] || 'bell', 18)),
          h('span', { class: 'grow notif-text' },
            h('span', { class: 'notif-title' }, n.title),
            n.body ? h('span', { class: 't-sm t-muted t-clamp-2' }, n.body) : null),
          h('span', { class: 't-xs t-muted notif-time' }, timeAgo(n.created_at)),
          !n.read_at ? h('span', { class: 'dot dot-bad', 'aria-label': 'Unread' }) : null);
        row.addEventListener('click', () => {
          if (n.read_at) return;
          n.read_at = new Date().toISOString();
          row.classList.remove('is-unread');
          api.post('/notifications/read', { ids: [n.id] }).then(() => ctx.refreshUnread()).catch(() => {});
          if (!href) paint();
        });
        return row;
      }));
    }
    paint();
    const header = ui.pageHeader({ eyebrow: 'Inbox', title: 'Notifications', actions: markAll });
    header.firstChild.appendChild(sub);
    return h('div', { class: 'notifs' }, header, list);
  },
};

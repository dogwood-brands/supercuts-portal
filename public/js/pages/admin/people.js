// Admin: people. Create sign-ins, change roles and salons, reset passwords, import a roster.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { roleLabel, timeAgo, num } from '../../core/format.js';
import { region, searchBox, copyText } from './kit.js';

const ROLES = ['stylist', 'salon_manager', 'district_leader', 'hr', 'executive', 'admin'];
const roleOptions = (me) => ROLES.filter((r) => me.role === 'admin' || (r !== 'admin' && r !== 'executive')).map((r) => ({ value: r, label: roleLabel(r) }));
const PAGE = 50;

/** Show a temporary password exactly once, with a copy button. */
function showTempPassword({ name, username, password, verb }) {
  const m = ui.modal({
    title: `${verb} ${name}`,
    size: 'sm',
    body: h('div', { class: 'stack' },
      h('p', { class: 't-sm t-muted' }, 'Give these to the person directly. The temporary password is shown only this once, and they will be asked to choose their own the first time they sign in.'),
      h('div', { class: 'secret' },
        h('div', null, h('div', { class: 't-xs t-muted' }, 'Username'), h('code', null, username)),
        h('div', null, h('div', { class: 't-xs t-muted' }, 'Temporary password'), h('code', null, password))),
      ui.button('Copy both', { variant: 'secondary', icon: 'download', block: true, onClick: () => copyText(`SC Portal sign-in\nUsername: ${username}\nTemporary password: ${password}`) })),
    actions: [ui.button('Done', { onClick: () => m.close() })],
  });
}

function userForm({ me, user, salons, districts, onSaved }) {
  const creating = !user;
  const salonOpts = [{ value: '', label: 'No salon' }, ...salons.map((s) => ({ value: s.id, label: `${s.name} #${s.salon_number}` }))];
  const districtOpts = [{ value: '', label: 'No district' }, ...districts.map((d) => ({ value: d.id, label: d.name }))];
  const fields = [
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'First name', name: 'first_name', required: true, maxLength: 60, value: user && user.first_name }),
      ui.field({ label: 'Last name', name: 'last_name', required: true, maxLength: 60, value: user && (user.last_name || (user.name || '').slice((user.first_name || '').length).trim()) })),
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Role', name: 'role', type: 'select', value: user ? user.role : 'stylist', options: roleOptions(me) }),
      ui.field({ label: 'Job title', name: 'title', maxLength: 80, value: user && user.title, placeholder: 'Stylist' })),
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Salon', name: 'salon_id', type: 'select', value: user && user.salon ? user.salon.id : '', options: salonOpts, hint: 'Needed for stylists and salon managers.' }),
      districts.length ? ui.field({ label: 'District', name: 'district_id', type: 'select', value: user ? user.district_id || '' : '', options: districtOpts, hint: 'For district leaders.' }) : null),
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Email', name: 'email', type: 'email', maxLength: 160, value: user && user.email, hint: 'Optional.' }),
      ui.field({ label: 'Phone', name: 'phone', type: 'tel', maxLength: 30, value: user && user.phone })),
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Username', name: 'username', maxLength: 40, value: user && user.username, hint: creating ? 'Leave blank to use first.last' : null }),
      ui.field({ label: 'Hire date', name: 'hire_date', type: 'date', value: user && user.hire_date })),
    creating ? null : ui.field({ label: 'Status', name: 'status', type: 'select', value: user.status, options: [{ value: 'active', label: 'Active. Can sign in' }, { value: 'inactive', label: 'Inactive. Cannot sign in' }] }),
  ].filter(Boolean);
  const m = ui.modal({
    title: creating ? 'Add a person' : `Edit ${user.name}`,
    size: 'lg',
    body: ui.form({
      fields,
      submitLabel: creating ? 'Create sign-in' : 'Save changes',
      onCancel: () => m.close(),
      onSubmit: async (v) => {
        if ((v.role === 'stylist' || v.role === 'salon_manager') && !v.salon_id) throw new Error('Choose a salon for stylists and salon managers.');
        const body = {
          first_name: v.first_name, last_name: v.last_name, role: v.role, title: v.title || null, email: v.email || null, phone: v.phone || null,
          salon_id: v.salon_id ? Number(v.salon_id) : null, hire_date: v.hire_date || null,
          ...(v.district_id !== undefined ? { district_id: v.district_id ? Number(v.district_id) : null } : {}),
          ...(v.username ? { username: v.username } : {}),
          ...(creating ? {} : { status: v.status }),
        };
        if (creating) {
          const res = await api.post('/admin/users', body);
          m.close();
          showTempPassword({ name: res.user.name, username: res.user.username, password: res.temp_password, verb: 'Sign-in created for' });
        } else {
          if (user.status === 'active' && v.status === 'inactive'
            && !(await ui.confirm({ title: `Turn off ${user.name}'s sign-in?`, body: 'They will be signed out and will not be able to sign in again until you make them active.', confirmLabel: 'Turn off sign-in', tone: 'danger' }))) return;
          await api.patch(`/admin/users/${user.id}`, body);
          m.close();
          ui.toast('Changes saved.', 'good');
        }
        onSaved();
      },
    }),
  });
}

function importDialog(onDone) {
  const text = h('textarea', { class: 'textarea mono', rows: 8, placeholder: 'first_name,last_name,role,salon_number,email,phone,hire_date\nJordan,Reyes,stylist,8495,,,2026-11-02', 'aria-label': 'Roster CSV' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'roster-file' });
  file.addEventListener('change', async () => {
    if (file.files[0]) text.value = await file.files[0].text();
  });
  const result = h('div');
  const run = async () => {
    const csv = text.value.trim();
    if (!csv) { ui.toast('Paste the roster or choose a file first.', 'bad'); return; }
    try {
      const res = await api.post('/admin/users/import', { csv });
      const created = res.created || [];
      const rejected = res.rejected || [];
      const lines = ['name,username,temporary_password', ...created.map((c) => `${c.name},${c.username},${c.temp_password}`)].join('\n');
      mount(result, h('div', { class: 'stack' },
        h('div', { class: 'row gap-2 row-wrap' }, ui.badge(`${created.length} created`, 'good'), rejected.length ? ui.badge(`${rejected.length} skipped`, 'bad') : null),
        created.length ? h('div', { class: 'stack' },
          h('p', { class: 't-sm t-muted' }, 'Temporary passwords are shown only now. Copy them before you close this window.'),
          ui.table({ columns: [{ key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'temp_password', label: 'Temporary password', render: (r) => h('code', null, r.temp_password) }], rows: created }),
          ui.button('Copy the list', { variant: 'secondary', icon: 'download', onClick: () => copyText(lines) })) : null,
        rejected.length ? h('div', { class: 'stack' },
          h('h4', null, 'Rows that were skipped'),
          ui.table({ columns: [{ key: 'line', label: 'Line', align: 'right' }, { key: 'reason', label: 'Why' }], rows: rejected })) : null));
      if (created.length) onDone();
    } catch (err) {
      mount(result, h('div', { class: 'field-error' }, err.message));
    }
  };
  ui.modal({
    title: 'Import a roster',
    size: 'lg',
    body: h('div', { class: 'stack' },
      h('p', { class: 't-sm t-muted' }, 'One person per line. Columns: first_name, last_name, role are required; salon_number, username, email, title, phone, hire_date are optional. Up to 300 people at a time.'),
      text,
      h('div', { class: 'row gap-2 row-wrap' },
        h('label', { class: 'btn btn-secondary', for: 'roster-file' }, ui.icon('upload', 18), 'Choose a CSV file'), file,
        h('span', { class: 'grow' }),
        ui.button('Import', { onClick: run })),
      result),
  });
}

export default function people(ctx) {
  const host = h('div');
  const f = { q: '', role: '', status: 'active', salon_id: '' };
  let salons = [];
  let districts = [];
  let shown = PAGE;
  let rows = [];
  let total = 0;

  const openEdit = (user) => userForm({ me: ctx.user, user, salons, districts, onSaved: () => load({ quiet: true }) });
  const reset = async (u) => {
    if (!(await ui.confirm({ title: `Reset ${u.name}'s password?`, body: 'Their current password stops working right away and they are signed out everywhere.', confirmLabel: 'Reset password' }))) return;
    try {
      const res = await api.post(`/admin/users/${u.id}/reset-password`);
      showTempPassword({ name: u.name, username: u.username, password: res.temp_password, verb: 'New password for' });
    } catch (err) {
      ui.toast(err.message, 'bad');
    }
  };

  const view = () => {
    if (!rows.length) return ui.empty({ icon: 'users', title: 'No one matches', body: 'Clear a filter, or add the person.', action: ui.button('Add a person', { icon: 'plus', onClick: () => openEdit(null) }) });
    return h('div', { class: 'stack' },
      h('div', { class: 't-sm t-muted' }, `${num(total || rows.length)} ${(total || rows.length) === 1 ? 'person' : 'people'}`),
      ui.card({ flush: true }, ui.table({
        columns: [
          { key: 'name', label: 'Person', render: (u) => ui.userChip(u, { size: 34, link: false, sub: `@${u.username}` }) },
          { key: 'role', label: 'Role', render: (u) => roleLabel(u.role) },
          { key: 'salon', label: 'Salon', render: (u) => (u.salon ? u.salon.name : h('span', { class: 't-faint' }, 'None')) },
          { key: 'last', label: 'Last sign-in', render: (u) => (u.last_login_at ? timeAgo(u.last_login_at) : h('span', { class: 't-faint' }, 'Never')) },
          { key: 'status', label: 'Status', render: (u) => (u.status === 'active' ? (u.must_change_password ? ui.badge('Temp password', 'warn') : ui.badge('Active', 'good')) : ui.badge('Inactive')) },
          { key: 'act', label: '', align: 'right', render: (u) => {
            const btn = ui.button('', { variant: 'ghost', size: 'sm', icon: 'more', title: `Actions for ${u.name}` });
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              ui.menu(btn, [
                { label: 'Edit', icon: 'edit', onClick: () => openEdit(u) },
                { label: 'Reset password', icon: 'lock', onClick: () => reset(u) },
                { label: 'View profile', icon: 'user', href: `#/people/${u.id}` },
              ]);
            });
            return btn;
          } },
        ],
        rows: rows.slice(0, shown),
        onRow: openEdit,
      })),
      rows.length > shown ? h('div', { class: 't-center' }, ui.button(`Show more (${rows.length - shown} left)`, { variant: 'secondary', onClick: () => { shown += PAGE; mount(host, view()); } })) : null);
  };

  let load = () => {};
  const select = (label, key, options) => h('select', { class: 'select', 'aria-label': label, onChange: (e) => { f[key] = e.target.value; load(); } },
    options.map((o) => h('option', { value: o.value, selected: o.value === f[key] }, o.label)));
  const salonSelect = select('Salon', 'salon_id', [{ value: '', label: 'All salons' }]);

  load = region(host, async () => {
    if (!salons.length) {
      const [s, d] = await Promise.all([
        api.get('/salons').catch(() => ({ items: [] })),
        ctx.can('admin.settings') ? api.get('/admin/districts').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);
      salons = s.items || [];
      districts = d.items || [];
      for (const x of salons) salonSelect.appendChild(h('option', { value: x.id }, `${x.name} #${x.salon_number}`));
    }
    const res = await api.get('/admin/users', f);
    rows = res.items || [];
    total = res.total || rows.length;
    shown = PAGE;
    return view();
  }, { skeleton: 'table' });

  return h('div', { class: 'stack' },
    h('div', { class: 'row row-between gap-3 row-wrap' },
      h('h2', null, 'People'),
      h('div', { class: 'row gap-2' },
        ui.button('Import roster', { variant: 'secondary', icon: 'upload', onClick: () => importDialog(() => load({ quiet: true })) }),
        ui.button('Add a person', { icon: 'plus', onClick: () => openEdit(null) }))),
    h('div', { class: 'toolbar' },
      searchBox('Search by name, username or email', (v) => { f.q = v; load(); }),
      select('Role', 'role', [{ value: '', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: roleLabel(r) }))]),
      salonSelect,
      select('Status', 'status', [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: '', label: 'Any status' }])),
    host);
}

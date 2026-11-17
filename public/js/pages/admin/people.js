// Admin: people. Create sign-ins, change roles and salons, reset passwords, import a roster.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { roleLabel, timeAgo, num } from '../../core/format.js';
import { region, searchBox, copyText } from './kit.js';

const ROLES = ['stylist', 'salon_manager', 'district_leader', 'hr', 'executive', 'admin'];
const FIELD = ['stylist', 'salon_manager'];
const roleOptions = (me) => ROLES
  .filter((r) => (me.role === 'district_leader' ? FIELD.includes(r) : me.role === 'admin' || (r !== 'admin' && r !== 'executive')))
  .map((r) => ({ value: r, label: roleLabel(r) }));
const PAY_PLANS = [{ value: '', label: 'Same as the salon\u2019s state' }, { value: 'CA', label: 'California' }, { value: 'NV', label: 'Nevada' }, { value: 'AZ', label: 'Arizona' }];
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
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Employee ID', name: 'employee_id', maxLength: 40, value: user && user.employee_id, hint: 'From iSolved. Lets a later upload update this person.' }),
      ui.field({ label: 'Pay plan', name: 'pay_plan', type: 'select', value: user ? user.pay_plan || '' : '', options: PAY_PLANS })),
    h('div', { class: 'grid grid-2' },
      ui.field({ label: 'Shift manager', name: 'shift_manager', type: 'select', value: user && user.shift_manager ? '1' : '0', options: [{ value: '0', label: 'No' }, { value: '1', label: 'Yes. Sees checklists and store alerts' }] }),
      me.role !== 'district_leader' ? ui.field({ label: 'Directory', name: 'directory_listed', type: 'select', value: user && user.directory_listed ? '1' : '0', options: [{ value: '0', label: 'Not in portfolio leadership' }, { value: '1', label: 'Listed under portfolio leadership' }] }) : null),
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
          employee_id: v.employee_id || null, pay_plan: v.pay_plan || null, shift_manager: v.shift_manager === '1',
          ...(v.directory_listed !== undefined ? { directory_listed: v.directory_listed === '1' } : {}),
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

/** Employee upload (v1.1): a CSV from iSolved or our template. Check first, then create sign-ins. */
function importDialog(ctx, onDone) {
  const text = h('textarea', { class: 'textarea mono', rows: 8, placeholder: 'first_name,last_name,salon_number,title,shift_manager,employee_id,hire_date\nJordan,Reyes,8495,Stylist,no,100234,2026-11-02', 'aria-label': 'Employee file (CSV)', spellcheck: false });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'roster-file' });
  const fileName = h('span', { class: 't-sm t-muted t-clip' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    text.value = await f.text();
    fileName.textContent = f.name;
  });
  const result = h('div');
  const csvCell = (x) => (/[",\n]/.test(String(x ?? '')) ? `"${String(x).replace(/"/g, '""')}"` : String(x ?? ''));
  const download = (name, rows) => {
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  const run = async (dryRun) => {
    const csv = text.value.trim();
    if (!csv) { ui.toast('Choose the file or paste it first.', 'bad'); return; }
    if (!dryRun && !(await ui.confirm({ title: 'Create these sign-ins?', body: 'New people get a username and a temporary password. People already in the portal with the same employee ID are updated instead.', confirmLabel: 'Upload' }))) return;
    mount(result, ui.skeleton('list', 3));
    try {
      const res = await api.post('/admin/users/import', { csv, dry_run: dryRun });
      const created = res.created || [];
      const updated = res.updated || [];
      const rejected = res.rejected || [];
      const stamp = new Date().toISOString().slice(0, 10);
      mount(result, h('div', { class: 'stack' },
        h('div', { class: 'row gap-2 row-wrap' },
          ui.badge(`${created.length} ${dryRun ? 'to create' : 'created'}`, 'good'),
          updated.length ? ui.badge(`${updated.length} ${dryRun ? 'to update' : 'updated'}`, 'info') : null,
          rejected.length ? ui.badge(`${rejected.length} skipped`, 'bad') : null),
        dryRun ? h('p', { class: 't-sm t-muted' }, 'Nothing has changed yet. Fix any skipped rows in the file, then press Upload.') : null,
        !dryRun && created.length ? h('div', { class: 'stack' },
          h('p', { class: 't-sm t-muted' }, 'Temporary passwords are shown only now. Download the list before you close this window, and hand each person their sign-in through their district leader. Everyone picks their own password the first time they sign in.'),
          ui.table({ columns: [{ key: 'name', label: 'Name' }, { key: 'salon_number', label: 'Salon' }, { key: 'username', label: 'Username' }, { key: 'temp_password', label: 'Temporary password', render: (r) => h('code', null, r.temp_password) }], rows: created }),
          h('div', { class: 'row gap-2 row-wrap' },
            ui.button('Download sign-ins (CSV)', { icon: 'download', onClick: () => download(`SC Portal sign-ins - ${stamp}.csv`, [['name', 'salon_number', 'username', 'temporary_password'], ...created.map((c) => [c.name, c.salon_number || '', c.username, c.temp_password])]) }),
            ui.button('Copy the list', { variant: 'secondary', onClick: () => copyText(['name,salon,username,temporary_password', ...created.map((c) => [c.name, c.salon_number || '', c.username, c.temp_password].map(csvCell).join(','))].join('\n')) }))) : null,
        dryRun && created.length ? ui.table({ columns: [{ key: 'name', label: 'New person' }, { key: 'salon_number', label: 'Salon' }, { key: 'username', label: 'Username they will get' }], rows: created.slice(0, 200) }) : null,
        updated.length ? h('details', null, h('summary', { class: 't-sm' }, `${updated.length} people already in the portal`),
          ui.table({ columns: [{ key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'changed', label: 'Changes', render: (r) => (r.changed.length ? r.changed.join(', ') : 'No change') }], rows: updated })) : null,
        rejected.length ? h('div', { class: 'stack' },
          h('h4', null, 'Rows that were skipped'),
          ui.table({ columns: [{ key: 'line', label: 'Line', align: 'right' }, { key: 'reason', label: 'Why' }], rows: rejected })) : null));
      if (!dryRun && (created.length || updated.length)) onDone();
    } catch (err) {
      mount(result, h('div', { class: 'field-error' }, err.message));
    }
  };
  const template = async () => {
    try {
      const res = await fetch('/api/admin/users/template', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not download the template.');
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: 'SC Portal - employee upload template.csv' });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (err) { ui.toast(err.message, 'bad'); }
  };
  ui.modal({
    title: 'Upload employees',
    size: 'lg',
    body: h('div', { class: 'stack' },
      h('p', { class: 't-sm t-muted' }, 'Upload the employee list as a CSV, either the iSolved employee export or our template. One person per row. First name, last name and salon number are needed; job title, shift manager (yes / no), employee ID, hire date, phone and email are optional. Up to 1,000 people at a time.'),
      h('ul', { class: 'prose t-sm' },
        h('li', null, 'Usernames are first initial plus last name, like jreyes, with a number added when two people share one.'),
        h('li', null, 'Everyone gets a temporary password and chooses their own at first sign-in. No email account is needed.'),
        h('li', null, 'With an employee ID, uploading again updates salon, title and shift manager instead of making a duplicate.'),
        ctx.user.role === 'district_leader' ? h('li', null, 'You can upload people for the salons in your district only.') : null),
      text,
      h('div', { class: 'row gap-2 row-wrap' },
        h('label', { class: 'btn btn-secondary', for: 'roster-file' }, ui.icon('upload', 18), 'Choose a CSV file'), file, fileName,
        ui.button('Download the template', { variant: 'ghost', icon: 'download', onClick: template }),
        h('span', { class: 'grow' }),
        ui.button('Check the file', { variant: 'secondary', onClick: () => run(true) }),
        ui.button('Upload', { icon: 'check', onClick: () => run(false) })),
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
          { key: 'role', label: 'Role', render: (u) => h('span', null, roleLabel(u.role), u.shift_manager ? h('span', { class: 't-xs t-muted' }, ' · shift manager') : null) },
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
      salons = (s.items || []).filter((x) => ctx.user.role !== 'district_leader' || x.in_scope);
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
        ui.button('Upload employees', { variant: 'secondary', icon: 'upload', onClick: () => importDialog(ctx, () => load({ quiet: true })) }),
        ui.button('Add a person', { icon: 'plus', onClick: () => openEdit(null) }))),
    h('div', { class: 'toolbar' },
      searchBox('Search by name, username or email', (v) => { f.q = v; load(); }),
      select('Role', 'role', [{ value: '', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: roleLabel(r) }))]),
      salonSelect,
      select('Status', 'status', [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: '', label: 'Any status' }])),
    host);
}

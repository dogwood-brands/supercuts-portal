// Account: your details, your password, and how to put the portal on your phone.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { roleLabel, whereLabel } from '../core/format.js';
import { pwa } from '../core/pwa.js';

let offPwa = null;

function profileCard(ctx) {
  const { user } = ctx;
  const avatarHost = h('div', { class: 'acct-avatar' }, ui.avatar(user, 88));
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const photoBtn = ui.button(user.avatar_url ? 'Change photo' : 'Add a photo', { variant: 'secondary', size: 'sm', icon: 'image', onClick: () => file.click() });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    photoBtn.classList.add('is-busy');
    try {
      const up = await api.upload(f);
      const r = await api.patch('/me', { avatar_url: up.url });
      Object.assign(user, r.user || { avatar_url: up.url });
      mount(avatarHost, ui.avatar(user, 88));
      ui.toast('Photo updated. It shows everywhere after your next page change.', 'good');
    } catch (err) {
      ui.toast(err.message, 'bad');
    } finally {
      photoBtn.classList.remove('is-busy');
    }
  });

  const row = (label, value) => h('div', { class: 'acct-row' }, h('dt', null, label), h('dd', null, value || '–'));
  const form = ui.form({
    fields: [
      { label: 'Mobile number', name: 'phone', type: 'tel', value: user.phone || '', autocomplete: 'tel', maxLength: 30, hint: 'Shown to your salon manager and leaders only.' },
      { label: 'About you', name: 'bio', type: 'textarea', value: user.bio || '', rows: 3, maxLength: 500, hint: 'A line or two for your profile. Specialities, years behind the chair, what you love about the job.' },
    ],
    submitLabel: 'Save details',
    onSubmit: async (v) => {
      const r = await api.patch('/me', { phone: v.phone, bio: v.bio });
      Object.assign(user, r.user || v);
      ui.toast('Details saved.', 'good');
    },
  });
  // bio is not part of the session user until saved once; load it from the profile
  if (user.bio === undefined) {
    api.get(`/people/${user.id}`).then((r) => {
      const bio = form.querySelector('[name=bio]');
      if (bio && !bio.value && r.person?.bio) bio.value = r.person.bio;
    }).catch(() => {});
  }

  return ui.card({ title: 'My details' },
    h('div', { class: 'acct-profile' },
      h('div', { class: 'acct-photo' }, avatarHost, photoBtn, file),
      h('dl', { class: 'acct-facts' },
        row('Name', user.name),
        row('Role', user.title || roleLabel(user.role)),
        row('Salon', user.salon ? `${user.salon.name}  #${user.salon.salon_number}` : whereLabel(user)),
        user.district ? row('District', user.district.name) : null,
        row('Email', user.email),
        h('p', { class: 't-xs t-muted' }, 'Name, role or salon wrong? Ask your manager or the home office to update it.'))),
    h('hr', { class: 'divider' }),
    form);
}

function passwordCard() {
  let formEl;
  const build = () => ui.form({
    fields: [
      { label: 'Current password', name: 'current', type: 'password', required: true, autocomplete: 'current-password' },
      { label: 'New password', name: 'next', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 10 characters. A short phrase works well.' },
      { label: 'New password again', name: 'again', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    submitLabel: 'Change password',
    onSubmit: async (v, el) => {
      if (v.next.length < 10) throw new Error('Use at least 10 characters.');
      if (v.next !== v.again) throw new Error('The two new passwords do not match.');
      if (v.next === v.current) throw new Error('Choose a password that is different from your current one.');
      await api.post('/auth/password', { current: v.current, next: v.next });
      el.reset();
      ui.toast('Password changed.', 'good');
    },
  });
  formEl = build();
  return ui.card({ title: 'Password' }, formEl);
}

function installCard() {
  const body = h('div');
  const steps = (items) => h('ol', { class: 'acct-steps' }, items.map((s, i) => h('li', null, h('span', { class: 'acct-step-n t-num' }, String(i + 1)), h('span', null, s))));
  const paint = () => {
    if (pwa.isStandalone()) {
      mount(body, h('div', { class: 'row gap-3' }, h('span', { class: 'acct-ok' }, ui.icon('check', 18)), h('div', null, h('div', { class: 't-strong' }, 'You are using the installed app'), h('div', { class: 't-sm t-muted' }, 'It updates itself. Nothing else to do.'))));
      return;
    }
    const ios = pwa.isIos();
    mount(body, [
      h('p', { class: 't-muted t-sm' }, 'Put SC Portal on your home screen so it opens full screen like any other app. No app store needed.'),
      pwa.canPrompt() ? ui.button('Install SC Portal', { variant: 'brand', icon: 'download', onClick: async () => { if (await pwa.install()) ui.toast('Installed. Look for SC Portal on your home screen.', 'good'); } }) : null,
      h('div', { class: 'acct-install' },
        h('div', { class: ios ? 'is-mine' : null },
          h('h4', null, 'iPhone or iPad'),
          steps(['Open this page in Safari.', 'Tap the Share button.', 'Choose "Add to Home Screen".', 'Tap Add.'])),
        h('div', { class: !ios ? 'is-mine' : null },
          h('h4', null, 'Android or computer'),
          steps(['Open this page in Chrome.', 'Open the menu (three dots).', 'Choose "Install app" or "Add to Home screen".', 'Confirm.']))),
    ]);
  };
  paint();
  offPwa = pwa.onChange(paint);
  return ui.card({ title: h('span', { class: 'row gap-2' }, ui.icon('phoneDevice', 18), h('h3', null, 'Get the app')) }, body);
}

export default {
  title: 'Account',
  css: true,
  async render(ctx) {
    return h('div', { class: 'account' },
      ui.pageHeader({ eyebrow: 'Account', title: 'Your account', sub: 'Keep your details current and your password private.' }),
      h('div', { class: 'acct-grid' },
        h('div', { class: 'stack' }, profileCard(ctx)),
        h('div', { class: 'stack' }, passwordCard(), installCard(),
          ui.card({ title: 'Signed in' },
            h('div', { class: 'row row-between row-wrap' },
              h('div', { class: 't-sm t-muted' }, 'On a shared salon computer? Sign out when you are done.'),
              ui.button('Sign out', {
                variant: 'secondary', icon: 'logout',
                onClick: async () => {
                  try { await api.post('/auth/logout'); } catch { /* reload either way */ }
                  location.hash = '#/';
                  location.reload();
                },
              }))))));
  },
  teardown() {
    offPwa?.();
    offPwa = null;
  },
};

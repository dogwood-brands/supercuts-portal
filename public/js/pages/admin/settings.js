// Admin: settings. Company name, the recognition values used in shout-outs, and the sample-data switch.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { region } from './kit.js';

const slug = (label) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40) || 'value';

export default function settings(ctx) {
  const host = h('div');
  const load = region(host, async () => {
    const { settings: s = {} } = await api.get('/admin/settings');
    const save = async (patch, message) => {
      const res = await api.put('/admin/settings', patch);
      Object.assign(s, res.settings || patch);
      if (ctx.settings) Object.assign(ctx.settings, patch);
      ui.toast(message, 'good');
    };

    // company name
    const company = ui.form({
      fields: [{ label: 'Company name', name: 'company_name', value: s.company_name || '', required: true, maxLength: 80, hint: 'Shown under the portal name in the sidebar and on the sign-in page.' }],
      submitLabel: 'Save name',
      onSubmit: async (v) => {
        if (!v.company_name) throw new Error('Enter a company name.');
        await save({ company_name: v.company_name }, 'Company name saved. It updates the next time each person opens the portal.');
      },
    });

    // recognition values
    let values = (Array.isArray(s.values) ? s.values : []).map((x) => ({ key: x.key, label: x.label }));
    const list = h('div', { class: 'col gap-2' });
    const paintValues = () => mount(list, values.length ? values.map((val, i) => {
      const input = h('input', { class: 'input', value: val.label, maxLength: 60, 'aria-label': `Value ${i + 1}`, onInput: (e) => { val.label = e.target.value; } });
      return h('div', { class: 'row gap-2' }, input,
        ui.button('', { variant: 'ghost', icon: 'trash', title: `Remove ${val.label || 'this value'}`, onClick: () => { values.splice(i, 1); paintValues(); } }));
    }) : h('p', { class: 't-sm t-muted' }, 'No values yet. Add the first one.'));
    paintValues();
    const saveValues = async () => {
      const clean = [];
      const seen = new Set();
      for (const val of values) {
        const label = (val.label || '').trim();
        if (!label) { ui.toast('Fill in or remove the empty value.', 'bad'); return; }
        let key = val.key || slug(label);
        while (seen.has(key)) key = `${key}_2`.slice(0, 40);
        seen.add(key);
        clean.push({ key, label });
      }
      try {
        await save({ values: clean }, 'Recognition values saved.');
        values = clean;
        paintValues();
      } catch (err) {
        ui.toast(err.message, 'bad');
      }
    };

    // sample data
    const sampleHost = h('div');
    const paintSample = () => {
      const on = !!s.sample_data;
      mount(sampleHost, h('div', { class: 'col gap-4' },
        h('div', { class: 'row gap-3 row-top' },
          h('span', { class: ['dot', on ? 'dot-warn' : 'dot-good'], style: { marginTop: '7px' } }),
          h('div', null,
            h('div', { class: 't-strong' }, on ? 'The portal is marked as a preview with sample data' : 'The portal is marked as live'),
            h('p', { class: 't-sm t-muted' }, on
              ? 'Everyone sees a small "Preview · sample data" marker in the top bar. Turn this off once real people and real sales figures are loaded.'
              : 'The preview marker is hidden. Turn it back on if you load sample figures for a demonstration.'))),
        h('div', null, ui.button(on ? 'Mark the portal as live' : 'Mark as preview again', { variant: on ? 'primary' : 'secondary', onClick: async () => {
          const ok = await ui.confirm(on
            ? { title: 'Mark the portal as live?', body: 'Only do this once the sample people, posts and sales figures have been replaced with real ones. This switch hides the preview marker for everyone. It does not delete any sample data.', confirmLabel: 'Mark as live' }
            : { title: 'Show the preview marker again?', body: 'Everyone will see "Preview · sample data" in the top bar.', confirmLabel: 'Show the marker' });
          if (!ok) return;
          try {
            await save({ sample_data: !on }, on ? 'The portal is now marked as live.' : 'Preview marker is back on.');
            paintSample();
          } catch (err) {
            ui.toast(err.message, 'bad');
          }
        } }))));
    };
    paintSample();

    return h('div', { class: 'stack-lg' },
      ui.card({ title: 'Company' }, company),
      ui.card({ title: 'Recognition values', action: h('span', { class: 't-xs t-muted' }, 'Up to 12') },
        h('div', { class: 'stack' },
          h('p', { class: 't-sm t-muted' }, 'The values people pick from when they give a shout-out. Keep them short and in your own words.'),
          list,
          h('div', { class: 'row gap-2 row-wrap' },
            ui.button('Add a value', { variant: 'secondary', icon: 'plus', disabled: values.length >= 12, onClick: () => { if (values.length < 12) { values.push({ key: '', label: '' }); paintValues(); const all = list.querySelectorAll('input'); all[all.length - 1].focus(); } } }),
            h('span', { class: 'grow' }),
            ui.button('Save values', { onClick: saveValues })))),
      ui.card({ title: 'Preview and sample data' }, sampleHost));
  });
  void load;
  return h('div', { class: 'stack' }, h('h2', null, 'Settings'), host);
}

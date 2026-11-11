// A small list-and-edit builder used by the admin Content and Salons sections.
// Each collection is described by a config: where it lives in the API, its table columns and its form fields.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { region, searchBox } from './kit.js';

/** A link field with an Upload button and a preview. */
function imageField(f, value) {
  const field = ui.field({ label: f.label, name: f.name, value: value || '', placeholder: '/media/example.webp', hint: f.hint || 'Upload a photo, or paste a link that starts with /media/ or /uploads/.' });
  const preview = h('div', { class: 'image-preview' });
  const paint = () => {
    const url = field.input.value.trim();
    mount(preview, url ? (() => { const img = h('img', { src: url, alt: '' }); img.addEventListener('error', () => mount(preview, null)); return img; })() : null);
  };
  field.input.addEventListener('change', paint);
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only' });
  const btn = ui.button('Upload', { variant: 'secondary', size: 'sm', icon: 'upload', onClick: () => file.click() });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    btn.classList.add('is-busy');
    try {
      const res = await api.upload(file.files[0]);
      field.input.value = res.url;
      paint();
    } catch (err) {
      ui.toast(err.message, 'bad');
    } finally {
      btn.classList.remove('is-busy');
      file.value = '';
    }
  });
  field.insertBefore(h('div', { class: 'row gap-2' }, h('div', { class: 'grow' }, field.input), btn, file), field.children[1] || null);
  field.appendChild(preview);
  paint();
  return field;
}

function checkField(f, value) {
  const input = h('input', { type: 'checkbox', name: f.name, checked: !!value });
  return h('label', { class: 'checkbox check-plain' }, input, h('span', null, f.label, f.hint ? h('span', { class: 'field-hint' }, f.hint) : null));
}

function buildField(f, row) {
  const value = row ? (f.get ? f.get(row) : row[f.name]) : f.default;
  if (f.type === 'image') return imageField(f, value);
  if (f.type === 'checkbox') return checkField(f, value);
  return ui.field({ ...f, value: value ?? '', options: typeof f.options === 'function' ? f.options() : f.options });
}

function toBody(fields, values) {
  const body = {};
  for (const f of fields.flat()) {
    let v = values[f.name];
    if (f.type === 'checkbox') v = !!v;
    else if (f.set) v = f.set(v);
    else if (f.type === 'number') v = v === '' ? null : Number(v);
    else if (f.type === 'select' && f.numeric) v = v === '' ? null : Number(v);
    else if (v === '') v = f.required ? '' : null;
    body[f.name] = v;
  }
  return body;
}

/**
 * config: {
 *   path: 'promos', noun: 'promo', plural: 'Promos', intro?,
 *   columns: [{key,label,render?,align?}], fields: [field | [field, field]] (a nested array renders side by side),
 *   canDelete?: bool, canCreate?: bool, search?: (row) => string, validate?: (body) => void (throw to stop),
 *   empty?: {title, body}
 * }
 */
export function crudSection(config) {
  const host = h('div');
  let rows = [];
  let q = '';
  const flat = config.fields.flat();

  const edit = (row) => {
    const creating = !row;
    if (creating && config.reset) config.reset();
    const nodes = config.fields.map((f) => (Array.isArray(f) ? h('div', { class: 'grid grid-2' }, f.map((x) => buildField(x, row))) : buildField(f, row)));
    const m = ui.modal({
      title: creating ? `New ${config.noun}` : `Edit ${config.noun}`,
      size: 'lg',
      body: ui.form({
        fields: nodes,
        submitLabel: creating ? `Create ${config.noun}` : 'Save changes',
        onCancel: () => m.close(),
        onSubmit: async (values) => {
          for (const f of flat) if (f.required && f.type !== 'checkbox' && !values[f.name]) throw new Error(`${f.label} is needed.`);
          const body = toBody(config.fields, values);
          if (config.validate) config.validate(body);
          if (creating) await api.post(`/admin/${config.path}`, body);
          else await api.patch(`/admin/${config.path}/${row.id}`, body);
          m.close();
          ui.toast(creating ? `${config.noun[0].toUpperCase()}${config.noun.slice(1)} created.` : 'Changes saved.', 'good');
          load({ quiet: true });
        },
      }),
      actions: !creating && config.canDelete ? [ui.button(`Delete this ${config.noun}`, { variant: 'ghost', icon: 'trash', onClick: async () => {
        if (!(await ui.confirm({ title: `Delete this ${config.noun}?`, body: 'It is removed for everyone straight away and cannot be brought back.', confirmLabel: 'Delete', tone: 'danger' }))) return;
        try {
          await api.del(`/admin/${config.path}/${row.id}`);
          m.close();
          ui.toast('Deleted.', 'good');
          load({ quiet: true });
        } catch (err) {
          ui.toast(err.message, 'bad');
        }
      } })] : null,
    });
  };

  const view = () => {
    const needle = q.toLowerCase();
    const shown = needle && config.search ? rows.filter((r) => config.search(r).toLowerCase().includes(needle)) : rows;
    if (!rows.length) {
      return ui.empty({ icon: 'plus', title: (config.empty && config.empty.title) || `No ${config.plural.toLowerCase()} yet`, body: config.empty && config.empty.body,
        action: config.canCreate === false ? null : ui.button(`New ${config.noun}`, { icon: 'plus', onClick: () => edit(null) }) });
    }
    if (!shown.length) return ui.empty({ icon: 'search', title: 'Nothing matches that search' });
    return ui.card({ flush: true }, ui.table({ columns: config.columns, rows: shown, onRow: edit }));
  };

  const load = region(host, async () => {
    if (config.before) await config.before();
    const res = await api.get(`/admin/${config.path}`);
    rows = res.items || [];
    return view();
  }, { skeleton: 'table' });

  return h('div', { class: 'stack' },
    h('div', { class: 'row row-between gap-3 row-wrap' },
      h('div', { class: 'grow' }, config.intro ? h('p', { class: 't-sm t-muted', style: { maxWidth: '60ch' } }, config.intro) : null),
      config.canCreate === false ? null : ui.button(`New ${config.noun}`, { icon: 'plus', onClick: () => edit(null) })),
    config.search ? h('div', { class: 'toolbar' }, searchBox(`Search ${config.plural.toLowerCase()}`, (v) => { q = v; mount(host, view()); })) : null,
    host);
}

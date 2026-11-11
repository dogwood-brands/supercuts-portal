// Admin: content. Promos, guides and policies, videos, calendar events and checklists.

import { h, mount } from '../../core/dom.js';
import { ui } from '../../core/ui.js';
import { dateShort } from '../../core/format.js';
import { crudSection } from './crud.js';
import { dateRange, daysUntil } from './kit.js';

const SECTION_OPTIONS = [
  { value: 'brand', label: 'Brand standards' }, { value: 'products', label: 'Products' }, { value: 'ops', label: 'Operations guides' },
  { value: 'policies', label: 'Policies' }, { value: 'hr', label: 'HR and handbook' },
];
const sectionLabel = (k) => (SECTION_OPTIONS.find((o) => o.value === k) || { label: k }).label;
const EVENT_KINDS = ['meeting', 'promo', 'payroll', 'inventory', 'training', 'deadline', 'holiday', 'general'].map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }));
const datesInOrder = (b) => { if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) throw new Error('The end date is before the start date.'); };

let itemIds = new Map();

const COLLECTIONS = {
  promos: () => crudSection({
    path: 'promos', noun: 'promo', plural: 'Promos', canDelete: true,
    intro: 'Offers shown on the Promos page. Set the dates and the portal moves each one between Running now, Coming up and Ended by itself.',
    search: (r) => `${r.title} ${r.tag || ''}`,
    validate: datesInOrder,
    columns: [
      { key: 'title', label: 'Promo', render: (r) => h('div', null, h('div', { class: 't-strong' }, r.title), h('div', { class: 't-xs t-muted' }, r.tag || '')) },
      { key: 'dates', label: 'Dates', render: (r) => dateRange(r.starts_on, r.ends_on) || 'No dates' },
      { key: 'state', label: 'Showing as', render: (r) => {
        if (r.status !== 'published') return ui.badge(r.status === 'draft' ? 'Draft' : 'Archived');
        const s = daysUntil(r.starts_on);
        const e = daysUntil(r.ends_on);
        return s !== null && s > 0 ? ui.badge('Coming up', 'info') : e !== null && e < 0 ? ui.badge('Ended') : ui.badge('Running now', 'good');
      } },
    ],
    fields: [
      { name: 'title', label: 'Title', required: true, maxLength: 140 },
      { name: 'summary', label: 'One-line summary', maxLength: 400, hint: 'Shown on the card. Say what the guest gets.' },
      [{ name: 'starts_on', label: 'Starts', type: 'date' }, { name: 'ends_on', label: 'Ends', type: 'date' }],
      [{ name: 'tag', label: 'Tag', maxLength: 40, placeholder: 'Haircut, Retail, Service' },
        { name: 'status', label: 'Status', type: 'select', default: 'published', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft. Hidden from the team' }, { value: 'archived', label: 'Archived' }] }],
      { name: 'image_url', label: 'Image', type: 'image' },
      { name: 'body', label: 'Details', type: 'textarea', rows: 10, maxLength: 20000, hint: 'Use "## Heading" for sections, "1." for steps and "-" for bullets. Cover what it is, how to ring it and what to say.' },
      { name: 'sort', label: 'Order', type: 'number', default: 0, hint: 'Lower numbers show first.' },
    ],
  }),
  resources: () => crudSection({
    path: 'resources', noun: 'guide', plural: 'Guides', canDelete: true,
    intro: 'Brand standards, product sheets, operations guides, policies and HR documents. Turn on sign-off for anything every person must read.',
    search: (r) => `${r.title} ${r.category || ''} ${sectionLabel(r.section)}`,
    columns: [
      { key: 'title', label: 'Guide', render: (r) => h('div', null, h('div', { class: 't-strong' }, r.title), h('div', { class: 't-xs t-muted' }, r.category || '')) },
      { key: 'section', label: 'Section', render: (r) => sectionLabel(r.section) },
      { key: 'ack', label: 'Sign-off', render: (r) => (r.requires_ack ? ui.badge('Needed', 'brand') : h('span', { class: 't-faint' }, 'No')) },
      { key: 'updated_at', label: 'Updated', render: (r) => (r.updated_at ? dateShort(r.updated_at) : '') },
    ],
    fields: [
      { name: 'title', label: 'Title', required: true, maxLength: 140 },
      [{ name: 'section', label: 'Section', type: 'select', default: 'brand', options: SECTION_OPTIONS }, { name: 'category', label: 'Topic', maxLength: 60, placeholder: 'Guest experience' }],
      { name: 'summary', label: 'One-line summary', maxLength: 400 },
      { name: 'image_url', label: 'Cover image', type: 'image' },
      { name: 'body_md', label: 'Text', type: 'textarea', rows: 12, maxLength: 60000, hint: 'Use "## Heading" for sections, "1." for steps and "-" for bullets.' },
      { name: 'file_url', label: 'Attached file link', maxLength: 500, hint: 'Optional. A link that starts with https://' },
      { name: 'requires_ack', label: 'Everyone must read and acknowledge this', type: 'checkbox' },
      { name: 'sort', label: 'Order', type: 'number', default: 0 },
    ],
  }),
  videos: () => crudSection({
    path: 'videos', noun: 'video', plural: 'Videos', canDelete: true,
    intro: 'Videos shown on SC Tube. Paste the link to the video file or to the lesson in Supercuts Academy.',
    search: (r) => `${r.title} ${r.channel}`,
    columns: [
      { key: 'title', label: 'Video', render: (r) => h('div', { class: 't-strong' }, r.title) },
      { key: 'channel', label: 'Channel' },
      { key: 'views', label: 'Views', align: 'right', render: (r) => String(r.views || 0) },
    ],
    fields: [
      { name: 'title', label: 'Title', required: true, maxLength: 140 },
      [{ name: 'channel', label: 'Channel', required: true, maxLength: 60, placeholder: 'Technique' }, { name: 'duration_s', label: 'Length in seconds', type: 'number', min: 0 }],
      { name: 'url', label: 'Video link', required: true, maxLength: 500, placeholder: 'https://academy.dogwoodbrands.com/...' },
      { name: 'poster_url', label: 'Poster image', type: 'image' },
      { name: 'description', label: 'Description', type: 'textarea', rows: 4, maxLength: 2000 },
      { name: 'sort', label: 'Order', type: 'number', default: 0 },
    ],
  }),
  events: () => crudSection({
    path: 'events', noun: 'event', plural: 'Events', canDelete: true,
    intro: 'Dates on the operations calendar: counts, promo starts, district calls, payroll cut-offs and training deadlines.',
    search: (r) => `${r.title} ${r.kind}`,
    validate: datesInOrder,
    columns: [
      { key: 'title', label: 'Event', render: (r) => h('div', { class: 't-strong' }, r.title) },
      { key: 'dates', label: 'Date', render: (r) => dateRange(r.starts_on, r.ends_on) },
      { key: 'kind', label: 'Type', render: (r) => ui.badge(r.kind || 'general') },
    ],
    fields: [
      { name: 'title', label: 'Title', required: true, maxLength: 140 },
      [{ name: 'starts_on', label: 'Date', type: 'date', required: true }, { name: 'ends_on', label: 'Last day', type: 'date', hint: 'Leave blank for a single day.' }],
      { name: 'kind', label: 'Type', type: 'select', default: 'meeting', options: EVENT_KINDS },
    ],
  }),
  'checklist-templates': () => crudSection({
    path: 'checklist-templates', noun: 'checklist', plural: 'Checklists', reset: () => { itemIds = new Map(); },
    intro: 'The checklists every salon works through. Turn one off to hide it without losing its history.',
    columns: [
      { key: 'name', label: 'Checklist', render: (r) => h('div', { class: 't-strong' }, r.name) },
      { key: 'items', label: 'Items', align: 'right', render: (r) => String((r.items || []).length) },
      { key: 'active', label: 'Status', render: (r) => (r.active ? ui.badge('In use', 'good') : ui.badge('Turned off')) },
    ],
    validate: (b) => { if (!b.items.length) throw new Error('Add at least one item.'); if (!/^[a-z][a-z0-9_-]*$/.test(b.key)) throw new Error('The short name uses lower-case letters, numbers and dashes only, for example "open".'); },
    fields: [
      [{ name: 'name', label: 'Name', required: true, maxLength: 80, placeholder: 'Opening checklist' }, { name: 'key', label: 'Short name', required: true, maxLength: 30, placeholder: 'open', hint: 'Lower-case, no spaces. Used behind the scenes.' }],
      { name: 'items', label: 'Items, one per line', type: 'textarea', rows: 12, required: true,
        get: (r) => { itemIds = new Map((r.items || []).map((i) => [i.label, i.id])); return (r.items || []).map((i) => i.label).join('\n'); },
        // An item keeps its id while its wording is unchanged, so ticks already made today still line up.
        set: (text) => {
          const used = new Set();
          const labels = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
          const kept = labels.map((label) => { const id = itemIds.get(label); if (id && !used.has(id)) { used.add(id); return { id, label }; } return { label }; });
          let n = 0;
          return kept.map((it) => { if (it.id) return it; do { n += 1; } while (used.has(`i${n}`)); used.add(`i${n}`); return { id: `i${n}`, label: it.label }; });
        } },
      { name: 'active', label: 'In use', type: 'checkbox', default: true },
    ],
  }),
};

const TABS = [
  { key: 'promos', label: 'Promos' }, { key: 'resources', label: 'Guides and policies' }, { key: 'videos', label: 'Videos' },
  { key: 'events', label: 'Calendar' }, { key: 'checklist-templates', label: 'Checklists' },
];

export default function content() {
  const body = h('div');
  let tab = 'promos';
  const paint = () => mount(body, COLLECTIONS[tab]());
  paint();
  return h('div', null,
    h('h2', { style: { marginBottom: 'var(--s-4)' } }, 'Content'),
    ui.tabs(TABS, tab, (k) => { tab = k; paint(); }),
    body);
}

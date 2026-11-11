// Admin: monthly goals per salon. Edit in the grid, then save once.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { money } from '../../core/format.js';
import { region, today, isoDate, parseDate } from './kit.js';

const monthLabel = (period) => parseDate(`${period}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shiftMonth = (period, n) => { const d = parseDate(`${period}-01`); return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1)).slice(0, 7); };
const parseNum = (text) => { const n = Number(String(text).replace(/[$,%\s]/g, '')); return String(text).trim() === '' ? null : n; };

let dirtyGuard = null;

export default function goals() {
  const host = h('div');
  const label = h('span', { class: 't-strong date-label' });
  let period = today().slice(0, 7);
  let dirty = false;
  const saveBtn = ui.button('Save goals', { icon: 'check', disabled: true, onClick: () => save() });
  const total = h('span', { class: 't-sm t-muted' });
  let inputs = [];

  dirtyGuard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', dirtyGuard);

  const markDirty = () => { dirty = true; saveBtn.disabled = false; paintTotal(); };
  const paintTotal = () => {
    const sum = inputs.reduce((a, r) => a + (parseNum(r.sales.value) || 0), 0);
    total.textContent = `Company goal for the month: ${money(Math.round(sum * 100))}`;
  };

  async function save() {
    const items = [];
    for (const r of inputs) {
      r.row.classList.remove('is-bad');
      const sales = parseNum(r.sales.value);
      const prod = parseNum(r.prod.value);
      const srph = parseNum(r.srph.value);
      if (sales === null && prod === null && srph === null) continue;
      const bad = sales === null || Number.isNaN(sales) || sales < 0 || (prod !== null && (Number.isNaN(prod) || prod < 0 || prod > 100)) || (srph !== null && (Number.isNaN(srph) || srph < 0));
      if (bad) {
        r.row.classList.add('is-bad');
        r.sales.focus();
        ui.toast(`Check the goals for ${r.name}. Sales goal is needed, product share is between 0 and 100.`, 'bad');
        return;
      }
      items.push({ salon_id: r.id, sales_goal_c: Math.round(sales * 100), product_pct_goal: prod, srph_goal_c: srph === null ? null : Math.round(srph * 100) });
    }
    if (!items.length) { ui.toast('Enter at least one goal first.', 'bad'); return; }
    try {
      await api.put('/admin/goals', { period, items });
      dirty = false;
      saveBtn.disabled = true;
      ui.toast(`Goals saved for ${monthLabel(period)}.`, 'good');
    } catch (err) {
      ui.toast(err.message, 'bad');
    }
  }

  const load = region(host, async () => {
    label.textContent = monthLabel(period);
    const res = await api.get('/admin/goals', { period });
    const rows = res.items || [];
    if (!rows.length) return ui.empty({ icon: 'target', title: 'No active salons', body: 'Add salons first, then set their goals here.' });
    const cell = (value, aria, extra = {}) => h('input', { class: 'input goal-input', inputMode: 'decimal', value: value ?? '', 'aria-label': aria, onInput: markDirty, ...extra });
    inputs = rows.map((r) => {
      const sales = cell(r.sales_goal_c === null || r.sales_goal_c === undefined ? '' : Math.round(r.sales_goal_c / 100), `Sales goal for ${r.salon_name}`);
      const prod = cell(r.product_pct_goal, `Product share goal for ${r.salon_name}`);
      const srph = cell(r.srph_goal_c === null || r.srph_goal_c === undefined ? '' : (r.srph_goal_c / 100).toFixed(2), `Service revenue per hour goal for ${r.salon_name}`);
      const row = h('tr', null,
        h('td', null, h('div', { class: 't-strong' }, r.salon_name), h('div', { class: 't-xs t-muted t-num' }, `#${r.salon_number}`)),
        h('td', { class: 'is-right' }, sales), h('td', { class: 'is-right' }, prod), h('td', { class: 'is-right' }, srph));
      return { id: r.salon_id, name: r.salon_name, sales, prod, srph, row };
    });
    dirty = false;
    saveBtn.disabled = true;
    paintTotal();
    return ui.card({ flush: true }, h('div', { class: 'table-wrap' }, h('table', { class: 'table goals-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Salon'), h('th', { scope: 'col', class: 'is-right' }, 'Sales goal ($)'), h('th', { scope: 'col', class: 'is-right' }, 'Product share (%)'), h('th', { scope: 'col', class: 'is-right' }, 'Service $ per hour'))),
      h('tbody', null, inputs.map((r) => r.row)))));
  }, { skeleton: 'table' });

  const go = async (n) => {
    if (dirty && !(await ui.confirm({ title: 'Leave without saving?', body: 'You have goal changes that are not saved yet.', confirmLabel: 'Leave', tone: 'danger' }))) return;
    period = shiftMonth(period, n);
    load();
  };
  const copyLast = async () => {
    try {
      const res = await api.get('/admin/goals', { period: shiftMonth(period, -1) });
      const prev = new Map((res.items || []).map((r) => [r.salon_id, r]));
      let n = 0;
      for (const r of inputs) {
        const p = prev.get(r.id);
        if (!p || p.sales_goal_c === null || p.sales_goal_c === undefined) continue;
        r.sales.value = Math.round(p.sales_goal_c / 100);
        r.prod.value = p.product_pct_goal ?? '';
        r.srph.value = p.srph_goal_c === null || p.srph_goal_c === undefined ? '' : (p.srph_goal_c / 100).toFixed(2);
        n += 1;
      }
      if (n) { markDirty(); ui.toast(`Copied ${n} salons from ${monthLabel(shiftMonth(period, -1))}. Review, then save.`); } else ui.toast('Last month has no goals to copy.', 'bad');
    } catch (err) {
      ui.toast(err.message, 'bad');
    }
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'row row-between gap-3 row-wrap' },
      h('h2', null, 'Goals'),
      h('div', { class: 'row gap-2 row-wrap' }, ui.button('Copy last month', { variant: 'secondary', onClick: copyLast }), saveBtn)),
    h('p', { class: 't-sm t-muted', style: { maxWidth: '64ch' } }, 'Monthly goals drive pace to goal, the scoreboard and the "check the boxes" tiles on every salon page. Type the numbers, then save once.'),
    h('div', { class: 'row row-between gap-3 row-wrap' },
      h('div', { class: 'row gap-2' },
        ui.button('', { variant: 'secondary', icon: 'chevronLeft', title: 'Previous month', onClick: () => go(-1) }), label,
        ui.button('', { variant: 'secondary', icon: 'chevronRight', title: 'Next month', onClick: () => go(1) })),
      total),
    host);
}

export function teardown() {
  if (dirtyGuard) window.removeEventListener('beforeunload', dirtyGuard);
  dirtyGuard = null;
}

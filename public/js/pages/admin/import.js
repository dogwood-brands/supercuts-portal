// Admin: import the daily sales file (the DSR ledger) into the portal's KPIs.

import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ui } from '../../core/ui.js';
import { num, dateShort } from '../../core/format.js';

const COLUMNS = 'date, store_id, center_name, region, daily_net_sales, daily_haircuts, daily_tickets, daily_clocked_hours, daily_service_rev, daily_product_rev, daily_supercut_plus';

export default function importSection(ctx) {
  const text = h('textarea', { class: 'textarea mono', rows: 10, placeholder: `${COLUMNS.replace(/, /g, ',')}\n2026-11-10,8495,MARINA DEL REY 8495,Cali,2412.00,48,52,31.5,2190.00,222.00,9`, 'aria-label': 'Daily sales CSV', spellcheck: false });
  const fileName = h('span', { class: 't-sm t-muted t-clip' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'dsr-file' });
  const result = h('div');
  const lines = h('span', { class: 't-xs t-muted' });
  const count = () => { const n = text.value.trim() ? text.value.trim().split('\n').length - 1 : 0; lines.textContent = n > 0 ? `${num(n)} rows ready` : ''; };
  text.addEventListener('input', count);
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { ui.toast('That file is larger than 8 MB. Split it by month and import each part.', 'bad'); return; }
    text.value = await f.text();
    fileName.textContent = f.name;
    count();
  });

  const run = async () => {
    const csv = text.value.trim();
    if (!csv) { ui.toast('Paste the file contents or choose a CSV first.', 'bad'); return; }
    const sample = ctx.settings && ctx.settings.sample_data;
    if (!(await ui.confirm({
      title: 'Import these sales figures?',
      body: `${sample ? 'The portal is still showing sample data. Importing adds real figures alongside it for the dates in this file. ' : ''}Days already in the portal are replaced by the figures in this file. This cannot be undone from here.`,
      confirmLabel: 'Import',
    }))) return;
    mount(result, ui.skeleton('list', 3));
    try {
      const r = await api.post('/admin/import/dsr', { csv });
      const rejected = r.rejected || [];
      const skipped = r.rejected_count ?? rejected.length;
      mount(result, ui.card({ title: 'Import report' },
        h('div', { class: 'stack' },
          h('div', { class: 'grid grid-4' },
            ui.stat({ label: 'Rows imported', value: num(r.rows || 0), tone: r.rows ? 'good' : null }),
            ui.stat({ label: 'Salons', value: num(r.salons || 0) }),
            ui.stat({ label: 'From', value: r.from ? dateShort(r.from) : 'None' }),
            ui.stat({ label: 'To', value: r.to ? dateShort(r.to) : 'None' })),
          skipped ? h('div', { class: 'stack' },
            h('div', { class: 'row gap-2' }, ui.badge(`${num(skipped)} rows skipped`, 'bad'), rejected.length < skipped ? h('span', { class: 't-xs t-muted' }, `Showing the first ${rejected.length}`) : null),
            ui.table({ columns: [{ key: 'line', label: 'Line', align: 'right', render: (x) => (x.line ?? '') }, { key: 'reason', label: 'Why it was skipped' }], rows: rejected }))
            : h('p', { class: 't-sm t-good row gap-2' }, ui.icon('check', 16), 'Every row was imported.'))));
      if (r.rows) ui.toast(`Imported ${num(r.rows)} rows.`, 'good');
    } catch (err) {
      mount(result, ui.errorState(err));
    }
  };

  return h('div', { class: 'stack' },
    h('h2', null, 'Data import'),
    h('p', { class: 't-sm t-muted', style: { maxWidth: '64ch' } }, 'Load daily sales into the portal from the DSR ledger file. Each row is one salon on one day. Rows for salons the portal does not know are skipped and listed in the report.'),
    ui.card({ title: 'Daily sales file (CSV)' },
      h('div', { class: 'stack' },
        h('p', { class: 't-xs t-muted' }, 'Columns, in any order: ', h('code', null, COLUMNS)),
        text,
        h('div', { class: 'row gap-3 row-wrap' },
          h('label', { class: 'btn btn-secondary', for: 'dsr-file' }, ui.icon('upload', 18), 'Choose a CSV file'), file, fileName,
          h('span', { class: 'grow' }), lines,
          ui.button('Import', { icon: 'check', onClick: run })))),
    result);
}

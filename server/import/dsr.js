'use strict';
// Imports the daily sales ledger (the data/dsr-dhr/daily.csv column format) into kpi_daily.
//   date, store_id, center_name, region, daily_net_sales, daily_haircuts, daily_tickets,
//   daily_clocked_hours, daily_service_rev, daily_product_rev, daily_supercut_plus
// store_id is matched to salons.salon_number. Rows are upserted, so re-importing a file is safe.
const { parseCsvObjects } = require('./csv');
const { isDate } = require('../util');

const REQUIRED = ['date', 'store_id', 'daily_net_sales', 'daily_haircuts', 'daily_tickets', 'daily_clocked_hours', 'daily_service_rev', 'daily_product_rev'];
const MAX_ROWS = 60000;
const MAX_REJECTS_LISTED = 50;

const cents = (s) => Math.round(Number(s) * 100);
const isNum = (s) => s !== '' && Number.isFinite(Number(s));

function importDsr(db, csvText, { source = 'dsr' } = {}) {
  const { header, records } = parseCsvObjects(csvText);
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    const err = new Error(`The file is missing these columns: ${missing.join(', ')}.`);
    err.userFacing = true;
    throw err;
  }
  if (records.length > MAX_ROWS) {
    const err = new Error(`That file has more than ${MAX_ROWS.toLocaleString('en-US')} rows. Split it and import in parts.`);
    err.userFacing = true;
    throw err;
  }
  const salons = new Map(db.prepare('SELECT id, salon_number FROM salons').all().map((s) => [String(s.salon_number), s.id]));
  const rejected = [];
  let rejectedCount = 0;
  const reject = (line, reason) => { rejectedCount += 1; if (rejected.length < MAX_REJECTS_LISTED) rejected.push({ line, reason }); };
  const unknownStores = new Map();
  const good = [];

  for (const r of records) {
    if (!isDate(r.date)) { reject(r._line, `"${r.date}" is not a date (use YYYY-MM-DD).`); continue; }
    const salonId = salons.get(String(r.store_id).trim());
    if (!salonId) { unknownStores.set(r.store_id, (unknownStores.get(r.store_id) || 0) + 1); rejectedCount += 1; continue; }
    const nums = ['daily_net_sales', 'daily_haircuts', 'daily_tickets', 'daily_clocked_hours', 'daily_service_rev', 'daily_product_rev'];
    const badCol = nums.find((c) => !isNum(r[c]));
    if (badCol) { reject(r._line, `${badCol} is not a number.`); continue; }
    const net = cents(r.daily_net_sales);
    if (Math.abs(net) > 5000000) { reject(r._line, 'Net sales for one day is outside the expected range.'); continue; }
    const guests = Math.round(Number(r.daily_tickets));
    const haircuts = Math.round(Number(r.daily_haircuts));
    const hours = Math.max(0, Number(r.daily_clocked_hours));
    if (guests < 0 || haircuts < 0 || hours > 500) { reject(r._line, 'Guest count, haircuts or hours is outside the expected range.'); continue; }
    good.push({
      salon_id: salonId, date: r.date, net_sales_c: net, service_c: cents(r.daily_service_rev), product_c: cents(r.daily_product_rev),
      guests, haircuts, hours: Math.round(hours * 100) / 100,
      supercut_plus: isNum(r.daily_supercut_plus ?? '') ? Math.max(0, Math.round(Number(r.daily_supercut_plus))) : 0,
    });
  }
  for (const [store, n] of unknownStores) {
    if (rejected.length < MAX_REJECTS_LISTED) rejected.push({ line: null, reason: `Store ${store} is not an active salon in the portal (${n} row${n === 1 ? '' : 's'} skipped).` });
  }

  const upsert = db.prepare(`INSERT INTO kpi_daily (salon_id, date, net_sales_c, service_c, product_c, guests, haircuts, hours, supercut_plus, source)
    VALUES (@salon_id, @date, @net_sales_c, @service_c, @product_c, @guests, @haircuts, @hours, @supercut_plus, @source)
    ON CONFLICT(salon_id, date) DO UPDATE SET net_sales_c = excluded.net_sales_c, service_c = excluded.service_c, product_c = excluded.product_c,
      guests = excluded.guests, haircuts = excluded.haircuts, hours = excluded.hours, supercut_plus = excluded.supercut_plus, source = excluded.source`);
  db.transaction(() => { for (const g of good) upsert.run({ ...g, source }); })();

  const dates = good.map((g) => g.date).sort();
  return {
    rows: good.length,
    salons: new Set(good.map((g) => g.salon_id)).size,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    rejected,
    rejected_count: rejectedCount,
  };
}

module.exports = { importDsr };

// CLI: node server/import/dsr.js <file.csv>   (imports into the live database: real figures. Read ops/RUNBOOK.md first.)
if (require.main === module) {
  const fs = require('node:fs');
  const file = process.argv[2];
  if (!file) { console.error('Usage: node server/import/dsr.js <daily.csv>'); process.exit(1); }
  const { openDb } = require('../db');
  const db = openDb();
  try {
    const out = importDsr(db, fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(out, null, 2));
  } catch (e) { console.error(e.userFacing ? e.message : e); process.exitCode = 1; }
  db.close();
}

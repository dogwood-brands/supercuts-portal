'use strict';
// Manual per-stylist upload (Nov 30 go-live, plan 3.3): one CSV row per person per day, matched to
// portal users by employee_id. Money columns are dollars, as in the reports. Rows are upserted on
// (user_id, date) and marked source 'manual', so the nightly sales load (which clears only sample
// rows) never wipes them.   node server/import/stylist-daily.js <file.csv>
const { parseCsvObjects } = require('./csv');
const { isDate } = require('../util');
const { isoDate } = require('./roster');

const ALIASES = {
  employee_id: ['employee_id', 'employee id', 'employee number', 'employee #', 'emp id', 'emp #', 'file number'],
  date: ['date', 'day', 'work date'],
  service: ['service', 'service_c', 'service dollars', 'service $', 'service revenue'],
  product: ['product', 'product_c', 'product dollars', 'product $', 'product revenue'],
  guests: ['guests', 'guest count', 'guest', 'guests served', 'tickets'],
  hours: ['hours', 'clocked hours', 'hrs'],
};
const REQUIRED = ['employee_id', 'date'];
const MAX_ROWS = 60000;
const MAX_REJECTS_LISTED = 50;
const MAX_DAILY_CENTS = 1000000; // $10,000 per person per day is far past any real figure

const clean = (x) => (x === undefined || x === null ? '' : String(x).trim());
const isNum = (s) => s !== '' && Number.isFinite(Number(s));
const cents = (s) => Math.round(Number(s) * 100);

function importStylistDaily(db, csvText, { dryRun = false } = {}) {
  const { header, records } = parseCsvObjects(csvText);
  // Match headers loosely ("Employee ID", "employee_id"): lowercase, and fold _c suffixes.
  const norm = (h) => h.toLowerCase().replace(/\s+/g, ' ').trim();
  const colFor = {};
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) colFor[norm(a)] = canonical;
  }
  const mapped = header.map((h) => colFor[norm(h)] || null);
  const missing = REQUIRED.filter((c) => !mapped.includes(c));
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
  if (!records.length) {
    const err = new Error('The file has no rows under the header.');
    err.userFacing = true;
    throw err;
  }

  const read = (raw, canonical) => {
    const i = mapped.indexOf(canonical);
    return i === -1 ? '' : clean(raw[header[i]]);
  };
  const users = new Map(db.prepare("SELECT id, employee_id, first_name, last_name FROM users WHERE employee_id IS NOT NULL AND status != 'deleted'")
    .all().map((u) => [String(u.employee_id), u]));
  const rejected = [];
  let rejectedCount = 0;
  const reject = (line, reason) => { rejectedCount += 1; if (rejected.length < MAX_REJECTS_LISTED) rejected.push({ line, reason }); };
  const good = [];
  const seen = new Set();

  for (const raw of records) {
    const line = raw._line;
    const emp = read(raw, 'employee_id');
    const user = users.get(emp);
    if (!user) { reject(line, `Employee ID "${emp}" matches nobody in the portal. Check the ID or upload the roster first.`); continue; }
    const iso = isoDate(read(raw, 'date'));
    if (!iso || !isDate(iso)) { reject(line, `"${read(raw, 'date')}" is not a date (use YYYY-MM-DD).`); continue; }
    const key = `${emp} ${iso}`;
    if (seen.has(key)) { reject(line, `${user.first_name} ${user.last_name} (${emp}) appears twice for ${iso}; keep one row per person per day.`); continue; }
    seen.add(key);
    const money = ['service', 'product'].map((c) => read(raw, c));
    if (money.some((m) => m !== '' && !isNum(m))) { reject(line, 'Service and product must be dollar amounts.'); continue; }
    const serviceC = cents(money[0] || 0);
    const productC = cents(money[1] || 0);
    if (serviceC < 0 || productC < 0 || serviceC > MAX_DAILY_CENTS || productC > MAX_DAILY_CENTS) { reject(line, 'Service or product is negative or outside the expected range.'); continue; }
    const guests = moneySafeInt(read(raw, 'guests') || 0);
    if (guests === null || guests < 0) { reject(line, 'Guests must be a whole number of zero or more.'); continue; }
    const hoursRaw = read(raw, 'hours') || 0;
    if (!isNum(String(hoursRaw)) || Number(hoursRaw) < 0 || Number(hoursRaw) > 500) { reject(line, 'Hours must be a number between 0 and 500.'); continue; }
    good.push({
      user_id: user.id, employee_id: emp, name: `${user.first_name} ${user.last_name}`, date: iso,
      service_c: serviceC, product_c: productC, guests, hours: Math.round(Number(hoursRaw) * 100) / 100,
    });
  }

  function moneySafeInt(s) {
    if (!/^-?\d+$/.test(String(s).trim())) return null;
    return Math.round(Number(s));
  }

  const upsert = db.prepare(`INSERT INTO stylist_daily (user_id, date, service_c, product_c, guests, hours, source)
    VALUES (@user_id, @date, @service_c, @product_c, @guests, @hours, 'manual')
    ON CONFLICT(user_id, date) DO UPDATE SET service_c = excluded.service_c, product_c = excluded.product_c,
      guests = excluded.guests, hours = excluded.hours, source = 'manual'`);
  if (!dryRun) db.transaction(() => { for (const g of good) upsert.run(g); })();

  const dates = good.map((g) => g.date).sort();
  return {
    dry_run: dryRun,
    rows: good.length,
    people: good.map(({ user_id, employee_id, name, date, service_c, product_c, guests, hours }) =>
      ({ user_id, employee_id, name, date, service_c, product_c, guests, hours })),
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    rejected,
    rejected_count: rejectedCount,
  };
}

const STYLIST_TEMPLATE = [
  'employee_id,date,service,product,guests,hours',
  '910001,2026-11-19,450.00,25.50,8,6.5',
  '910002,2026-11-19,300,0,5,4.25',
  '',
].join('\n');

module.exports = { importStylistDaily, STYLIST_TEMPLATE };

// CLI: node server/import/stylist-daily.js <file.csv>   (imports into the live database: real figures. Read ops/RUNBOOK.md first.)
if (require.main === module) {
  const fs = require('node:fs');
  const file = process.argv[2];
  if (!file) { console.error('Usage: node server/import/stylist-daily.js <file.csv>'); process.exit(1); }
  const { openDb } = require('../db');
  const db = openDb();
  try {
    const out = importStylistDaily(db, fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(out, null, 2));
  } catch (e) { console.error(e.userFacing ? e.message : e); process.exitCode = 1; }
  db.close();
}

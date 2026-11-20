'use strict';
// The report pipeline (Nov 30 go-live, plan 3.4): raw DSR/DHR workbooks -> daily ledger -> portal.
// The Python scripts run exactly as the office machine will run them (via env-configured paths),
// and the ledger loads through the real load-sales CLI into a throwaway database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { openDb } = require('../server/db');
const { migrate } = require('../server/migrate');
const { seedOrg } = require('../server/seed/org');

const ROOT = path.join(__dirname, '..');
const PY = process.env.SCP_TEST_PYTHON || 'python3';

function havePython() {
  const r = spawnSync(PY, ['-c', 'import openpyxl'], { encoding: 'utf8' });
  return r.status === 0;
}
const SKIP = !havePython();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-pipeline-'));
const RAW = path.join(dir, 'raw');
const OUT = path.join(dir, 'out');
const ENV = { ...process.env, SCP_PIPELINE_RAW_DIR: RAW, SCP_PIPELINE_OUT_DIR: OUT, SCP_TARGETS_FILE: path.join(OUT, 'dsr-targets.csv') };

before(() => {
  const r = spawnSync(PY, [path.join(__dirname, 'fixtures', 'make-report-fixtures.py'), RAW], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture generation failed: ${r.stderr}`);
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const csv = (p) => fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));

test('the parser turns the raw workbooks into snapshots, daily hours and the daily ledger', { skip: SKIP }, () => {
  const r = spawnSync(PY, [path.join(ROOT, 'pipeline', 'dsr-dhr-parse.py')], { env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `parse failed: ${r.stderr}`);

  // Two stores x two DSR days; the day-1 snapshot is the baseline only.
  const snaps = csv(path.join(OUT, 'snapshots.csv'));
  assert.equal(snaps.length, 5, 'header + 4 snapshot rows');

  // daily = MTD(day2) - MTD(day1), attributed to the day before the later report.
  const daily = csv(path.join(OUT, 'daily.csv'));
  const header = daily[0];
  const row = (store) => daily.find((r) => r[header.indexOf('store_id')] === store);
  const get = (r, col) => r[header.indexOf(col)];
  const one = row('80123');
  assert.equal(get(one, 'date'), '2026-11-20', 'DSR dated 11-21 reports through 11-20');
  assert.equal(Number(get(one, 'daily_net_sales')), 1500);
  assert.equal(Number(get(one, 'daily_haircuts')), 10);
  assert.equal(Number(get(one, 'daily_tickets')), 10);
  assert.equal(Number(get(one, 'daily_clocked_hours')), 30);
  assert.equal(Number(get(one, 'daily_service_rev')), 1000);
  assert.equal(Number(get(one, 'daily_product_rev')), 100);
  assert.equal(Number(get(one, 'daily_supercut_plus')), 5);
  // Blank Net Sales MTD is reconstructed from service + product before differencing: 2400 - 1200.
  const two = row('82298');
  assert.equal(Number(get(two, 'daily_net_sales')), 1200);
  assert.equal(Number(get(two, 'daily_service_rev')), 1000);

  // A FILTER() formula left as text by the Google Sheets export is skipped, not parsed as a number.
  const dhr = csv(path.join(OUT, 'dhr_hours.csv'));
  assert.ok(dhr.some((r) => r[0] === '80123' && r[1] === '2026-11-20' && r[2] === '8.25'), 'the numeric DHR cell survives');
  assert.ok(!dhr.some((r) => r[0] === '80123' && r[1] === '2026-11-21'), 'the FILTER text cell is skipped, not read as a number');
});

test('monthly targets come from the BY TL sheet, Total rows skipped', { skip: SKIP }, () => {
  spawnSync(PY, [path.join(ROOT, 'pipeline', 'dsr-dhr-parse.py')], { env: ENV, encoding: 'utf8' });
  const r = spawnSync(PY, [path.join(ROOT, 'scripts', 'dsr-targets.py')], { env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `targets failed: ${r.stderr}`);
  const t = csv(ENV.SCP_TARGETS_FILE);
  const header = t[0];
  const get = (r, col) => r[header.indexOf(col)];
  const one = t.find((r) => get(r, 'salon_number') === '80123');
  const two = t.find((r) => get(r, 'salon_number') === '82298');
  assert.ok(one && two, 'both salons have targets');
  assert.equal(get(one, 'period'), '2026-11');
  assert.equal(Number(get(one, 'target_dollars')), 27500);
  assert.equal(Number(get(one, 'run_rate_dollars')), 25000);
  assert.equal(Number(get(two, 'target_dollars')), 20000);
  assert.equal(t.length, 3, 'header + 2 salons: the Total row is skipped');
});

test('the ledger loads into the portal through the real load-sales CLI', { skip: SKIP }, () => {
  spawnSync(PY, [path.join(ROOT, 'pipeline', 'dsr-dhr-parse.py')], { env: ENV, encoding: 'utf8' });
  const dbFile = path.join(dir, 'portal.db');
  const db = openDb(dbFile);
  migrate(db);
  seedOrg(db, { passwordFor: () => 'x' });
  // The org seed already carries every real salon number, fixtures included; be hermetic either way.
  const ins = db.prepare("INSERT OR IGNORE INTO salons (salon_number, name) VALUES (?, ?)");
  ins.run('80123', 'Test Salon One');
  ins.run('82298', 'Sahara Test');
  db.close();
  const run = spawnSync('node', [path.join(ROOT, 'server', 'import', 'load-sales.js'),
    path.join(OUT, 'daily.csv'), path.join(dir, 'no-targets.csv')],
  { env: { ...process.env, SCP_DB: dbFile }, encoding: 'utf8' });
  assert.equal(run.status, 0, `load-sales failed: ${run.stderr}`);
  const reopened = openDb(dbFile);
  const rows = reopened.prepare('SELECT salon_id, date, net_sales_c, service_c, hours FROM kpi_daily ORDER BY salon_id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].net_sales_c, 120000, '82298: reconstructed net, in cents');
  assert.equal(rows[1].net_sales_c, 150000, '80123: day delta, in cents');
  assert.equal(rows[1].service_c, 100000);
  assert.equal(rows[1].hours, 30);
  reopened.close();
});

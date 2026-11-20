'use strict';
// Manual per-stylist data upload (Nov 30 go-live, plan 3.3) and the nightly load's stylist rows.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startPortal } = require('./helpers');
const { openDb } = require('../server/db');
const { migrate } = require('../server/migrate');
const { seedOrg } = require('../server/seed/org');

const DSR_HEADER = 'date,store_id,center_name,region,daily_net_sales,daily_haircuts,daily_tickets,daily_clocked_hours,daily_service_rev,daily_product_rev,daily_supercut_plus';

let p;
before(async () => { p = await startPortal({ sample: true }); });
after(async () => { await p.stop(); });

test('the nightly sales load keeps manual stylist rows and still clears sample ones', () => {
  // A throwaway database the load-sales CLI runs against, exactly as the office machine runs it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-loadsales-'));
  const dbFile = path.join(dir, 'portal.db');
  const db = openDb(dbFile);
  migrate(db);
  seedOrg(db, { passwordFor: () => 'x' });
  const salonId = db.prepare('SELECT id FROM salons WHERE salon_number = ?').get('8495').id;
  const insUser = db.prepare(`INSERT INTO users (username, password_hash, role, first_name, last_name, salon_id, employee_id, status, created_at)
    VALUES (?, 'x', 'stylist', 'Jo', 'Fig', ?, ?, 'active', '2026-01-01')`);
  const uid = Number(insUser.run('jfig', salonId, '910001').lastInsertRowid);
  const insRow = db.prepare("INSERT INTO stylist_daily (user_id, date, service_c, product_c, guests, hours, source) VALUES (?,?,?,?,?,?,?)");
  insRow.run(uid, '2026-11-19', 45000, 2500, 8, 6.5, 'manual'); // the home office uploaded this
  insRow.run(uid, '2026-11-18', 99999, 0, 1, 1, 'sample');      // invented seed data
  db.close();

  const daily = path.join(dir, 'daily.csv');
  fs.writeFileSync(daily, `${DSR_HEADER}\n2026-11-19,8495,MDR,Cali,1233.50,26,27,20.8,1135.25,98.25,1`);
  const run = spawnSync('node', [path.join(__dirname, '..', 'server', 'import', 'load-sales.js'), daily, path.join(dir, 'no-targets.csv')],
    { env: { ...process.env, SCP_DB: dbFile }, encoding: 'utf8' });
  assert.equal(run.status, 0, `load-sales failed: ${run.stderr}`);

  const reopened = openDb(dbFile);
  const manual = reopened.prepare('SELECT service_c FROM stylist_daily WHERE user_id = ? AND date = ?').get(uid, '2026-11-19');
  assert.ok(manual, 'the manually uploaded stylist row must survive the nightly load');
  assert.equal(manual.service_c, 45000);
  const sample = reopened.prepare('SELECT 1 FROM stylist_daily WHERE user_id = ? AND date = ?').get(uid, '2026-11-18');
  assert.ok(!sample, 'sample stylist rows are still removed by a real load');
  const kpi = reopened.prepare('SELECT net_sales_c FROM kpi_daily WHERE salon_id = ? AND date = ?').get(salonId, '2026-11-19');
  assert.equal(kpi.net_sales_c, 123350, 'the salon-day itself still loaded');
  reopened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Cycle 2: the import module (server/import/stylist-daily.js) ----

const { importStylistDaily } = require('../server/import/stylist-daily');

const STYLIST_HEADER = 'employee_id,date,service,product,guests,hours';

async function threeStylists() {
  const admin = await p.as('zemar');
  const csv = ['first_name,last_name,role,salon_number,employee_id',
    'Jo,One,stylist,8495,910001',
    'Al,Two,stylist,8495,910002',
    'Bo,Three,stylist,8495,910003'].join('\n');
  const r = await admin.post('/api/admin/users/import', { csv });
  assert.equal(r.status, 200);
  const n = r.body.created.length + r.body.updated.length;
  assert.equal(n, 3, `setup failed: ${JSON.stringify(r.body)}`);
  assert.equal(p.db.prepare("SELECT COUNT(*) n FROM users WHERE employee_id IN ('910001','910002','910003')").get().n, 3);
  return admin;
}

test('stylist upload: dollars become cents, dates normalise, rows match on employee id', async () => {
  await threeStylists();
  const out = importStylistDaily(p.db, `${STYLIST_HEADER}\n910001,2026-11-19,450.00,25.5,8,6.5\n910002,11/19/2026,300,0,5,4.25`);
  assert.equal(out.rows, 2);
  assert.equal(out.rejected_count, 0);
  const one = p.db.prepare("SELECT service_c, product_c, guests, hours, source FROM stylist_daily WHERE user_id = ? AND date = ?")
    .get(p.db.prepare('SELECT id FROM users WHERE employee_id = ?').get('910001').id, '2026-11-19');
  assert.deepEqual({ ...one }, { service_c: 45000, product_c: 2550, guests: 8, hours: 6.5, source: 'manual' });
  const two = p.db.prepare('SELECT service_c FROM stylist_daily WHERE user_id = ? AND date = ?')
    .get(p.db.prepare('SELECT id FROM users WHERE employee_id = ?').get('910002').id, '2026-11-19');
  assert.ok(two, 'M/D/YYYY dates normalise to ISO');
  assert.equal(two.service_c, 30000);
});

test('stylist upload: re-uploading the same stylist day replaces the figures', async () => {
  importStylistDaily(p.db, `${STYLIST_HEADER}\n910001,2026-11-19,500,10,9,7`);
  const rows = p.db.prepare("SELECT service_c FROM stylist_daily WHERE user_id = ? AND date = '2026-11-19'")
    .all(p.db.prepare('SELECT id FROM users WHERE employee_id = ?').get('910001').id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].service_c, 50000);
});

test('stylist upload: unknown employees, duplicate lines, negatives and bad dates are rejected with line numbers', async () => {
  const out = importStylistDaily(p.db, [STYLIST_HEADER,
    '999999,2026-11-19,100,0,1,1',        // nobody has this employee id
    '910001,2026-11-20,100,0,1,1',
    '910001,2026-11-20,200,0,2,2',        // duplicate employee_id+date in this file
    '910002,2026-11-21,-5,0,1,1',         // negative money
    '910002,not-a-date,100,0,1,1',        // bad date
    '910002,2026-11-22,100,0,-2,1',       // negative guests
  ].join('\n'));
  assert.equal(out.rows, 1);
  assert.equal(out.rejected_count, 5);
  assert.ok(out.rejected.some((r) => r.line === 2 && /999999/.test(r.reason)));
  assert.ok(out.rejected.some((r) => r.line === 4 && /twice|same day/i.test(r.reason)));
  assert.ok(out.rejected.some((r) => r.line === 5 && /negative/i.test(r.reason)));
  assert.ok(out.rejected.some((r) => r.line === 6 && /date/i.test(r.reason)));
  assert.ok(out.rejected.some((r) => r.line === 7 && /guest/i.test(r.reason)));
  const kept = p.db.prepare('SELECT service_c FROM stylist_daily WHERE user_id = ? AND date = ?')
    .get(p.db.prepare('SELECT id FROM users WHERE employee_id = ?').get('910001').id, '2026-11-20');
  assert.equal(kept.service_c, 10000, 'the valid line still landed');
});

test('stylist upload: a file missing the employee id or date columns is refused', () => {
  assert.throws(() => importStylistDaily(p.db, 'employee_id,service\n910001,100'), /missing these columns/);
  assert.throws(() => importStylistDaily(p.db, 'date,service\n2026-11-19,100'), /missing these columns/);
});

test('stylist upload: a dry run reports what would change and writes nothing', async () => {
  await threeStylists(); // idempotent: re-runs of this helper only re-create the same three
  const before = p.db.prepare('SELECT COUNT(*) n FROM stylist_daily').get().n;
  const out = importStylistDaily(p.db, `${STYLIST_HEADER}\n910003,2026-11-25,111,2,3,4`, { dryRun: true });
  assert.equal(out.rows, 1);
  assert.equal(out.dry_run, true);
  assert.equal(p.db.prepare('SELECT COUNT(*) n FROM stylist_daily').get().n, before, 'nothing written');
});

// ---- Cycle 3: the admin route ----

test('the admin stylist-upload route imports, audits and reports rejects; a stylist cannot call it', async () => {
  const admin = await threeStylists();
  const r = await admin.post('/api/admin/import/stylist-daily', { csv: `${STYLIST_HEADER}\n910001,2026-11-26,450,25,8,6.5` });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['dry_run', 'from', 'people', 'rejected', 'rejected_count', 'rows', 'to']);
  assert.equal(r.body.rows, 1);
  assert.ok(p.db.prepare("SELECT 1 FROM audit_log WHERE action = 'stylist.import'").get(), 'the upload is audited');
  // dry run through the route
  const dry = await admin.post('/api/admin/import/stylist-daily', { csv: `${STYLIST_HEADER}\n910002,2026-11-26,1,0,1,1`, dry_run: true });
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.rows, 1);
  assert.equal(p.db.prepare("SELECT COUNT(*) n FROM stylist_daily sd JOIN users u ON u.id = sd.user_id WHERE u.employee_id = '910002' AND sd.date = '2026-11-26'").get().n, 0, 'a dry run writes nothing');
  // raw CSV body also works
  const raw = await admin.post('/api/admin/import/stylist-daily', `${STYLIST_HEADER}\n910003,2026-11-26,2,0,1,1`, { raw: true, headers: { 'content-type': 'text/csv' } });
  assert.equal(raw.status, 200);
  // a stylist gets refused
  const stylist = await p.as('demo.stylist');
  assert.equal((await stylist.post('/api/admin/import/stylist-daily', { csv: STYLIST_HEADER })).status, 403);
  // hr is refused too: stylist figures are outside HR's view by design
  const hr = await p.as('demo.hr');
  assert.equal((await hr.post('/api/admin/import/stylist-daily', { csv: STYLIST_HEADER })).status, 403);
});

test('the stylist upload template downloads as CSV', async () => {
  const admin = await p.as('zemar');
  const r = await admin.get('/api/admin/import/stylist-daily/template');
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /text\/csv/);
  assert.ok(String(r.body).startsWith('employee_id,date,service,product,guests,hours'));
});


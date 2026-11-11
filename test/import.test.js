'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPortal } = require('./helpers');
const { importDsr } = require('../server/import/dsr');
const { parseCsv } = require('../server/import/csv');

const HEADER = 'date,store_id,center_name,region,daily_net_sales,daily_haircuts,daily_tickets,daily_clocked_hours,daily_service_rev,daily_product_rev,daily_supercut_plus';
let p;
before(async () => { p = await startPortal({ sample: false }); });
after(async () => { await p.stop(); });

test('CSV reader handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,1","say ""hi"""\r\n\r\n3,4'), [['a', 'b'], ['x,1', 'say "hi"'], ['3', '4']]);
});

test('imports valid rows, converts to cents, rejects bad rows with reasons', () => {
  const csv = [HEADER,
    '2026-10-01,8495,MDR,Cali,1233.50,26,27,20.8,1135.25,98.25,1',
    '2026-10-02,8495,MDR,Cali,900,20,21,15,850,50,0',
    '2026-10-01,99999,Unknown,Cali,100,1,1,1,100,0,0',
    'not-a-date,8495,MDR,Cali,100,1,1,1,100,0,0',
    '2026-10-03,8495,MDR,Cali,abc,1,1,1,100,0,0',
    '2026-10-04,8495,MDR,Cali,100,1,-4,1,100,0,0',
  ].join('\n');
  const out = importDsr(p.db, csv);
  assert.equal(out.rows, 2);
  assert.equal(out.salons, 1);
  assert.equal(out.from, '2026-10-01');
  assert.equal(out.to, '2026-10-02');
  assert.equal(out.rejected_count, 4);
  assert.ok(out.rejected.some((r) => /99999/.test(r.reason)));
  assert.ok(out.rejected.some((r) => r.line === 5 && /date/.test(r.reason)));
  const row = p.db.prepare('SELECT * FROM kpi_daily WHERE salon_id = ? AND date = ?').get(p.salonId(8495), '2026-10-01');
  assert.equal(row.net_sales_c, 123350);
  assert.equal(row.service_c, 113525);
  assert.equal(row.product_c, 9825);
  assert.equal(row.guests, 27);
  assert.equal(row.haircuts, 26);
  assert.equal(row.hours, 20.8);
  assert.equal(row.supercut_plus, 1);
});

test('re-importing replaces rather than duplicates', () => {
  importDsr(p.db, `${HEADER}\n2026-10-01,8495,MDR,Cali,1000,26,30,20,950,50,2`);
  const rows = p.db.prepare('SELECT * FROM kpi_daily WHERE salon_id = ? AND date = ?').all(p.salonId(8495), '2026-10-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net_sales_c, 100000);
});

test('a file without the required columns is refused with a clear message', () => {
  assert.throws(() => importDsr(p.db, 'date,store\n2026-10-01,8495'), /missing these columns/);
});

test('the admin route imports, audits and refreshes the KPIs', async () => {
  const admin = await p.as('zemar');
  const today = new Date().toISOString().slice(0, 10);
  const r = await admin.post('/api/admin/import/dsr', { csv: `${HEADER}\n${today},80039,PAS,Cali,2000,40,50,30,1800,200,5` });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['from', 'rejected', 'rejected_count', 'rows', 'salons', 'to']);
  assert.equal(r.body.rows, 1);
  const salon = await admin.get(`/api/salons/${p.salonId(80039)}`);
  assert.equal(salon.body.kpis.yesterday.net_sales_c, 200000);
  assert.equal(salon.body.kpis.yesterday.atv_c, 4000);
  assert.equal(salon.body.kpis.yesterday.product_pct, 10);
  assert.ok(p.db.prepare("SELECT 1 FROM audit_log WHERE action = 'kpi.import'").get());
  assert.equal((await admin.post('/api/admin/import/dsr', { csv: 'nope' })).status, 400);
  const asText = await admin.post('/api/admin/import/dsr', `${HEADER}\n${today},8768,ARC,Cali,500,10,12,8,450,50,0`, { raw: true, headers: { 'content-type': 'text/csv' } });
  assert.equal(asText.status, 200);
});

test('the real daily ledger parses cleanly (temp database only)', { skip: !fs.existsSync(path.join(__dirname, '..', '..', 'data', 'dsr-dhr', 'daily.csv')) }, () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'dsr-dhr', 'daily.csv'), 'utf8');
  const out = importDsr(p.db, csv);
  assert.ok(out.rows > 5000, `rows ${out.rows}`);
  assert.ok(out.salons >= 45, `salons ${out.salons}`);
  assert.ok(out.from < out.to);
});

test('bulk user import creates accounts and reports bad lines', async () => {
  const admin = await p.as('zemar');
  const csv = ['first_name,last_name,role,salon_number,hire_date',
    'Ana,Example,stylist,8495,2024-03-01',
    'Ben,Example,salon_manager,80039,',
    'Cara,Example,stylist,,',
    'Dee,Example,stylist,11111,',
    'Eve,Example,admin,,'].join('\n');
  const r = await admin.post('/api/admin/users/import', { csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.created.length, 3);
  assert.equal(r.body.rejected.length, 2);
  assert.ok(r.body.created.every((u) => u.temp_password.length >= 16));
  assert.equal((await p.client().login(r.body.created[0].username, r.body.created[0].temp_password)).status, 200);
  assert.equal(p.db.prepare('SELECT manager_user_id FROM salons WHERE salon_number = ?').get('80039').manager_user_id, r.body.created[1].id);
});

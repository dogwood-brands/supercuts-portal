#!/usr/bin/env node
'use strict';
// Loads the real daily sales ledger and monthly targets into the portal. Safe to run any number of times.
//   node server/import/load-sales.js [path/to/daily.csv] [path/to/dsr-targets.csv]
// 1. upserts every salon-day from the DSR / DHR ledger into kpi_daily (source 'dsr')
// 2. removes any generated sample salon-days that the ledger did not replace
// 3. sets each salon's monthly sales goal and run-rate from the DSR; clears sample product % and per-hour goals
// 4. removes sample per-stylist figures (the reports are by salon, not by person)
// 5. records when this ran, for the "next refresh" note on the salon pages
const fs = require('fs');
const path = require('path');
const { openDb, ROOT } = require('../db');
const { migrate } = require('../migrate');
const { importDsr } = require('./dsr');
const { parseCsvObjects } = require('./csv');

const LEDGER = process.argv[2] || path.join(ROOT, '..', 'data', 'dsr-dhr', 'daily.csv');
const TARGETS = process.argv[3] || path.join(ROOT, 'data', 'dsr-targets.csv');

const db = openDb();
migrate(db);
const now = new Date().toISOString();

const report = importDsr(db, fs.readFileSync(LEDGER, 'utf8'), { source: 'dsr' });
if (!report.rows) { console.error('No rows were imported; nothing changed.'); process.exit(1); }

const removedSample = db.prepare("DELETE FROM kpi_daily WHERE source = 'sample'").run().changes;

// goals and run-rate, both straight from the DSR
let goals = 0;
if (fs.existsSync(TARGETS)) {
  const salons = new Map(db.prepare('SELECT id, salon_number FROM salons').all().map((s) => [String(s.salon_number), s.id]));
  const upsert = db.prepare(`INSERT INTO kpi_goals (salon_id, period, sales_goal_c, run_rate_c) VALUES (?, ?, ?, ?)
    ON CONFLICT(salon_id, period) DO UPDATE SET sales_goal_c = excluded.sales_goal_c, run_rate_c = excluded.run_rate_c`);
  db.transaction(() => {
    for (const r of parseCsvObjects(fs.readFileSync(TARGETS, 'utf8')).records) {
      const id = salons.get(String(r.salon_number).trim());
      const dollars = Number(r.target_dollars);
      const rr = Number(r.run_rate_dollars);
      if (!id || !/^\d{4}-\d{2}$/.test(r.period) || !Number.isFinite(dollars) || dollars <= 0) continue;
      upsert.run(id, r.period, Math.round(dollars * 100), Number.isFinite(rr) && rr > 0 ? Math.round(rr * 100) : null);
      goals += 1;
    }
  })();
}
// The reports carry a sales target only. Product % and sales-per-hour goals were sample values; clear them
// so those measures are compared with the company median instead of an invented goal.
db.prepare('UPDATE kpi_goals SET product_pct_goal = NULL, srph_goal_c = NULL').run();
// The reports are by salon, not by person. Remove any sample per-stylist figures.
const scaled = db.prepare('DELETE FROM stylist_daily').run().changes;

db.prepare("INSERT INTO settings (key, value_json) VALUES ('kpi_refresh', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
  .run(JSON.stringify({ source: 'dsr', last_loaded_at: now, data_through: report.to, rows: report.rows }));
db.prepare("INSERT INTO audit_log (actor_id, action, target_type, target_id, meta_json, ip, created_at) VALUES (NULL, 'cli.load_sales', 'kpi', NULL, ?, 'cli', ?)")
  .run(JSON.stringify({ rows: report.rows, salons: report.salons, from: report.from, to: report.to, goals, rejected: report.rejected_count }), now);
db.close();
console.log(`${now} loaded ${report.rows} salon-days for ${report.salons} salons, ${report.from} to ${report.to}; goals set: ${goals}; sample days removed: ${removedSample}; sample stylist rows removed: ${scaled}; skipped rows: ${report.rejected_count}`);
for (const r of report.rejected.slice(0, 6)) console.log(`  skipped: ${r.reason}`);

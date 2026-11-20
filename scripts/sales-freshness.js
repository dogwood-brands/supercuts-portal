#!/usr/bin/env node
'use strict';
// Prints whether the sales ledger is fresh and exits non-zero when it is a day or more behind.
// The refresh job appends this to its log, so "WARNING: sales data is N days old" in the log is the
// signal that a report did not arrive (see ops/RUNBOOK.md). The full alarm lands with phase 1h.
const { openDb } = require('../server/db');
const { json } = require('../server/util');

const db = openDb();
const row = db.prepare("SELECT value_json FROM settings WHERE key = 'kpi_refresh'").get();
db.close();
const s = json(row?.value_json, {});
const through = s.data_through || null;

// Today in US Central, where the salons operate: a DSR sent this morning reports through yesterday,
// so being exactly one day behind is normal.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
if (!through) {
  console.log('Sales freshness: the ledger has never loaded.');
  process.exit(1);
}
const days = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${through}T12:00:00Z`)) / 86400000);
if (days <= 1) {
  console.log(`Sales freshness OK: data through ${through}.`);
} else {
  console.log(`WARNING: sales data is ${days} days old (through ${through}). Check the reports inbox and ops/RUNBOOK.md.`);
  process.exit(1);
}

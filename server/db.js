'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'data', 'portal.db');

/** Open (and create if needed) the SQLite database with the pragmas this app relies on. */
function openDb(file = process.env.SCP_DB || DEFAULT_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

module.exports = { openDb, ROOT, DEFAULT_DB };

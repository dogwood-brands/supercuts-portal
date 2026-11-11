'use strict';
// Numbered, forward-only migrations. Each file in server/migrations runs once, inside a transaction.
// To change the schema: add the next file (002_something.sql). Never edit a migration that has shipped.
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');

const DIR = path.join(__dirname, 'migrations');

function migrate(db, log = () => {}) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    })();
    applied.push(f);
    log(`applied ${f}`);
  }
  return applied;
}

module.exports = { migrate };

if (require.main === module) {
  const db = openDb();
  const applied = migrate(db, (m) => console.log(m));
  console.log(applied.length ? `Done. ${applied.length} migration(s) applied.` : 'Schema is up to date.');
  db.close();
}

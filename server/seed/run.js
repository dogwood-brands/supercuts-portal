'use strict';
// Seeds the database: the real organisation plus the sample preview data.
//   npm run seed          -> refuses to run if the database already has salons
//   npm run seed:reset    -> deletes data/portal.db first (asks for --yes when it holds non-sample KPI rows)
// Demo and leadership passwords are generated here and written to data/demo-logins.txt (mode 600).
const fs = require('node:fs');
const path = require('node:path');
const { openDb, DEFAULT_DB } = require('../db');
const { migrate } = require('../migrate');
const auth = require('../auth');
const { seedOrg, LEADERSHIP } = require('./org');
const { seedSample } = require('./sample');

const DEMO = [
  ['demo.admin', 'Administrator: everything, including Admin'],
  ['demo.executive', 'Leadership: company rollups, read-only'],
  ['demo.hr', 'HR: people and the private HR inbox'],
  ['demo.dl', 'District leader: Westside & San Gabriel district'],
  ['demo.manager', 'Salon manager: Marina Del Rey #8495'],
  ['demo.stylist', 'Stylist: Marina Del Rey #8495'],
];

function runSeed({ file = process.env.SCP_DB || DEFAULT_DB, reset = false, force = false, writeLogins = true, log = console.log } = {}) {
  if (reset && file !== ':memory:' && fs.existsSync(file)) {
    const probe = openDb(file);
    let real = 0;
    try { real = probe.prepare("SELECT COUNT(*) n FROM kpi_daily WHERE source != 'sample'").get().n; } catch { /* no schema yet */ }
    probe.close();
    if (real && !force) throw new Error(`This database holds ${real} imported (non-sample) KPI rows. Re-run with --yes to delete it anyway.`);
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    log(`removed ${file}`);
  }
  const db = openDb(file);
  migrate(db);
  if (db.prepare('SELECT COUNT(*) n FROM salons').get().n) {
    db.close();
    throw new Error('The database is already seeded. Use "npm run seed:reset" to start over.');
  }
  const passwords = new Map();
  const passwordFor = (username) => {
    if (!DEMO.some(([u]) => u === username) && !LEADERSHIP.some(([u]) => u === username)) return null;
    const pw = auth.generatePassword();
    passwords.set(username, pw);
    return auth.hashPassword(pw);
  };
  // If the server already created a bootstrap "admin", keep it.
  const org = seedOrg(db, { passwordFor });
  log(`organisation: ${org.salons} salons, ${org.leadership.length} leadership logins, ${org.districtLeaders.length} district leaders`);
  const sample = seedSample(db, { passwordFor, log });

  if (writeLogins && file !== ':memory:') {
    const out = path.join(path.dirname(file), 'demo-logins.txt');
    const lines = [
      'SC Portal logins. Generated ' + new Date().toISOString(),
      'Keep this file private. Passwords are stored only here; the database holds hashes.',
      '',
      'PREVIEW LOGINS (sample data)',
      ...DEMO.map(([u, what]) => `  ${u.padEnd(16)} ${String(passwords.get(u) || '(not created)').padEnd(22)} ${what}`),
      '',
      'LEADERSHIP LOGINS (asked to choose a new password at first sign-in)',
      ...LEADERSHIP.map(([u, first, last, role]) => `  ${u.padEnd(16)} ${String(passwords.get(u) || '(not created)').padEnd(22)} ${first} ${last} (${role})`),
      '',
      'District leaders and sample salon staff have no password yet. Issue one from Admin > People > Reset password.',
      '',
    ];
    fs.writeFileSync(out, lines.join('\n'), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
    log(`logins written to ${out}`);
  }
  db.close();
  return { org, sample, passwords };
}

module.exports = { runSeed, DEMO };

if (require.main === module) {
  try {
    runSeed({ reset: process.argv.includes('--reset'), force: process.argv.includes('--yes') });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

'use strict';
// scripts/backup-offsite.sh: copies the newest local backup off the machine, verifies it, and prunes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'backup-offsite.sh');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-offsite-'));
  const src = path.join(dir, 'local backups'); // a space in the path on purpose
  const dest = path.join(dir, 'off site');
  fs.mkdirSync(src);
  fs.mkdirSync(dest);
  return { dir, src, dest };
}

// Writes a backup file with a modification time `ageMinutes` in the past, so "newest" is deterministic.
function backup(folder, name, content, ageMinutes) {
  const file = path.join(folder, name);
  fs.writeFileSync(file, content);
  const t = new Date(Date.now() - ageMinutes * 60000);
  fs.utimesSync(file, t, t);
  return file;
}

function run(env) {
  return spawnSync('sh', [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
}

test('skips with a warning when no destination is set', () => {
  const { src } = setup();
  backup(src, 'portal_2026-11-17_023000.db.gz', 'db', 0);
  const r = run({ SCP_BACKUPS: src });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /SCP_BACKUP_OFFSITE is not set/);
});

test('fails when the destination folder is missing instead of creating it locally', () => {
  const { src, dir } = setup();
  backup(src, 'portal_2026-11-17_023000.db.gz', 'db', 0);
  const missing = path.join(dir, 'not mounted');
  const r = run({ SCP_BACKUPS: src, SCP_BACKUP_OFFSITE: missing });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not exist/);
  assert.equal(fs.existsSync(missing), false);
});

test('fails when there is no database backup to copy', () => {
  const { src, dest } = setup();
  const r = run({ SCP_BACKUPS: src, SCP_BACKUP_OFFSITE: dest });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no database backup/);
});

test('copies only the newest database and uploads backups, byte for byte', () => {
  const { src, dest } = setup();
  backup(src, 'portal_2026-11-16_023000.db.gz', 'old db', 60);
  backup(src, 'portal_2026-11-17_023000.db.gz', 'new db', 0);
  backup(src, 'uploads_2026-11-16_023000.tar.gz', 'old uploads', 60);
  backup(src, 'uploads_2026-11-17_023000.tar.gz', 'new uploads', 0);
  const r = run({ SCP_BACKUPS: src, SCP_BACKUP_OFFSITE: dest });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['portal_2026-11-17_023000.db.gz', 'uploads_2026-11-17_023000.tar.gz']);
  assert.equal(fs.readFileSync(path.join(dest, 'portal_2026-11-17_023000.db.gz'), 'utf8'), 'new db');
  assert.equal(fs.readFileSync(path.join(dest, 'uploads_2026-11-17_023000.tar.gz'), 'utf8'), 'new uploads');
});

test('copies the database alone when there is no uploads backup', () => {
  const { src, dest } = setup();
  backup(src, 'portal_2026-11-17_023000.db.gz', 'db', 0);
  const r = run({ SCP_BACKUPS: src, SCP_BACKUP_OFFSITE: dest });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dest), ['portal_2026-11-17_023000.db.gz']);
});

test('keeps only the newest SCP_BACKUP_OFFSITE_KEEP copies at the destination', () => {
  const { src, dest } = setup();
  for (let i = 1; i <= 3; i++) backup(dest, `portal_2026-11-1${i}_023000.db.gz`, `old ${i}`, 600 - i);
  backup(src, 'portal_2026-11-17_023000.db.gz', 'new', 0);
  const r = run({ SCP_BACKUPS: src, SCP_BACKUP_OFFSITE: dest, SCP_BACKUP_OFFSITE_KEEP: '2' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['portal_2026-11-13_023000.db.gz', 'portal_2026-11-17_023000.db.gz']);
});

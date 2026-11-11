'use strict';
// Shared test harness: a throwaway database in a temp folder, a real HTTP server on a random port,
// and a tiny cookie-aware client. Password hashing is turned down so the suite runs in seconds.
process.env.SCP_SCRYPT_N = '1024';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../server/db');
const { migrate } = require('../server/migrate');
const { createApp } = require('../server/app');
const auth = require('../server/auth');
const { seedOrg } = require('../server/seed/org');
const { seedSample } = require('../server/seed/sample');

const PASSWORD = 'correct-horse-battery';

async function startPortal({ sample = true, config = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-test-'));
  const db = openDb(path.join(dir, 'portal.db'));
  migrate(db);
  const hash = auth.hashPassword(PASSWORD);
  const passwordFor = () => hash;
  seedOrg(db, { passwordFor });
  if (sample) seedSample(db, { passwordFor });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0').run(hash); // every account can sign in during tests
  const app = createApp({ db, uploadsDir: path.join(dir, 'uploads'), config: { loginLimit: 1000, apiLimitPerMinute: 100000, ...config }, log: { error() {} } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    async function call(method, url, body, { headers = {}, raw = false, csrf = true } = {}) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (csrf && method !== 'GET') h['x-scp'] = '1';
      let payload;
      if (body !== undefined && !raw) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); } else payload = body;
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) if (c.startsWith('scp_session=')) cookie = c.split(';')[0] === 'scp_session=' ? '' : c.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, body: data, headers: res.headers, setCookie: set };
    }
    return {
      get: (u, o) => call('GET', u, undefined, o), post: (u, b, o) => call('POST', u, b, o), patch: (u, b, o) => call('PATCH', u, b, o),
      put: (u, b, o) => call('PUT', u, b, o), del: (u, o) => call('DELETE', u, undefined, o),
      login: (username, password = PASSWORD) => call('POST', '/api/auth/login', { username, password }),
      get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    };
  }
  async function as(username) {
    const c = client();
    const r = await c.login(username);
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.body)}`);
    c.me = r.body.user;
    return c;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const salonId = (number) => db.prepare('SELECT id FROM salons WHERE salon_number = ?').get(String(number)).id;
  const stylistAt = (number, offset = 0) => db.prepare("SELECT username, id FROM users WHERE role = 'stylist' AND salon_id = ? ORDER BY id LIMIT 1 OFFSET ?").get(salonId(number), offset);
  const managerAt = (number) => db.prepare("SELECT username, id FROM users WHERE role = 'salon_manager' AND salon_id = ?").get(salonId(number));
  return { db, base, dir, client, as, stop, salonId, stylistAt, managerAt, PASSWORD };
}

module.exports = { startPortal, PASSWORD };

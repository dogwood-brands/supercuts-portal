'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPortal, PASSWORD } = require('./helpers');
const auth = require('../server/auth');

let p;
before(async () => { p = await startPortal(); });
after(async () => { await p.stop(); });

test('healthz answers without a session', async () => {
  const r = await p.client().get('/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['db', 'ok', 'version']);
});

test('the API refuses signed-out requests with the standard error shape', async () => {
  for (const url of ['/api/feed', '/api/salons', '/api/auth/me', '/api/admin/users', '/api/hr/inquiries']) {
    const r = await p.client().get(url);
    assert.equal(r.status, 401, url);
    assert.equal(r.body.error.code, 'unauthorized');
    assert.equal(typeof r.body.error.message, 'string');
  }
});

test('login sets an HttpOnly SameSite cookie and stores only a hash of the token', async () => {
  const c = p.client();
  const r = await c.login('demo.stylist');
  assert.equal(r.status, 200);
  const cookie = r.setCookie.find((x) => x.startsWith('scp_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = cookie.split(';')[0].split('=')[1];
  assert.ok(token.length >= 40);
  assert.equal(p.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(token).n, 0, 'raw token must not be stored');
  assert.equal(p.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(auth.sha256(token)).n, 1);
  assert.equal(r.body.user.password_hash, undefined);
});

test('unknown user and wrong password give the same answer', async () => {
  const a = await p.client().login('nobody.here', 'whatever-password');
  const b = await p.client().login('demo.stylist', 'not-the-password');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('auth/me returns the MeUser shape, settings and unread count', async () => {
  const c = await p.as('demo.stylist');
  const r = await c.get('/api/auth/me');
  assert.equal(r.status, 200);
  const u = r.body.user;
  for (const k of ['id', 'name', 'first_name', 'role', 'title', 'avatar_url', 'salon', 'email', 'phone', 'must_change_password', 'district', 'scope', 'permissions']) assert.ok(k in u, `missing ${k}`);
  assert.equal(u.role, 'stylist');
  assert.equal(u.scope, 'salon');
  assert.equal(u.salon.salon_number, '8495');
  assert.ok(Number.isInteger(u.salon.id));
  assert.deepEqual(u.permissions, []);
  assert.equal(r.body.settings.sample_data, true);
  assert.ok(Array.isArray(r.body.settings.values) && r.body.settings.values[0].key);
  assert.equal(typeof r.body.unread, 'number');
  const exec = await p.as('demo.executive');
  assert.equal(exec.me.salon, null);
  assert.equal(exec.me.scope, 'all');
  assert.ok(exec.me.permissions.includes('kpi.company'));
  const dl = await p.as('demo.dl');
  assert.equal(dl.me.scope, 'district');
  assert.ok(dl.me.district.id);
});

test('logout ends the session', async () => {
  const c = await p.as('demo.stylist');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  const saved = c.cookie;
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  c.cookie = saved; // replaying the old cookie must not work
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('an expired session is rejected and removed', async () => {
  const c = await p.as('demo.manager');
  const hash = auth.sha256(c.cookie.split('=')[1]);
  p.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 1000).toISOString(), hash);
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal(p.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(hash).n, 0);
});

test('a session slides forward when it is used', async () => {
  const c = await p.as('demo.manager');
  const hash = auth.sha256(c.cookie.split('=')[1]);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  p.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(soon, hash);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  const after = p.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash).expires_at;
  assert.ok(Date.parse(after) > Date.now() + 29 * 86400000);
});

test('a deactivated account loses its session', async () => {
  const s = p.stylistAt(80039);
  const c = await p.as(s.username);
  p.db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(s.id);
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await p.client().login(s.username)).status, 401);
  p.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(s.id);
});

test('CSRF: writes need the X-SCP header and a matching Origin', async () => {
  const c = await p.as('demo.stylist');
  const noHeader = await c.post('/api/posts', { kind: 'post', body: 'hello', audience_type: 'company' }, { csrf: false });
  assert.equal(noHeader.status, 403);
  const badOrigin = await c.post('/api/posts', { kind: 'post', body: 'hello', audience_type: 'company' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(badOrigin.status, 403);
  const goodOrigin = await c.post('/api/posts', { kind: 'post', body: 'hello team', audience_type: 'company' }, { headers: { origin: p.base } });
  assert.equal(goodOrigin.status, 200);
  const login = await p.client().post('/api/auth/login', { username: 'demo.stylist', password: PASSWORD }, { csrf: false });
  assert.equal(login.status, 403, 'login is protected too');
  assert.equal((await c.get('/api/feed', { csrf: false })).status, 200, 'reads do not need the header');
});

test('changing a password needs the current one, enforces length, and signs out other devices', async () => {
  const s = p.stylistAt(8768);
  const a = await p.as(s.username);
  const b = await p.as(s.username);
  assert.equal((await a.post('/api/auth/password', { current: 'wrong-password-here', next: 'a-brand-new-password' })).status, 400);
  assert.equal((await a.post('/api/auth/password', { current: PASSWORD, next: 'short' })).status, 400);
  assert.equal((await a.post('/api/auth/password', { current: PASSWORD, next: 'a-brand-new-password' })).status, 200);
  assert.equal((await a.get('/api/auth/me')).status, 200);
  assert.equal((await b.get('/api/auth/me')).status, 401);
  assert.equal((await p.client().login(s.username, PASSWORD)).status, 401);
  assert.equal((await p.client().login(s.username, 'a-brand-new-password')).status, 200);
});

test('login is rate limited per IP and username', async () => {
  const q = await startPortal({ sample: false, config: { loginLimit: 3 } });
  try {
    const c = q.client();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await c.login('zemar', 'wrong-password-' + i)).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    assert.equal((await c.login('chris', 'wrong')).status, 401, 'a different username has its own window');
  } finally { await q.stop(); }
});

test('invites: single use, role and salon come from the invite', async () => {
  const admin = await p.as('demo.admin');
  const salon = p.salonId(80660);
  const inv = await admin.post('/api/admin/invites', { role: 'stylist', salon_id: salon });
  assert.equal(inv.status, 200);
  const c = p.client();
  const body = { code: inv.body.code, username: 'new.stylist', password: 'long-enough-password', first_name: 'New', last_name: 'Stylist' };
  const ok = await c.post('/api/auth/invite/accept', body);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'stylist');
  assert.equal(ok.body.user.salon.id, salon);
  const again = await p.client().post('/api/auth/invite/accept', { ...body, username: 'another.one' });
  assert.equal(again.status, 400);
  assert.equal((await p.client().post('/api/auth/invite/accept', { ...body, code: 'NOPE-NOPE' })).status, 400);
});

test('security headers: strict CSP with no inline script or style', async () => {
  const r = await p.client().get('/healthz');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('errors never leak internals', async () => {
  const c = await p.as('demo.admin');
  const bad = await c.post('/api/posts', '{not json', { raw: true, headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error).sort(), ['code', 'message']);
  const missing = await c.get('/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'not_found');
  assert.doesNotMatch(JSON.stringify(missing.body), /node_modules|at \w+ \(/);
});

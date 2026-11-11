'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPortal } = require('./helpers');

let p, MDR, PAS, LV, stylist, manager, dl, exec, hr, admin, lvStylist, pasStylist;
before(async () => {
  p = await startPortal();
  MDR = p.salonId(8495); PAS = p.salonId(80039); LV = p.salonId(82303);
  [stylist, manager, dl, exec, hr, admin] = await Promise.all(['demo.stylist', 'demo.manager', 'demo.dl', 'demo.executive', 'demo.hr', 'demo.admin'].map((u) => p.as(u)));
  lvStylist = await p.as(p.stylistAt(82303).username);
  pasStylist = await p.as(p.stylistAt(80039).username);
});
after(async () => { await p.stop(); });

const feedIds = async (c, scope = 'company') => {
  const ids = [];
  let cursor = '';
  for (let i = 0; i < 30; i++) {
    const r = await c.get(`/api/feed?scope=${scope}&limit=40${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200);
    ids.push(...r.body.items.map((x) => x.id));
    if (!r.body.next_cursor) break;
    cursor = r.body.next_cursor;
  }
  return ids;
};

test('feed items have the full Post shape', async () => {
  const r = await stylist.get('/api/feed');
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length > 5);
  const post = r.body.items[0];
  for (const k of ['id', 'kind', 'body', 'image_url', 'created_at', 'edited_at', 'pinned', 'author', 'audience', 'targets', 'reactions', 'my_reaction', 'comment_count',
    'latest_comments', 'requires_read', 'read_by_me', 'can_edit', 'can_delete']) assert.ok(k in post, k);
  assert.deepEqual(Object.keys(post.reactions).sort(), ['clap', 'fire', 'like', 'love']);
  assert.deepEqual(Object.keys(post.author).sort(), ['avatar_url', 'first_name', 'id', 'name', 'role', 'salon', 'title']);
  assert.deepEqual(Object.keys(post.audience).sort(), ['id', 'label', 'type']);
  const shout = (await stylist.get('/api/feed?scope=shoutouts')).body.items;
  assert.ok(shout.length > 0 && shout.every((x) => x.kind === 'shoutout' && x.targets.length > 0));
  assert.deepEqual(Object.keys(shout[0].targets[0]).sort(), ['id', 'label', 'type', 'value_key']);
});

test('feed pages do not repeat or skip, newest first', async () => {
  const ids = await feedIds(exec);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, p.db.prepare('SELECT COUNT(*) n FROM posts WHERE deleted_at IS NULL').get().n, 'leadership sees every post');
  const times = ids.map((id) => p.db.prepare('SELECT created_at FROM posts WHERE id = ?').get(id).created_at);
  assert.deepEqual(times, [...times].sort().reverse());
});

test('audience filtering: salon, district and market posts reach only their audience', async () => {
  const salonPost = (await manager.post('/api/posts', { kind: 'post', body: 'MDR only: towels are in.', audience_type: 'salon', audience_id: MDR })).body.post;
  const districtPost = (await dl.post('/api/posts', { kind: 'announcement', body: 'District only: visits next week.', audience_type: 'district', audience_id: dl.me.district.id })).body.post;
  const companyPost = (await pasStylist.post('/api/posts', { kind: 'post', body: 'Hello everyone from Pasadena.', audience_type: 'company' })).body.post;
  assert.ok(salonPost.id && districtPost.id && companyPost.id);
  assert.equal(salonPost.audience.label, 'Marina Del Rey');

  const sees = async (c, id) => (await feedIds(c)).includes(id);
  assert.equal(await sees(stylist, salonPost.id), true);
  assert.equal(await sees(pasStylist, salonPost.id), false, 'same district, different salon');
  assert.equal(await sees(lvStylist, salonPost.id), false);
  assert.equal(await sees(dl, salonPost.id), true, 'the district leader sees salon posts in the district');
  assert.equal(await sees(exec, salonPost.id), true);

  assert.equal(await sees(stylist, districtPost.id), true);
  assert.equal(await sees(pasStylist, districtPost.id), true);
  assert.equal(await sees(lvStylist, districtPost.id), false);
  assert.equal(await sees(lvStylist, companyPost.id), true);

  // A post you cannot see cannot be read, reacted to, commented on or reported either.
  assert.equal((await lvStylist.get(`/api/posts/${salonPost.id}/comments`)).status, 404);
  assert.equal((await lvStylist.post(`/api/posts/${salonPost.id}/react`, { kind: 'like' })).status, 404);
  assert.equal((await lvStylist.post(`/api/posts/${salonPost.id}/comments`, { body: 'hi' })).status, 404);
  assert.equal((await lvStylist.post('/api/reports', { post_id: salonPost.id, reason: 'x' })).status, 404);
  assert.equal((await lvStylist.post(`/api/posts/${salonPost.id}/read`)).status, 404);

  const salonFeed = await feedIds(stylist, 'salon');
  assert.ok(salonFeed.includes(salonPost.id) && !salonFeed.includes(companyPost.id));
});

test('who may post what, and where', async () => {
  const post = (c, b) => c.post('/api/posts', b);
  assert.equal((await post(stylist, { kind: 'announcement', body: 'x', audience_type: 'company' })).status, 403);
  assert.equal((await post(stylist, { kind: 'post', body: 'x', audience_type: 'salon', audience_id: PAS })).status, 403);
  assert.equal((await post(stylist, { kind: 'post', body: 'x', audience_type: 'company', pin_days: 3 })).status, 403);
  assert.equal((await post(manager, { kind: 'announcement', body: 'x', audience_type: 'company' })).status, 403);
  assert.equal((await post(manager, { kind: 'announcement', body: 'x', audience_type: 'salon', audience_id: PAS })).status, 403);
  assert.equal((await post(manager, { kind: 'announcement', body: 'Team meeting Sunday.', audience_type: 'salon', audience_id: MDR, pin_days: 2 })).status, 200);
  assert.equal((await post(dl, { kind: 'announcement', body: 'x', audience_type: 'salon', audience_id: LV })).status, 403);
  assert.equal((await post(exec, { kind: 'announcement', body: 'Company news.', audience_type: 'company' })).status, 200);
  assert.equal((await post(stylist, { kind: 'post', body: '', audience_type: 'company' })).status, 400);
  assert.equal((await post(stylist, { kind: 'post', body: 'x'.repeat(4001), audience_type: 'company' })).status, 400);
  assert.equal((await post(stylist, { kind: 'rant', body: 'x', audience_type: 'company' })).status, 400);
  assert.equal((await post(stylist, { kind: 'post', body: 'x', audience_type: 'company', image_url: 'https://evil.example/x.png' })).status, 400);
});

test('shout-outs need a teammate, accept company values, and notify the person', async () => {
  const peer = p.stylistAt(8495, 1);
  assert.equal((await stylist.post('/api/posts', { kind: 'shoutout', body: 'Great job', audience_type: 'company' })).status, 400);
  assert.equal((await stylist.post('/api/posts', { kind: 'shoutout', body: 'Go me', audience_type: 'company', targets: [{ type: 'user', id: stylist.me.id }] })).status, 400);
  assert.equal((await stylist.post('/api/posts', { kind: 'shoutout', body: 'x', audience_type: 'company', targets: [{ type: 'user', id: peer.id, value_key: 'made-up' }] })).status, 400);
  const ok = await stylist.post('/api/posts', { kind: 'shoutout', body: 'Thank you for covering my shift.', audience_type: 'company',
    targets: [{ type: 'user', id: peer.id, value_key: 'team_player' }, { type: 'salon', id: PAS, value_key: null }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.post.targets.length, 2);
  assert.equal(ok.body.post.targets.find((t) => t.type === 'salon').label, 'Pasadena');
  const note = p.db.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'shoutout' ORDER BY id DESC").get(peer.id);
  assert.match(note.title, /gave you a shout-out/);
  const side = await stylist.get('/api/feed/sidebar');
  assert.deepEqual(Object.keys(side.body).sort(), ['celebrations', 'pinned', 'top_recognized']);
  assert.ok(side.body.top_recognized.length > 0 && side.body.top_recognized[0].count >= 1);
  assert.ok(side.body.celebrations.length >= 2, 'the demo salon has a birthday and an anniversary coming up');
  assert.ok(side.body.pinned.length >= 1);
  const m = await stylist.get('/api/mentions?q=a');
  assert.ok(m.body.users.length > 0 && m.body.users.every((u) => u.id !== stylist.me.id));
  assert.ok(Array.isArray(m.body.salons));
});

test('edit, delete, react, comment, read receipts', async () => {
  const mine = (await stylist.post('/api/posts', { kind: 'post', body: 'First draft', audience_type: 'company' })).body.post;
  assert.equal(mine.can_edit, true);
  assert.equal((await pasStylist.patch(`/api/posts/${mine.id}`, { body: 'hijack' })).status, 403);
  assert.equal((await pasStylist.del(`/api/posts/${mine.id}`)).status, 403);
  const edited = await stylist.patch(`/api/posts/${mine.id}`, { body: 'Second draft' });
  assert.equal(edited.body.post.body, 'Second draft');
  assert.ok(edited.body.post.edited_at);

  let r = await pasStylist.post(`/api/posts/${mine.id}/react`, { kind: 'clap' });
  assert.deepEqual(r.body, { reactions: { like: 0, clap: 1, love: 0, fire: 0 }, my_reaction: 'clap' });
  r = await pasStylist.post(`/api/posts/${mine.id}/react`, { kind: 'love' });
  assert.equal(r.body.reactions.clap, 0); assert.equal(r.body.reactions.love, 1);
  r = await pasStylist.post(`/api/posts/${mine.id}/react`, { kind: null });
  assert.equal(r.body.my_reaction, null); assert.equal(r.body.reactions.love, 0);
  assert.equal((await pasStylist.post(`/api/posts/${mine.id}/react`, { kind: 'angry' })).status, 400);

  const c = await pasStylist.post(`/api/posts/${mine.id}/comments`, { body: 'Nice one' });
  assert.equal(c.status, 200);
  assert.equal(c.body.comment.can_delete, true);
  assert.equal((await stylist.del(`/api/comments/${c.body.comment.id}`)).status, 403, 'post authors cannot delete other people\'s comments');
  assert.equal((await pasStylist.del(`/api/comments/${c.body.comment.id}`)).status, 200);
  assert.equal((await stylist.get(`/api/posts/${mine.id}/comments`)).body.items.length, 0);

  const ann = (await exec.post('/api/posts', { kind: 'announcement', body: 'Please read.', audience_type: 'company' })).body.post;
  const before = (await stylist.get('/api/feed')).body.items.find((x) => x.id === ann.id);
  assert.equal(before.requires_read, true); assert.equal(before.read_by_me, false);
  assert.ok((await stylist.get('/api/me/todo')).body.items.some((i) => i.kind === 'announcement' && i.title === 'Please read.'));
  await stylist.post(`/api/posts/${ann.id}/read`);
  assert.equal((await stylist.get('/api/feed')).body.items.find((x) => x.id === ann.id).read_by_me, true);

  assert.equal((await stylist.del(`/api/posts/${mine.id}`)).status, 200);
  assert.equal((await feedIds(stylist)).includes(mine.id), false);
});

test('moderation: reports go to HR and admins, removal is audited', async () => {
  const bad = (await pasStylist.post('/api/posts', { kind: 'post', body: 'Something unkind', audience_type: 'company' })).body.post;
  assert.equal((await stylist.post('/api/reports', { post_id: bad.id })).status, 400);
  assert.equal((await stylist.post('/api/reports', { reason: 'no target' })).status, 400);
  assert.equal((await stylist.post('/api/reports', { post_id: bad.id, reason: 'Unkind to a teammate' })).status, 200);
  assert.equal((await manager.get('/api/admin/reports')).status, 403);
  const queue = await hr.get('/api/admin/reports');
  const rep = queue.body.items.find((x) => x.post && x.post.id === bad.id);
  assert.ok(rep && rep.reporter.id === stylist.me.id);
  assert.equal((await hr.post(`/api/admin/reports/${rep.id}/resolve`, { action: 'remove' })).status, 200);
  assert.equal((await feedIds(exec)).includes(bad.id), false);
  assert.ok(p.db.prepare("SELECT 1 FROM audit_log WHERE action = 'report.remove' AND target_id = ?").get(rep.id));
  const other = (await pasStylist.post('/api/posts', { kind: 'post', body: 'Borderline', audience_type: 'company' })).body.post;
  assert.equal((await admin.del(`/api/posts/${other.id}`)).status, 200, 'moderators can remove any post');
  assert.ok(p.db.prepare("SELECT 1 FROM audit_log WHERE action = 'post.removed' AND target_id = ?").get(other.id));
});

test('HR inquiries are private to the author, HR and admins', async () => {
  const made = await stylist.post('/api/hr/inquiries', { category: 'pay', subject: 'Missing hours', body: 'My stub is short four hours.' });
  assert.equal(made.status, 200);
  const id = made.body.inquiry.id;
  // Not the manager, not the district leader, not executives, not a teammate.
  for (const c of [manager, dl, exec, pasStylist]) {
    assert.equal((await c.get(`/api/hr/inquiries/${id}`)).status, 404);
    assert.equal((await c.post(`/api/hr/inquiries/${id}/messages`, { body: 'peek' })).status, 404);
    assert.equal((await c.get('/api/hr/inquiries')).body.items.some((q) => q.id === id), false);
  }
  assert.equal((await exec.get('/api/hr/inquiries')).body.items.length, 0, 'executives see only their own');
  assert.equal((await stylist.get(`/api/hr/inquiries/${id}`)).status, 200);
  assert.ok((await hr.get('/api/hr/inquiries')).body.items.some((q) => q.id === id));
  assert.ok((await admin.get('/api/hr/inquiries')).body.items.some((q) => q.id === id));
  assert.equal((await stylist.post(`/api/hr/inquiries/${id}/messages`, { status_to: 'resolved' })).status, 403);
  const reply = await hr.post(`/api/hr/inquiries/${id}/messages`, { body: 'Looking into it today.' });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.inquiry.status, 'in_progress');
  assert.equal(reply.body.inquiry.assignee.id, hr.me.id);
  assert.equal(reply.body.messages.length, 1);
  // The notification to the stylist must not carry the content of the inquiry.
  const note = p.db.prepare("SELECT title, body FROM notifications WHERE user_id = ? AND kind = 'hr' ORDER BY id DESC").get(stylist.me.id);
  assert.equal(note.body, null);
  const hrNote = p.db.prepare("SELECT title, body FROM notifications WHERE user_id = ? AND kind = 'hr' ORDER BY id DESC").get(hr.me.id);
  assert.doesNotMatch(`${hrNote.title} ${hrNote.body}`, /Missing hours|short four/);
  assert.equal((await stylist.post(`/api/hr/inquiries/${id}/messages`, { body: 'Thank you!', status_to: 'closed' })).status, 200);
  const audited = p.db.prepare("SELECT action FROM audit_log WHERE target_type = 'hr_inquiry' AND target_id = ?").all(id).map((a) => a.action);
  assert.ok(audited.includes('hr.inquiry_created') && audited.includes('hr.inquiry_reply'));
  assert.equal((await stylist.post('/api/hr/inquiries', { category: 'gossip', subject: 'x', body: 'y' })).status, 400);
  // Admin overview hides the HR count from people without the HR inbox... and HR data never appears in search.
  assert.equal(/Missing hours/.test(JSON.stringify((await manager.get('/api/search?q=Missing')).body)), false);
});

test('resources, acknowledgements and the to-do list', async () => {
  const list = await stylist.get('/api/resources?section=policies');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0 && list.body.items.every((r) => !('body_md' in r)));
  const need = list.body.items.find((r) => r.requires_ack);
  const todoBefore = (await stylist.get('/api/me/todo')).body.items;
  assert.ok(todoBefore.some((i) => i.kind === 'ack' && i.link === `/standards/${need.id}`));
  const full = await stylist.get(`/api/resources/${need.id}`);
  assert.ok(full.body.resource.body_md.length > 10);
  assert.equal(full.body.resource.acknowledged_at, null);
  const ack = await stylist.post(`/api/resources/${need.id}/ack`);
  assert.ok(ack.body.acknowledged_at);
  assert.equal((await stylist.post(`/api/resources/${need.id}/ack`)).body.acknowledged_at, ack.body.acknowledged_at, 'acknowledging twice keeps the first time');
  assert.equal((await stylist.get('/api/me/todo')).body.items.some((i) => i.link === `/standards/${need.id}`), false);
  assert.equal((await stylist.get('/api/resources?section=nope')).status, 400);
});

test('promos, videos, events, notifications', async () => {
  const active = await stylist.get('/api/promos');
  assert.ok(active.body.items.length >= 1);
  assert.equal((await stylist.get(`/api/promos/${active.body.items[0].id}`)).status, 200);
  assert.ok((await stylist.get('/api/promos?status=upcoming')).body.items.length >= 0);
  const vids = await stylist.get('/api/videos');
  assert.ok(vids.body.items.length >= 1);
  const v0 = vids.body.items[0];
  assert.equal((await stylist.post(`/api/videos/${v0.id}/view`)).body.views, v0.views + 1);
  assert.ok((await stylist.get('/api/events')).body.items.length >= 1);
  const n = await stylist.get('/api/notifications');
  assert.ok(n.body.items.length >= 1 && n.body.unread >= 1);
  assert.equal((await stylist.post('/api/notifications/read', { ids: 'all' })).body.unread, 0);
  assert.equal((await stylist.get('/api/auth/me')).body.unread, 0);
});

test('uploads: type and magic bytes are checked, files are served only to signed-in people', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
  const up = (c, body, type) => c.put('/api/uploads', body, { raw: true, headers: { 'content-type': type } });
  const ok = await up(stylist, png, 'image/png');
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  assert.equal((await up(stylist, jpg, 'image/jpeg')).status, 200);
  assert.equal((await up(stylist, Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml')).status, 400, 'unsupported type');
  assert.equal((await up(stylist, Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64)), 'image/png')).status, 400, 'bytes do not match');
  assert.equal((await up(stylist, jpg, 'image/png')).status, 400, 'declared type must match the bytes');
  assert.equal((await up(stylist, Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024 + 10)]), 'image/png')).status, 400, 'over 6 MB');
  assert.equal((await up(p.client(), png, 'image/png')).status, 401);

  const got = await stylist.get(ok.body.url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await p.client().get(ok.body.url)).status, 401);
  assert.equal((await stylist.get('/uploads/..%2F..%2Fportal.db')).status, 404);
  assert.equal((await stylist.get('/uploads/' + 'a'.repeat(32) + '.png')).status, 404);
  assert.equal(fs.readdirSync(path.join(p.dir, 'uploads')).length, 2);
  // An uploaded photo can be attached to a post and used as an avatar.
  assert.equal((await stylist.post('/api/posts', { kind: 'win', body: 'Fresh fade', audience_type: 'company', image_url: ok.body.url })).status, 200);
  assert.equal((await stylist.patch('/api/me', { avatar_url: ok.body.url })).body.user.avatar_url, ok.body.url);
});

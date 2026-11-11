// Home: the front door. Feed in the middle, recognition and celebrations on the right.

import { h, clear, mount, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { money, pct, num, timeAgo, dateShort, dateLong, greeting, roleLabel, whereLabel, plural } from '../core/format.js';

const REACTIONS = [
  { kind: 'like', icon: 'thumb', label: 'Like' },
  { kind: 'clap', icon: 'clap', label: 'Applaud' },
  { kind: 'love', icon: 'heart', label: 'Love' },
  { kind: 'fire', icon: 'flame', label: 'On fire' },
];
const KIND_LABEL = { post: 'Post', shoutout: 'Shout-out', win: 'Win', announcement: 'Announcement' };

let cleanup = [];

/* ---------- a single post (also used on profile pages) ---------- */

function valueLabel(settings, key) {
  const found = (settings?.values || []).find((v) => v.key === key);
  return found ? found.label : null;
}

function targetLink(t) {
  const href = t.type === 'user' ? `#/people/${t.id}` : t.type === 'salon' ? `#/salon/${t.id}` : null;
  return href ? h('a', { class: 'post-target', href }, t.label) : h('span', { class: 'post-target' }, t.label);
}

function joinNodes(nodes) {
  const out = [];
  nodes.forEach((n, i) => {
    if (i > 0) out.push(i === nodes.length - 1 ? ' and ' : ', ');
    out.push(n);
  });
  return out;
}

function commentRow(c, onDeleted) {
  const row = h('div', { class: 'comment' },
    ui.avatar(c.author, 30),
    h('div', { class: 'comment-bubble' },
      h('div', { class: 'comment-head' },
        h('a', { class: 't-strong', href: `#/people/${c.author?.id}` }, c.author?.name || 'Team member'),
        h('span', { class: 't-faint t-xs' }, whereLabel(c.author)),
        h('span', { class: 't-faint t-xs' }, timeAgo(c.created_at))),
      h('div', { class: 'comment-body' }, c.body)),
    c.can_delete ? h('button', {
      class: 'comment-del', type: 'button', 'aria-label': 'Delete comment',
      onClick: async () => {
        if (!(await ui.confirm({ title: 'Delete this comment?', body: 'It will be removed for everyone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
        try {
          await api.del(`/comments/${c.id}`);
          row.remove();
          onDeleted?.();
        } catch (err) { ui.toast(err.message, 'bad'); }
      },
    }, ui.icon('x', 14)) : null);
  return row;
}

export function postCard(post, ctx, { onDeleted } = {}) {
  const settings = ctx.settings;
  const el = h('article', { class: ['card', 'post', `post-${post.kind}`], dataset: { id: post.id } });

  // header
  const moreBtn = h('button', { class: 'icon-btn post-more', type: 'button', 'aria-label': 'Post options' }, ui.icon('more', 18));
  moreBtn.addEventListener('click', () => {
    ui.menu(moreBtn, [
      post.can_edit ? { label: 'Edit', icon: 'edit', onClick: editPost } : null,
      post.can_delete ? { label: 'Delete', icon: 'trash', onClick: deletePost } : null,
      { label: 'Report to home office', icon: 'flag', onClick: reportPost },
    ]);
  });
  const audience = post.audience && post.audience.type !== 'company' ? post.audience.label : null;
  const head = h('header', { class: 'post-head' },
    h('a', { href: `#/people/${post.author?.id}`, 'aria-hidden': 'true', tabIndex: -1 }, ui.avatar(post.author, 44)),
    h('div', { class: 'post-who' },
      h('div', { class: 'post-name' },
        h('a', { href: `#/people/${post.author?.id}` }, post.author?.name || 'Team member'),
        h('span', { class: 'post-role' }, post.author?.title || roleLabel(post.author?.role))),
      h('div', { class: 'post-where' },
        ui.icon('pin', 13),
        h('span', null, whereLabel(post.author) || 'Home office'),
        h('span', { class: 'post-sep' }, '·'),
        h('time', { datetime: post.created_at, title: new Date(post.created_at).toLocaleString() }, timeAgo(post.created_at)),
        post.edited_at ? h('span', { class: 't-faint' }, '· edited') : null,
        audience ? h('span', { class: 'post-aud' }, audience) : null)),
    moreBtn);

  // kind banner
  let banner = null;
  if (post.kind === 'shoutout' && post.targets?.length) {
    const values = [...new Set(post.targets.map((t) => valueLabel(settings, t.value_key)).filter(Boolean))];
    banner = h('div', { class: 'post-banner post-banner-shout' },
      h('span', { class: 'post-banner-icon' }, ui.icon('star', 16)),
      h('div', { class: 'grow' },
        h('div', { class: 'post-banner-line' }, 'Shout-out to ', joinNodes(post.targets.map(targetLink))),
        values.length ? h('div', { class: 'post-values' }, values.map((v) => ui.badge(v, 'brand'))) : null));
  } else if (post.kind === 'announcement') {
    banner = h('div', { class: 'post-banner post-banner-ann' },
      h('span', { class: 'post-banner-icon' }, ui.icon('megaphone', 16)),
      h('div', { class: 'post-banner-line grow' }, 'Announcement', post.audience?.label ? ` for ${post.audience.label}` : ''),
      post.pinned ? ui.badge('Pinned', 'dark') : null);
  } else if (post.kind === 'win') {
    banner = h('div', { class: 'post-banner post-banner-win' },
      h('span', { class: 'post-banner-icon' }, ui.icon('trophy', 16)),
      h('div', { class: 'post-banner-line grow' }, 'Win'));
  }

  const body = h('div', { class: 'post-body' }, post.body);
  const image = post.image_url ? h('div', { class: 'post-image media' }, h('img', { src: post.image_url, alt: '', loading: 'lazy' })) : null;

  // read receipt
  let readRow = null;
  if (post.requires_read) {
    readRow = h('div', { class: 'post-read' });
    const paintRead = () => {
      mount(readRow, post.read_by_me
        ? h('span', { class: 'row gap-2 t-good t-sm t-strong' }, ui.icon('check', 16), 'You have read this')
        : [h('span', { class: 't-sm t-muted grow' }, 'Please confirm once you have read this.'),
          ui.button("I've read this", {
            variant: 'primary', size: 'sm', icon: 'check',
            onClick: async () => {
              try {
                await api.post(`/posts/${post.id}/read`);
                post.read_by_me = true;
                paintRead();
              } catch (err) { ui.toast(err.message, 'bad'); }
            },
          })]);
    };
    paintRead();
  }

  // reactions
  const reactions = { like: 0, clap: 0, love: 0, fire: 0, ...(post.reactions || {}) };
  let mine = post.my_reaction || null;
  const bar = h('div', { class: 'post-actions' });
  const commentBtn = h('button', { class: 'react', type: 'button' });
  const paintBar = (popKind) => {
    clear(bar);
    for (const r of REACTIONS) {
      const btn = h('button', {
        class: ['react', mine === r.kind && 'is-on', popKind === r.kind && 'is-pop'], type: 'button',
        'aria-pressed': String(mine === r.kind), 'aria-label': `${r.label}${reactions[r.kind] ? `, ${reactions[r.kind]}` : ''}`, title: r.label,
        onClick: () => react(r.kind),
      }, ui.icon(r.icon, 18), reactions[r.kind] ? h('span', { class: 't-num' }, String(reactions[r.kind])) : null);
      bar.appendChild(btn);
    }
    bar.appendChild(h('span', { class: 'grow' }));
    mount(commentBtn, [ui.icon('comment', 18), h('span', null, post.comment_count ? plural(post.comment_count, 'comment') : 'Comment')]);
    bar.appendChild(commentBtn);
  };
  async function react(kind) {
    const prev = mine;
    const next = prev === kind ? null : kind;
    if (prev) reactions[prev] = Math.max(0, reactions[prev] - 1);
    if (next) reactions[next] += 1;
    mine = next;
    paintBar(next);
    try {
      await api.post(`/posts/${post.id}/react`, { kind: next });
    } catch (err) {
      if (next) reactions[next] = Math.max(0, reactions[next] - 1);
      if (prev) reactions[prev] += 1;
      mine = prev;
      paintBar();
      ui.toast(err.message, 'bad');
    }
  }

  // comments
  const list = h('div', { class: 'comment-list' });
  const shown = [...(post.latest_comments || [])];
  let loadedAll = (post.comment_count || 0) <= shown.length;
  const moreComments = h('button', { class: 't-link t-sm comment-more', type: 'button' });
  const onCommentDeleted = () => { post.comment_count = Math.max(0, (post.comment_count || 1) - 1); paintBar(); };
  const paintComments = () => {
    clear(list);
    if (!loadedAll) {
      moreComments.textContent = `View all ${post.comment_count} comments`;
      list.appendChild(moreComments);
    }
    for (const c of shown) list.appendChild(commentRow(c, onCommentDeleted));
  };
  moreComments.addEventListener('click', async () => {
    moreComments.textContent = 'Loading…';
    try {
      const r = await api.get(`/posts/${post.id}/comments`);
      shown.splice(0, shown.length, ...(r.items || r.comments || []));
      loadedAll = true;
      paintComments();
    } catch (err) {
      ui.toast(err.message, 'bad');
      paintComments();
    }
  });
  const input = h('input', { class: 'input comment-input', type: 'text', placeholder: 'Write a comment', maxLength: 1000, 'aria-label': 'Write a comment' });
  const send = h('button', { class: 'icon-btn comment-send', type: 'submit', 'aria-label': 'Send comment' }, ui.icon('send', 18));
  const commentForm = h('form', { class: 'comment-form' }, ui.avatar(ctx.user, 30), input, send);
  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      const r = await api.post(`/posts/${post.id}/comments`, { body: text });
      const c = r.comment || r;
      shown.push(c);
      post.comment_count = (post.comment_count || 0) + 1;
      input.value = '';
      paintComments();
      paintBar();
      list.lastElementChild?.classList.add('is-new');
    } catch (err) {
      ui.toast(err.message, 'bad');
    } finally {
      input.disabled = false;
    }
  });
  commentBtn.addEventListener('click', () => input.focus());

  async function editPost() {
    const m = ui.modal({
      title: 'Edit post',
      body: ui.form({
        fields: [{ label: 'Your post', name: 'body', type: 'textarea', value: post.body, rows: 6, required: true, maxLength: 4000 }],
        submitLabel: 'Save',
        onCancel: () => m.close(),
        onSubmit: async (v) => {
          if (!v.body) throw new Error('Write something first.');
          const r = await api.patch(`/posts/${post.id}`, { body: v.body });
          post.body = r.post?.body ?? v.body;
          body.textContent = post.body;
          m.close();
          ui.toast('Post updated.', 'good');
        },
      }),
    });
  }
  async function deletePost() {
    if (!(await ui.confirm({ title: 'Delete this post?', body: 'It will be removed from the feed for everyone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await api.del(`/posts/${post.id}`);
      el.classList.add('is-leaving');
      setTimeout(() => { el.remove(); onDeleted?.(post); }, 200);
    } catch (err) { ui.toast(err.message, 'bad'); }
  }
  function reportPost() {
    const m = ui.modal({
      title: 'Report this post',
      size: 'sm',
      body: ui.form({
        fields: [{ label: 'What is the concern?', name: 'reason', type: 'textarea', rows: 3, required: true, maxLength: 500, hint: 'Only the home office team sees this report.' }],
        submitLabel: 'Send report',
        onCancel: () => m.close(),
        onSubmit: async (v) => {
          if (!v.reason) throw new Error('Tell us briefly what the concern is.');
          await api.post('/reports', { post_id: post.id, reason: v.reason });
          m.close();
          ui.toast('Thanks. The home office team will take a look.', 'good');
        },
      }),
    });
  }

  paintBar();
  paintComments();
  el.append(head);
  if (banner) el.append(banner);
  el.append(body);
  if (image) el.append(image);
  if (readRow) el.append(readRow);
  el.append(bar, h('div', { class: 'post-comments' }, list, commentForm));
  return el;
}

/* ---------- composer ---------- */

function composer(ctx, onPosted) {
  const { user, settings } = ctx;
  const canAnnounce = ctx.can('post.announce');
  const modes = [
    { key: 'post', label: 'Post' },
    { key: 'shoutout', label: 'Shout-out' },
    { key: 'win', label: 'Win' },
    ...(canAnnounce ? [{ key: 'announcement', label: 'Announcement' }] : []),
  ];
  const PLACEHOLDER = {
    post: `What's happening at ${user.salon?.name || 'the salons'} today?`,
    shoutout: 'Who went above and beyond? Tell the team what they did.',
    win: 'Share a win: a great guest moment, a record day, a goal hit.',
    announcement: 'Write the announcement. Keep it short and clear.',
  };
  const st = { mode: 'post', targets: [], value: null, image: null, audience: 'company', pinDays: 3, open: false };

  const text = h('textarea', { class: 'composer-text', rows: 1, maxLength: 4000, placeholder: PLACEHOLDER.post, 'aria-label': 'Write a post' });
  const grow = () => { text.style.height = 'auto'; text.style.height = `${Math.min(320, Math.max(text.scrollHeight, st.open ? 84 : 44))}px`; };
  text.addEventListener('input', grow);
  text.addEventListener('focus', () => { if (!st.open) { st.open = true; el.classList.add('is-open'); grow(); } });

  // shout-out picker
  const chips = h('div', { class: 'composer-chips' });
  const pickInput = h('input', { class: 'input', type: 'search', placeholder: 'Search a teammate or a salon', autocomplete: 'off', 'aria-label': 'Who are you recognising?' });
  const pickResults = h('div', { class: 'composer-results card', hidden: true });
  const paintChips = () => mount(chips, st.targets.map((t) => h('span', { class: 'chip is-on' },
    t.label,
    h('button', { type: 'button', 'aria-label': `Remove ${t.label}`, onClick: () => { st.targets = st.targets.filter((x) => x !== t); paintChips(); } }, ui.icon('x', 12)))));
  const addTarget = (t) => {
    if (!st.targets.some((x) => x.type === t.type && x.id === t.id) && st.targets.length < 8) st.targets.push(t);
    pickInput.value = '';
    pickResults.hidden = true;
    paintChips();
    pickInput.focus();
  };
  const search = debounce(async () => {
    const q = pickInput.value.trim();
    if (q.length < 2) { pickResults.hidden = true; return; }
    try {
      const r = await api.get('/mentions', { q });
      const rows = [
        ...(r.users || []).filter((u) => u.id !== user.id).map((u) => h('button', { type: 'button', onClick: () => addTarget({ type: 'user', id: u.id, label: u.name }) }, ui.userChip(u, { size: 30, link: false }))),
        ...(r.salons || []).map((s) => h('button', { type: 'button', onClick: () => addTarget({ type: 'salon', id: s.id, label: `${s.name} team` }) },
          h('span', { class: 'row' }, ui.icon('store', 18), h('span', null, `${s.name} team`, h('span', { class: 't-muted t-sm' }, `  #${s.salon_number}`))))),
      ];
      mount(pickResults, rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'card-pad t-sm t-muted' }, 'No one found by that name.'));
      pickResults.hidden = false;
    } catch { pickResults.hidden = true; }
  }, 200);
  pickInput.addEventListener('input', search);
  pickInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') pickResults.hidden = true; });

  const valueChips = h('div', { class: 'composer-chips' });
  const paintValues = () => mount(valueChips, (settings?.values || []).map((v) => h('button', {
    class: ['chip', st.value === v.key && 'is-on'], type: 'button', 'aria-pressed': String(st.value === v.key), title: v.meaning || v.label,
    onClick: () => { st.value = st.value === v.key ? null : v.key; paintValues(); },
  }, v.label)));
  const shoutPanel = h('div', { class: 'composer-panel', hidden: true },
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Who are you recognising?'), chips, h('div', { class: 'composer-pick' }, pickInput, pickResults)),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'What did they show?'), valueChips));

  // announcement options
  const audOptions = [
    ['admin', 'executive', 'hr'].includes(user.role) ? { value: 'company', label: 'Everyone' } : null,
    user.district ? { value: 'district', label: `${user.district.name}` } : null,
    user.salon ? { value: 'salon', label: `${user.salon.name} only` } : null,
  ].filter(Boolean);
  const audField = ui.field({ label: 'Who should see it', name: 'aud', type: 'select', options: audOptions.length ? audOptions : [{ value: 'company', label: 'Everyone' }] });
  const pinField = ui.field({ label: 'Pin to the top for', name: 'pin', type: 'select', value: '3', options: [{ value: '0', label: 'Do not pin' }, { value: '1', label: '1 day' }, { value: '3', label: '3 days' }, { value: '7', label: '1 week' }, { value: '14', label: '2 weeks' }] });
  const annPanel = h('div', { class: 'composer-panel composer-panel-row', hidden: true }, audField, pinField);

  // normal audience
  const shareSel = user.salon ? h('select', { class: 'select composer-share', 'aria-label': 'Share with' },
    h('option', { value: 'company' }, 'Everyone'),
    h('option', { value: 'salon' }, `${user.salon.name} only`)) : null;

  // photo
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = h('div', { class: 'composer-preview', hidden: true });
  const photoBtn = ui.button('Photo', { variant: 'ghost', size: 'sm', icon: 'image', onClick: () => file.click() });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    photoBtn.classList.add('is-busy');
    try {
      const r = await api.upload(f);
      st.image = r.url;
      mount(preview, [h('img', { src: r.url, alt: 'Photo to post' }),
        h('button', { class: 'icon-btn composer-preview-x', type: 'button', 'aria-label': 'Remove photo', onClick: () => { st.image = null; preview.hidden = true; clear(preview); } }, ui.icon('x', 16))]);
      preview.hidden = false;
    } catch (err) {
      ui.toast(err.message, 'bad');
    } finally {
      photoBtn.classList.remove('is-busy');
    }
  });

  const setMode = (mode) => {
    st.mode = mode;
    text.placeholder = PLACEHOLDER[mode];
    shoutPanel.hidden = mode !== 'shoutout';
    annPanel.hidden = mode !== 'announcement';
    if (shareSel) shareSel.hidden = mode === 'announcement';
    el.dataset.mode = mode;
    submit.firstChild.textContent = mode === 'shoutout' ? 'Send shout-out' : mode === 'announcement' ? 'Publish' : 'Post';
    if (mode === 'shoutout') paintValues();
  };
  const submit = h('button', { class: 'btn btn-brand btn-sm', type: 'button' }, 'Post');
  const error = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const fail = (msg) => { error.textContent = msg; error.hidden = false; };
  submit.addEventListener('click', async () => {
    error.hidden = true;
    const body = text.value.trim();
    if (!body) return fail('Write a few words first.');
    if (st.mode === 'shoutout' && !st.targets.length) return fail('Choose who you are recognising.');
    const payload = { kind: st.mode, body, audience_type: 'company', audience_id: null };
    if (st.image) payload.image_url = st.image;
    if (st.mode === 'announcement') {
      const aud = audField.input.value;
      payload.audience_type = aud;
      payload.audience_id = aud === 'district' ? user.district?.id : aud === 'salon' ? user.salon?.id : null;
      const days = Number(pinField.input.value);
      if (days) payload.pin_days = days;
    } else if (shareSel && shareSel.value === 'salon') {
      payload.audience_type = 'salon';
      payload.audience_id = user.salon.id;
    }
    if (st.mode === 'shoutout') payload.targets = st.targets.map((t) => ({ type: t.type, id: t.id, value_key: st.value }));
    submit.classList.add('is-busy');
    try {
      const r = await api.post('/posts', payload);
      text.value = '';
      st.targets = [];
      st.value = null;
      st.image = null;
      preview.hidden = true;
      clear(preview);
      paintChips();
      st.open = false;
      el.classList.remove('is-open');
      segHost.replaceChildren(ui.segmented(modes, 'post', setMode));
      setMode('post');
      grow();
      onPosted(r.post || r);
      ui.toast(payload.kind === 'shoutout' ? 'Shout-out sent. Nice one.' : 'Posted.', 'good');
    } catch (err) {
      fail(err.message);
    } finally {
      submit.classList.remove('is-busy');
    }
  });

  const segHost = h('div', { class: 'composer-modes' }, ui.segmented(modes, 'post', setMode));
  const el = h('section', { class: 'card composer', 'aria-label': 'Write a post', dataset: { mode: 'post' } },
    h('div', { class: 'composer-top' }, ui.avatar(user, 44), text),
    h('div', { class: 'composer-more' },
      segHost, shoutPanel, annPanel, preview, error,
      h('div', { class: 'composer-foot' }, photoBtn, file, h('span', { class: 'grow' }), shareSel, submit)));
  const onDoc = (e) => { if (!pickResults.hidden && !shoutPanel.contains(e.target)) pickResults.hidden = true; };
  document.addEventListener('mousedown', onDoc);
  cleanup.push(() => document.removeEventListener('mousedown', onDoc));
  return el;
}

/* ---------- header strips ---------- */

function statTile(label, value, format, extra) {
  const s = ui.stat({ label, value: '', ...extra });
  if (value === null || value === undefined) s.valueEl.textContent = '–';
  else ui.countUp(s.valueEl, value, format);
  return s;
}

async function quickStats(ctx) {
  const { user } = ctx;
  const host = h('section', { class: 'card home-stats' }, ui.skeleton('stat'));
  const salonRole = !!user.salon;
  (async () => {
    try {
      if (salonRole && (user.role === 'stylist' || user.role === 'salon_manager')) {
        const s = await api.get('/me/stats');
        const tiles = [
          statTile('My salon this month', s.net_sales_c ?? s.service_c, (n) => money(n)),
          statTile('Guests', s.guests, (n) => num(Math.round(n))),
          statTile('Product share', s.product_pct, (n) => pct(n)),
          statTile('Sales per hour', s.srph_c, (n) => money(n, { cents: true })),
        ];
        const side = h('div', { class: 'home-stats-side' },
          s.rank_salon ? h('div', null, h('div', { class: 't-eyebrow' }, 'In my salon'), h('div', { class: 'home-rank t-num' }, `#${s.rank_salon}`)) : null,
          s.rank_company ? h('div', null, h('div', { class: 't-eyebrow' }, 'Salon rank'), h('div', { class: 'home-rank t-num' }, `#${s.rank_company}`, s.of_company ? h('small', null, ` of ${s.of_company}`) : null)) : null,
          s.trend?.length > 1 ? h('div', { class: 'hide-mobile' }, h('div', { class: 't-eyebrow' }, 'Last 14 days'), ui.sparkline(s.trend.slice(-14).map((d) => d.service_c), { w: 120, h: 34, tone: 'brand' })) : null);
        mount(host, [h('div', { class: 'home-stats-grid' }, tiles), side,
          s.shoutouts_received || s.streak_days ? h('div', { class: 'home-stats-foot' },
            s.shoutouts_received ? h('span', { class: 'row gap-2' }, ui.icon('star', 15), `${plural(s.shoutouts_received, 'shout-out')} received this month`) : null,
            s.streak_days ? h('span', { class: 'row gap-2' }, ui.icon('flame', 15), `${s.streak_days} day streak`) : null) : null]);
      } else if (ctx.can('kpi.company') || user.role === 'district_leader') {
        // 'company' level is already limited to the caller's scope, so a district leader gets their district.
        const level = ctx.can('kpi.company') ? 'company' : 'district';
        const o = await api.get('/kpi/overview', { level: 'company' });
        const t = o.totals || {};
        const tiles = [
          statTile(level === 'company' ? 'Company net sales this month' : 'District net sales this month', t.mtd?.net_sales_c, (n) => money(n, { compact: true }), { delta: t.wow?.net_sales_pct, hint: 'vs last week' }),
          statTile('Pace to goal', t.goal?.pace_pct, (n) => pct(n), { tone: (t.goal?.pace_pct ?? 0) >= 100 ? 'good' : undefined }),
          statTile('Guests', t.mtd?.guests, (n) => num(Math.round(n)), { delta: t.wow?.guests_pct, hint: 'vs last week' }),
          statTile('Average ticket', t.mtd?.atv_c, (n) => money(n, { cents: true }), { delta: t.wow?.atv_pct, hint: 'vs last week' }),
        ];
        mount(host, [h('div', { class: 'home-stats-grid' }, tiles),
          h('div', { class: 'home-stats-foot' },
            h('span', { class: 't-muted' }, o.updated_through ? `Numbers through ${dateShort(o.updated_through)}` : ''),
            h('a', { class: 't-link', href: '#/company' }, level === 'company' ? 'Open company view' : 'Open my district'))]);
      } else {
        host.remove();
      }
    } catch {
      host.remove();
    }
  })();
  return host;
}

function todoStrip() {
  const host = h('div', { class: 'home-todo', hidden: true });
  const ICON = { ack: 'book', announcement: 'megaphone', checklist: 'checklist', training: 'play' };
  api.get('/me/todo').then((r) => {
    const items = r.items || [];
    if (!items.length) return;
    mount(host, [
      h('div', { class: 't-eyebrow home-todo-label' }, `To do · ${items.length}`),
      h('div', { class: 'home-todo-row' }, items.slice(0, 8).map((t) => h('a', { class: 'todo', href: t.link ? `#${t.link.replace(/^#/, '')}` : '#/' },
        h('span', { class: 'todo-icon' }, ui.icon(ICON[t.kind] || 'check', 16)),
        h('span', { class: 'todo-text' }, h('span', { class: 't-strong t-clip' }, t.title), t.due_on ? h('span', { class: 't-xs t-muted' }, `Due ${dateShort(t.due_on)}`) : null),
        ui.icon('chevronRight', 14)))),
    ]);
    host.hidden = false;
  }).catch(() => {});
  return host;
}

/* ---------- right rail ---------- */

function rail(ctx) {
  const host = h('aside', { class: 'rail stack', 'aria-label': 'Highlights' }, ui.skeleton('card', 2));
  (async () => {
    const [side, promos] = await Promise.all([
      api.get('/feed/sidebar').catch(() => ({})),
      api.get('/promos', { status: 'active' }).catch(() => ({ items: [] })),
    ]);
    const blocks = [];
    const pinned = side.pinned || [];
    if (pinned.length) {
      blocks.push(ui.card({ title: 'Pinned', flush: true },
        h('div', { class: 'list' }, pinned.slice(0, 3).map((p) => h('div', { class: 'rail-pin' },
          h('span', { class: 'rail-pin-icon' }, ui.icon('megaphone', 16)),
          h('div', { class: 'grow' },
            h('div', { class: 't-sm t-clamp-3' }, p.body),
            h('div', { class: 't-xs t-muted' }, `${p.author?.name || 'Home office'} · ${timeAgo(p.created_at)}`)))))));
    }
    const top = side.top_recognized || [];
    blocks.push(ui.card({ title: 'Most recognized this month', flush: true },
      top.length
        ? h('div', { class: 'list' }, top.slice(0, 5).map((t, i) => h('a', { href: `#/people/${t.user?.id}` },
          h('span', { class: 'rank', dataset: { top: i + 1 } }, String(i + 1)),
          h('span', { class: 'grow' }, ui.userChip(t.user, { size: 34, link: false })),
          h('span', { class: 'row gap-1 t-num t-strong' }, ui.icon('star', 14), String(t.count)))))
        : h('div', { class: 'card-pad t-sm t-muted' }, 'No shout-outs yet this month. Be the first to recognise a teammate.')));
    const cel = side.celebrations || [];
    if (cel.length) {
      blocks.push(ui.card({ title: 'Celebrations', flush: true },
        h('div', { class: 'list' }, cel.slice(0, 6).map((c) => h('a', { href: `#/people/${c.user?.id}` },
          h('span', { class: ['cel-icon', c.kind === 'birthday' ? 'is-bday' : 'is-anniv'] }, ui.icon(c.kind === 'birthday' ? 'gift' : 'sparkle', 16)),
          h('span', { class: 'grow' }, ui.userChip(c.user, { size: 34, link: false, sub: c.label || (c.kind === 'birthday' ? 'Birthday' : 'Work anniversary') })),
          h('span', { class: 't-xs t-muted' }, c.on ? dateShort(c.on) : ''))))));
    }
    const promo = (promos.items || [])[0];
    if (promo) {
      blocks.push(h('a', { class: 'card card-link rail-promo', href: `#/promos/${promo.id}` },
        promo.image_url ? h('div', { class: 'media media-16x9' }, h('img', { src: promo.image_url, alt: '', loading: 'lazy' })) : null,
        h('div', { class: 'card-pad' },
          h('div', { class: 'row row-between' }, h('span', { class: 't-eyebrow' }, 'Running now'), promo.ends_on ? h('span', { class: 't-xs t-muted' }, `Ends ${dateShort(promo.ends_on)}`) : null),
          h('h3', { class: 'rail-promo-title' }, promo.title),
          promo.summary ? h('p', { class: 't-sm t-muted t-clamp-2' }, promo.summary) : null)));
    }
    blocks.push(ui.card({ title: 'Quick links', flush: true },
      h('div', { class: 'list' }, [
        ['#/operations', 'checklist', "Today's checklists"],
        ['#/tube', 'play', 'Training videos'],
        ['#/standards', 'book', 'Brand standards'],
        ['#/hr', 'lifebuoy', ctx.can('hr.inbox') ? 'HR inbox' : 'Ask HR a question'],
      ].map(([href, ic, label]) => h('a', { href }, ui.icon(ic, 18), h('span', { class: 'grow' }, label), ui.icon('chevronRight', 14))))));
    mount(host, blocks.map((b, i) => ui.reveal(b, i * 60)));
  })();
  return host;
}

/* ---------- feed ---------- */

function feed(ctx) {
  const { user } = ctx;
  const tabsDef = [
    { key: 'company', label: 'Company' },
    ...(user.salon ? [{ key: 'salon', label: 'My salon' }] : []),
    { key: 'shoutouts', label: 'Shout-outs' },
  ];
  const list = h('div', { class: 'feed-list stack', 'aria-live': 'polite' });
  const sentinel = h('div', { class: 'feed-sentinel', 'aria-hidden': 'true' });
  const st = { scope: 'company', cursor: null, loading: false, done: false, seq: 0 };

  async function load(reset) {
    if (st.loading && !reset) return;
    if (reset) {
      st.cursor = null;
      st.done = false;
      st.seq += 1;
      mount(list, ui.skeleton('card', 3));
    }
    if (st.done) return;
    const seq = st.seq;
    st.loading = true;
    try {
      const r = await api.get('/feed', { scope: st.scope, cursor: st.cursor });
      if (seq !== st.seq) return;
      if (reset) clear(list);
      const items = r.items || [];
      items.forEach((p, i) => list.appendChild(ui.reveal(postCard(p, ctx), Math.min(i, 4) * 50)));
      st.cursor = r.next_cursor || null;
      st.done = !st.cursor;
      if (reset && !items.length) {
        mount(list, h('div', { class: 'card' }, ui.empty({
          icon: st.scope === 'shoutouts' ? 'star' : 'comment',
          title: st.scope === 'shoutouts' ? 'No shout-outs yet' : 'Nothing posted yet',
          body: st.scope === 'shoutouts' ? 'Recognise a teammate who made a guest’s day and it will show up here.' : 'Be the first to share what is happening in your salon.',
        })));
      } else if (st.done && items.length) {
        list.appendChild(h('div', { class: 'feed-end t-sm t-faint' }, 'You are all caught up.'));
      }
    } catch (err) {
      if (seq !== st.seq) return;
      if (reset) mount(list, ui.errorState(err, () => load(true)));
      else ui.toast(err.message, 'bad');
    } finally {
      if (seq === st.seq) st.loading = false;
    }
  }

  // Load the next page whenever the end of the list is near or already above the viewport.
  // (A scroll check rather than an IntersectionObserver: a fast flick or a jump can skip straight past a 1px sentinel.)
  let ticking = false;
  const check = () => {
    ticking = false;
    if (st.loading || st.done || !st.cursor || !sentinel.isConnected) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 800) load(false).then(check);
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  cleanup.push(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); });

  const tabs = ui.tabs(tabsDef, 'company', (key) => { st.scope = key; load(true).then(check); });
  load(true).then(check);
  return {
    el: h('section', { class: 'feed', 'aria-label': 'Feed' }, tabs, list, sentinel),
    prepend(post) {
      const visible = st.scope === 'company' || (st.scope === 'shoutouts' && post.kind === 'shoutout') || st.scope === 'salon';
      if (!visible) return;
      list.querySelector('.empty')?.closest('.card')?.remove();
      const card = postCard(post, ctx);
      card.classList.add('is-new');
      list.prepend(card);
    },
  };
}

export default {
  title: 'Home',
  css: true,
  async render(ctx) {
    cleanup = [];
    const { user } = ctx;
    const f = feed(ctx);
    const header = h('header', { class: 'home-hello' },
      h('div', { class: 't-eyebrow' }, dateLong(new Date())),
      h('h1', null, `${greeting()}, ${user.first_name || user.name}.`),
      h('p', { class: 't-muted' }, user.salon ? `${user.salon.name} · ${user.salon.market || ''}`.replace(/ · $/, '') : (user.title || roleLabel(user.role))));
    return h('div', { class: 'layout-rail home' },
      h('div', { class: 'stack' }, header, await quickStats(ctx), todoStrip(), composer(ctx, (post) => f.prepend(post)), f.el),
      rail(ctx));
  },
  teardown() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  },
};

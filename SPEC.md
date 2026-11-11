# SC Portal — build contract (v1, 2026-11-11)

Employee + leadership portal for the SC Entities Supercuts salons (51 active salons, CA / NV / AZ).
Modelled on Chris Larkins's "Prime Portal": a Facebook-style home with a shout-out feed, a store
landing page with KPIs / alerts / rankings, hub sections, levels of access, and an admin console.
This will be used for years. Favour boring, durable choices. No build step. Few dependencies.

Root: `/Users/dogwoodbrandscompany/dogwood-agents/supercuts-portal/`
Port: `3996` (env `PORT`). Public host (later): `supercutsportal.dogwoodbrands.com`.

## 1. Stack

- Node 22, `express` 4, `better-sqlite3` (WAL), `helmet`, `express-rate-limit`, `compression`. Nothing else server-side.
- Passwords: `node:crypto` scrypt (N=2^15, 16-byte salt), stored `scrypt$N$salt$hash`. Timing-safe compare.
- Sessions: 32-byte random token in an `HttpOnly; SameSite=Lax; Secure (when behind proxy)` cookie `scp_session`;
  only the SHA-256 of the token is stored. 30-day sliding expiry. `trust proxy` = 1.
- CSRF: every non-GET `/api` request must carry header `X-SCP: 1` and, when an `Origin` header is present, it must match the host.
- Frontend: vanilla ES modules, no framework, no bundler. Self-hosted fonts. Works offline for the shell (service worker), installable PWA.
- All timestamps stored as ISO-8601 UTC text. All ids are integers. Money is stored in cents (integer).

## 2. Layout and ownership

```
supercuts-portal/
  SPEC.md                    lead
  package.json               backend
  server/
    index.js                 backend  (express app, static, security headers, error handling)
    db.js  migrate.js        backend  (connection, numbered migrations in server/migrations/*.sql)
    auth.js  rbac.js         backend
    routes/*.js              backend  (one file per API area)
    seed/                    backend  (org.js = real salon roster, sample.js = sample people + activity + KPIs)
    import/dsr.js            backend  (imports data/dsr-dhr/daily.csv format into kpi_daily)
  scripts/                   backend  (backup.sh, create-admin.js, reset-password.js)
  test/*.test.js             backend  (node:test)
  data/                      runtime  (portal.db, uploads/, backups/) — gitignored
  content/                   content  (JSON seed content + media, see §8)
  public/
    index.html  manifest.webmanifest  sw.js   lead
    css/  js/core/                            lead
    js/pages/<page>.js                        frontend agents (files listed in §7)
    media/                                    content agent (images, icons)
  ops/                       backend  (LaunchAgent plist, RUNBOOK.md)
```

Do not edit files you do not own. If you need a change in someone else's file, say so in your final report.

## 3. Roles and scope

| role | sees | can do |
|---|---|---|
| `stylist` | company feed, own salon page, own stats, promos, standards, training, directory (names + salon, no phone/email of peers) | post, comment, react, shout-out, checklists for own salon, HR inquiry, tickets, acknowledgements |
| `salon_manager` | + full KPIs and team for own salon, own salon's tickets | + manage own salon roster view, post salon announcements, close checklists |
| `district_leader` | + every salon in own district, district rollups | + post district announcements, work tickets in district |
| `hr` | all people, HR inbox | answer HR inquiries, manage users |
| `executive` | everything read-only incl. company rollups, financial-grade KPIs | post company announcements |
| `admin` | everything | everything incl. settings, imports, audit log |

Scope is enforced on the server in `rbac.js`, never only in the UI:
`scopeSalonIds(user)` returns `'all'` or an array. Stylists and managers: `[user.salon_id]`. DL: salons in their district.
A stylist may read only the *public tier* of other salons (name, address, phone, hours, manager name, rank, pace-to-goal %) — no dollar figures.
Dollar KPIs for a salon require that salon in scope. Individual stylist stats: self, or manager+ with the salon in scope.
HR inquiries are visible only to the author, `hr`, and `admin` (not executives, not managers).

## 4. Data model (SQLite)

```
markets(id, name, state)                              -- Inland Empire, San Gabriel Valley, High Desert, Westside LA, Orange County, Temecula Valley, Las Vegas, Phoenix
districts(id, name, leader_user_id)
entities(id, code, legal_name)                        -- SC-SoCal-31, SC-SoCal-3, SC-SD-6, SC-LV-14, SC-LV-EE-1, SC-PHX-6
salons(id, salon_number UNIQUE, name, concept, address, city, state, zip, phone, shopping_center,
       market_id, district_id, entity_id, manager_user_id, hours_json, photo_url, lat, lng, status, opened_on)
users(id, email UNIQUE NULL, username UNIQUE, password_hash, must_change_password, role, first_name, last_name,
      title, salon_id NULL, district_id NULL, phone, avatar_url, hire_date, birthday_md, bio, status, last_login_at, created_at)
sessions(id, user_id, token_hash UNIQUE, created_at, expires_at, ip, user_agent)
invites(id, code_hash UNIQUE, role, salon_id, created_by, expires_at, used_by)
posts(id, author_id, kind, body, audience_type, audience_id, pinned_until, image_url, created_at, edited_at, deleted_at)
      -- kind: post | shoutout | announcement | win ;  audience_type: company | market | district | salon
shoutout_targets(post_id, target_type, target_id, value_key)   -- target_type: user | salon | district ; value_key from settings.values
comments(id, post_id, author_id, body, created_at, deleted_at)
reactions(post_id, user_id, kind, created_at, PRIMARY KEY(post_id,user_id))  -- kind: like | clap | love | fire
post_reads(post_id, user_id, read_at)                  -- announcement read receipts
reports(id, post_id NULL, comment_id NULL, reporter_id, reason, status, resolved_by, created_at)
kpi_daily(salon_id, date, net_sales_c, service_c, product_c, guests, haircuts, hours, supercut_plus, source, PRIMARY KEY(salon_id,date))
kpi_goals(salon_id, period, sales_goal_c, product_pct_goal, srph_goal_c, PRIMARY KEY(salon_id,period))   -- period 'YYYY-MM'
stylist_daily(user_id, date, service_c, product_c, guests, hours, PRIMARY KEY(user_id,date))
alerts(id, salon_id, group_key, label, state, due_on, updated_at)    -- group_key: people | store | initiative ; state: ok | action
checklist_templates(id, key, name, items_json, active)               -- open | close | weekly
checklist_runs(id, template_id, salon_id, date, done_json, completed_by, completed_at, UNIQUE(template_id,salon_id,date))
tickets(id, salon_id, author_id, category, subject, body, priority, status, assignee_id, created_at, updated_at)   -- category: it | facilities | supplies | marketing
ticket_events(id, ticket_id, author_id, body, status_to, created_at)
hr_inquiries(id, author_id, category, subject, body, status, assignee_id, created_at, updated_at)   -- category: pay | schedule | benefits | leave | concern | other
hr_messages(id, inquiry_id, author_id, body, created_at)
promos(id, title, summary, body, image_url, starts_on, ends_on, tag, audience, status, sort)
resources(id, section, category, title, summary, body_md, file_url, image_url, sort, requires_ack, updated_at)   -- section: brand | products | policies | ops | hr
acknowledgements(resource_id, user_id, acknowledged_at, PRIMARY KEY(resource_id,user_id))
videos(id, channel, title, description, url, poster_url, duration_s, views, sort)
events(id, title, starts_on, ends_on, kind, audience_type, audience_id)      -- ops calendar
notifications(id, user_id, kind, title, body, link, read_at, created_at)
audit_log(id, actor_id, action, target_type, target_id, meta_json, ip, created_at)
settings(key PRIMARY KEY, value_json)       -- company_name, sample_data (bool), values[], feature flags
```

Indexes on every foreign key used in a list query. `PRAGMA foreign_keys=ON`.

## 5. API (JSON, all under `/api`)

Conventions: success → `200 {…}`; errors → `{ "error": { "code": "…", "message": "human sentence" } }` with 400 / 401 / 403 / 404 / 409 / 429.
Lists are `{ items: [...], next_cursor: string|null }` where paginated (`?cursor=&limit=`). Money leaves the API in **cents**.
Every user object in a response is the public shape:
`{ id, name, first_name, role, title, avatar_url, salon: {id, name, salon_number, market}|null }`.

**Auth**
- `POST /auth/login {username, password}` → `{ user }` (sets cookie). Rate limit 10 / 15 min per IP + username. Same error for unknown user and wrong password.
- `POST /auth/logout` · `GET /auth/me` → `{ user: MeUser, settings: {company_name, sample_data, values:[{key,label}]}, unread: n }` or 401
  `MeUser` = public shape + `{ email, phone, must_change_password, district: {id,name}|null, scope: 'all'|'district'|'salon', permissions: string[] }`
  permissions used by the UI: `post.announce`, `kpi.dollars`, `kpi.company`, `admin.users`, `admin.content`, `admin.settings`, `hr.inbox`, `tickets.work`, `moderate`.
- `POST /auth/password {current, next}` (min 10 chars) · `POST /auth/invite/accept {code, username, password, first_name, last_name}`

**Feed**
- `GET /feed?scope=company|salon|shoutouts&cursor=` → items: `Post`
  `Post` = `{ id, kind, body, image_url, created_at, edited_at, pinned, author: User, audience: {type, id, label},
  targets: [{type, id, label, value_key}], reactions: {like, clap, love, fire}, my_reaction, comment_count,
  latest_comments: [Comment], requires_read, read_by_me, can_edit, can_delete }`. `Comment` = `{ id, body, created_at, author: User, can_delete }`
- `POST /posts {kind, body, audience_type, audience_id, image_url?, targets?: [{type,id,value_key}], pin_days?}` → `{ post }`
- `PATCH /posts/:id {body}` · `DELETE /posts/:id` · `POST /posts/:id/react {kind|null}` · `POST /posts/:id/read`
- `GET /posts/:id/comments` · `POST /posts/:id/comments {body}` · `DELETE /comments/:id` · `POST /reports {post_id|comment_id, reason}`
- `GET /feed/sidebar` → `{ top_recognized: [{user, count}], celebrations: [{user, kind: 'birthday'|'anniversary', label, on}], pinned: [Post] }`
- `GET /mentions?q=` → `{ users: [User], salons: [{id,name,salon_number}] }` (for the shout-out picker)

**Salons and KPIs**
- `GET /salons` → `{ items: [SalonCard] }` — `SalonCard` = `{ id, salon_number, name, concept, city, state, market, district, manager: User|null, photo_url, pace_pct, rank_company, in_scope }`
- `GET /salons/:id` → `{ salon: SalonCard + {address, zip, phone, shopping_center, hours, entity, lat, lng, opened_on}, team: [User + {tenure_label}],
  kpis: KpiBlock|null, boxes: [{key, label, value_label, goal_label, pct, state: 'ok'|'action'}], rank: {score, district, market, company, of_company},
  alerts: {people: [Alert], store: [Alert], initiative: [Alert]}, updated_through }` — `kpis` is null when the caller lacks dollar scope.
  `KpiBlock` = `{ period, mtd: {net_sales_c, service_c, product_c, guests, haircuts, hours, atv_c, srph_c, product_pct, supercut_plus},
  goal: {sales_goal_c, pace_pct, projected_c, product_pct_goal, srph_goal_c}, wow: {net_sales_pct, guests_pct, atv_pct}, yesterday: {…same as mtd…} }`
- `GET /salons/:id/dsr?from=&to=` → `{ days: [{date, net_sales_c, service_c, product_c, guests, haircuts, hours, atv_c, srph_c, product_pct}], totals }`
- `GET /salons/:id/stylists?period=` → `{ items: [{user, service_c, product_c, guests, hours, srph_c, product_pct, rank}] }`
- `GET /kpi/overview?level=company|market|district` → `{ period, updated_through, totals: KpiBlock, trend: [{date, net_sales_c, guests}], breakdown: [{id, label, net_sales_c, pace_pct, guests, atv_c, srph_c, product_pct, wow_pct}] }`
- `GET /leaderboards?metric=pace|sales|atv|product_pct|srph|recognition&group=salon|stylist|district&period=mtd|wtd` → `{ items: [{rank, label, sub_label, value, value_label, delta, id, type, avatar_url, is_me}] }`
  (dollar values are replaced by index / percent forms for callers without `kpi.dollars` on that row)
- `GET /me/stats` → `{ period, service_c, product_c, guests, hours, srph_c, product_pct, rank_salon, rank_company, of_company, shoutouts_received, streak_days, trend: [{date, service_c}] }`
- `PATCH /alerts/:id {state}` (manager+ in scope)

**Operations**
- `GET /checklists?salon_id=&date=` → `{ items: [{template: {id,key,name,items:[{id,label}]}, run: {done: [itemId], completed_at, completed_by: User|null}}] }`
- `PUT /checklists/:templateId/run {salon_id, date, done: [itemId], complete: bool}`
- `GET /tickets?status=&salon_id=` · `POST /tickets {salon_id, category, subject, body, priority}` · `GET /tickets/:id` (with events) · `POST /tickets/:id/events {body, status_to?}`
- `GET /events?from=&to=`

**My Job / HR**
- `GET /hr/inquiries` (own; all for hr/admin) · `POST /hr/inquiries {category, subject, body}` · `GET /hr/inquiries/:id` · `POST /hr/inquiries/:id/messages {body, status_to?}`
- `GET /resources?section=` → items without `body_md`; `GET /resources/:id` → full, plus `acknowledged_at`; `POST /resources/:id/ack`
- `GET /me/todo` → `{ items: [{kind: 'ack'|'announcement'|'checklist'|'training', title, link, due_on}] }`

**Content**
- `GET /promos?status=active|upcoming|past` · `GET /promos/:id` · `GET /videos?channel=` · `POST /videos/:id/view`
- `GET /directory?q=&role=&salon_id=&market_id=` → `{ people: [User + {phone?, email?}], salons: [SalonCard] }` (contact fields only for manager+ or home-office rows)
- `GET /notifications` · `POST /notifications/read {ids|all}`
- `PUT /uploads` (raw body, `Content-Type: image/jpeg|png|webp`, ≤ 6 MB, magic-byte checked) → `{ url }` served from `/uploads/<random>.<ext>` behind auth

**Admin** (`/admin/*`, permission-gated per route)
- users: `GET /admin/users?q=&role=&salon_id=&status=` · `POST /admin/users` (returns a one-time temp password) · `PATCH /admin/users/:id` · `POST /admin/users/:id/reset-password` · `POST /admin/users/import` (CSV text) · `POST /admin/invites`
- org: `GET|POST|PATCH /admin/salons`, `/admin/districts`, `/admin/markets`
- content: CRUD for `/admin/promos`, `/admin/resources`, `/admin/videos`, `/admin/events`, `/admin/checklist-templates`
- kpi: `GET|PUT /admin/goals?period=` · `POST /admin/import/dsr` (CSV text in the `data/dsr-dhr/daily.csv` column format; returns `{ rows, salons, from, to, rejected: [...] }`)
- moderation: `GET /admin/reports` · `POST /admin/reports/:id/resolve {action: 'dismiss'|'remove'}`
- `GET /admin/overview` → `{ users: {total, active_7d, never_logged_in}, posts_7d, shoutouts_7d, open_tickets, open_hr, ack_completion_pct, checklist_completion_pct, adoption_by_salon: [{salon, active_pct}] }`
- `GET /admin/audit?cursor=` · `GET|PUT /admin/settings`

`GET /healthz` → `{ ok: true, version, db: 'ok' }` (no auth).

## 6. KPI vocabulary (matches the DSR / DHR the field already reads)

net sales · service sales · product sales · guests (tickets) · haircuts · clocked hours · ATV (net sales ÷ guests) ·
SRPH (service revenue per clocked hour) · product % (product ÷ net sales) · Supercut Plus count · pace to goal
(projected month ÷ sales goal, using trading days elapsed). WoW always compares the same weekdays.
"Check the boxes" on the salon page: Pace to goal ≥ 100% · SRPH ≥ goal · Product % ≥ goal · ATV ≥ company median · Checklists ≥ 90%.
Rank score = weighted blend: pace 40, SRPH 25, product % 20, checklist completion 15.

## 7. Frontend contract

The lead owns `public/index.html`, `public/css/*`, `public/js/core/*`, `public/js/app.js`, and the login + shell.
Page modules live at `public/js/pages/<name>.js` and export:

```js
export default {
  title: 'My Salon',                 // document title + mobile header
  async render(ctx) { return el },   // returns one HTMLElement; ctx = { user, settings, params, query, navigate(path) }
  teardown() {}                      // optional: clear timers / observers
}
```

Routes (hash router, `#/path`): `/` home · `/salon` and `/salon/:id` · `/scoreboard` · `/promos` `/promos/:id` · `/standards` `/standards/:id` ·
`/products` · `/operations` · `/tickets` `/tickets/:id` · `/my-job` · `/hr` `/hr/:id` · `/tube` · `/directory` · `/people/:id` ·
`/company` (leadership rollup) · `/notifications` · `/account` · `/admin` `/admin/:section`.

Core helpers (import from `/js/core/…`; signatures are fixed):

```js
// dom.js
h(tag, attrs?, ...children) -> HTMLElement      // attrs: class, dataset, on<Event>, html (trusted only), style, any attribute. children: nodes | strings | arrays | null
frag(...children)  ·  clear(el)  ·  mount(el, child)
// api.js
api.get(path, query?)  api.post(path, body?)  api.patch(path, body?)  api.put(path, body?)  api.del(path)   // throws ApiError {status, code, message}
api.upload(fileOrBlob) -> {url}                  // downsizes to 1600px JPEG client-side first
// format.js
money(cents, {compact?})  pct(n, digits?)  num(n)  dateShort(iso)  dateLong(iso)  timeAgo(iso)  initials(name)  plural(n, one, many)
// ui.js  (every function returns an HTMLElement unless noted)
ui.avatar(user, size?)            ui.userChip(user)               ui.badge(text, tone?)        // tone: neutral | good | warn | bad | brand
ui.button(label, {variant?, icon?, onClick?, type?, busy?})      // variant: primary | secondary | ghost | danger
ui.icon(name, size?)              ui.card({title?, action?, pad?}, ...children)
ui.stat({label, value, delta?, hint?, tone?})                    ui.progress(pct, {tone?, label?})
ui.tabs([{key,label,count?}], active, onChange)                  ui.segmented([{key,label}], active, onChange)
ui.table({columns: [{key,label,align?,render?}], rows, onRow?, empty?})
ui.empty({icon?, title, body?, action?})                         ui.skeleton(kind)   // kind: card | list | table | stat
ui.field({label, name, type?, value?, options?, required?, hint?, rows?})   // input | textarea | select
ui.form({fields, submitLabel, onSubmit(values)})                 ui.modal({title, body, actions?, size?}) -> {el, close()}
ui.drawer({title, body}) -> {el, close()}                        ui.confirm({title, body, confirmLabel, tone?}) -> Promise<boolean>
ui.toast(message, tone?)          ui.pageHeader({title, eyebrow?, sub?, actions?})
ui.sparkline(values, {w?, h?, tone?})                             ui.barChart({rows: [{label, value, valueLabel?, tone?}], max?})
ui.lineChart({series: [{label, points: [{x, y}], tone?}], yFormat?, height?})   // SVG, animates in
ui.ring(pct, {size?, label?, tone?})                              ui.countUp(el, to, formatFn)   // animates a number
ui.reveal(el)                                                     // fades / lifts an element in when it enters the viewport
```

Rules for page modules:
- Never touch `document.body` or the shell. Return your element. Use `ui.skeleton` while loading, `ui.empty` for empty states, and a readable error state with a Retry button on failure.
- No inline hex colours, no new font sizes: use the CSS custom properties and utility classes in `public/css`. Page-specific CSS goes in `public/css/pages/<name>.css` (auto-loaded by the router).
- Never set `innerHTML` with user content. `h()` text children are escaped by construction.
- Every interactive element reachable by keyboard, visible focus ring, 44 px touch targets on mobile. Layouts work from 360 px to 1600 px.
- Motion: 160–240 ms, ease-out, opacity / transform only. Respect `prefers-reduced-motion`.
- Copy: plain, warm, short. Sentence case. No emoji in chrome. No "AI" language anywhere. Say "salon", "guest", "stylist".

Page ownership:
- **home agent**: `home.js` (feed, composer, shout-outs, right rail), `salon.js`, `scoreboard.js`, `company.js`, `people.js`, `notifications.js`, `account.js`
- **modules agent**: `promos.js`, `standards.js`, `products.js`, `operations.js`, `tickets.js`, `my-job.js`, `hr.js`, `tube.js`, `directory.js`, `admin.js` (+ `admin/*.js` sub-sections)

## 8. Content (owned by the content agent)

`content/*.json`, loaded by the seed: `promos.json`, `resources.json` (brand standards, product knowledge, policies, ops guides),
`videos.json`, `checklists.json`, `events.json`, `values.json`. Images in `public/media/` (`.webp`, ≤ 250 KB each, 2x for hero only).
Everything seeded is editable from the admin console afterwards. Anything not confirmed by the company is written as realistic
sample content and the portal shows a small "Preview · sample data" marker while `settings.sample_data` is true.

## 9. Non-negotiables

- No secrets in the repo. Admin bootstrap password comes from env `SCP_ADMIN_PASSWORD` or is generated and printed once.
- No real employee PII in seeds beyond names of company leadership and district leaders. Stylist and manager names are invented.
- No real sales figures in seeds. Sample KPIs are generated (seeded RNG, stable across runs) and sized plausibly per salon.
- Every write to users, roles, settings, content, moderation and HR is recorded in `audit_log`.
- `npm test` must pass: auth, session expiry, CSRF header, every scope rule in §3, feed audience filtering, HR privacy, upload validation.

## 10. Clarifications (added by the lead after v1; these are binding)

- **Percent units.** Every `*_pct` field in the API is in percent units, not a fraction: `pace_pct: 104.2`, `product_pct: 8.5`, `wow.net_sales_pct: -3.1`, `active_pct: 72`. `format.pct(n)` only appends `%`.
- **CSP.** The server sends `style-src 'self'` and `script-src 'self'`: no inline `<style>`, no inline scripts, no `style="…"` in HTML strings. Styles set through `h(tag, {style: {...}})` use the CSSOM and are fine.
- **Page CSS.** A page module that needs its own stylesheet exports `css: true`; the router then loads `/css/pages/<module-name>.css` before first render.
- **Fixed media names** (content agent): `/media/login-hero.webp`, `/media/hero-1.webp` … `hero-3.webp`, `/media/salon-1.webp` … `salon-6.webp`, icons at `/media/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.svg`.
- **Salon photos.** `salons.photo_url` is seeded as `/media/salon-N.webp` (N = 1 + id mod 6) until real photos are uploaded.
- **`GET /search?q=`** → `{ people: [User], salons: [{id, name, salon_number, city}], resources: [{id, section, title}], promos: [{id, title}] }` (max 5 each, scope-aware). Used by the top-bar search.
- **`MeUser.salon.id`** is always present for salon roles; leadership roles have `salon: null` and land on the company view.

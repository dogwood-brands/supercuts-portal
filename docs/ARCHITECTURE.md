# Architecture

How SC Portal is put together, and the reasons behind the main choices. `SPEC.md` is the contract; this document explains the code that implements it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22 | One language end to end, built-in test runner and `crypto.scrypt`. |
| HTTP | Express 4, `helmet`, `compression`, `express-rate-limit` | Small, well understood, few moving parts. |
| Database | SQLite through `better-sqlite3`, WAL mode | Zero administration for a demo. Not the production target: see `docs/PRODUCTION-PLAN.md`. |
| Frontend | Vanilla ES modules, no framework, no bundler | Nothing to compile or upgrade. A change to a file is live on the next load. |
| Fonts and icons | Self-hosted Red Hat Display and Red Hat Text; icons drawn as inline SVG paths | Works under a strict content security policy with no third-party requests. |
| Tests | `node:test` | No test dependency. |

Five runtime dependencies in total (`package.json`). There is no build step and no generated code.

## Request flow

`server/index.js` opens the database, applies migrations, creates a bootstrap `admin` on an empty database, then calls `createApp` in `server/app.js`. The middleware order in `app.js` is the security model, so it is worth reading once:

1. `helmet` with the content security policy, then `compression`.
2. `GET /healthz` (no sign-in required).
3. `/api` router:
   1. `Cache-Control: no-store` on every API response.
   2. Rate limit: 900 requests per minute per address.
   3. JSON body parser (256 KB). The two bulk-import routes bring their own larger parser.
   4. `auth.sessionMiddleware`: attaches `req.user` when the cookie maps to a live session.
   5. `auth.csrfGuard`.
   6. `routes/auth.js`: sign-in, sign-out and invite acceptance are reachable while signed out.
   7. `auth.requireAuth`: everything after this needs a session.
   8. `routes/feed.js`, `salons.js`, `ops.js`, `hr.js`, `content.js`, `admin.js`.
4. `GET /uploads/:name`: uploaded photos, served only to signed-in people.
5. Static files from `public/`.
6. Any other GET without a file extension returns `index.html` (single-page app).
7. One error handler. Every error leaves as `{ "error": { "code", "message" } }`. Stack traces go to the log, never to the client.

Each route file exports `(ctx) => router`. `ctx` carries `db`, `rbac`, `shapes`, `kpi`, `audit(...)`, `notify(...)`, `config` and `uploadsDir`.

Validation helpers live in `server/util.js` (`v.str`, `v.int`, `v.oneOf`, `v.date`, `v.url`, and the `bad`, `forbidden`, `notFound` error constructors). Every text field has a length cap.

## Sign-in and sessions

All in `server/auth.js`.

- **Passwords.** scrypt, N = 2^15, 16-byte salt, stored as `scrypt$N$salt$hash`. Comparison is timing safe. An unknown username spends the same hash as a wrong password and returns the same message.
- **Sessions.** A 32-byte random token in the `scp_session` cookie (`HttpOnly`, `SameSite=Lax`, and `Secure` whenever the request arrived over HTTPS or `SCP_COOKIE_SECURE=1`). Only the SHA-256 of the token is stored. Expiry is 30 days, extended at most once a day. Expired sessions are purged hourly.
- **Request forgery guard.** Every non-GET `/api` request must send the header `X-SCP: 1`, and when the browser sends `Origin` its host must equal the request host. This includes sign-in.
- **Sign-in limit.** 10 attempts per 15 minutes per address plus username. The counter is in memory and clears on restart.
- **Password rules.** New passwords need at least 10 characters (`routes/auth.js`). One-time passwords are generated as four groups of four characters and force a change at first sign-in (`must_change_password`).
- **Trust proxy** is set to 1 hop (the Cloudflare tunnel), which is what makes `req.secure` and `req.ip` correct.

## Roles and scope

All in `server/rbac.js`. Access is decided on the server on every route; the frontend only hides what the server would refuse.

| Role | Permissions | Salon scope for operating detail |
|---|---|---|
| `stylist` | none | own salon |
| `salon_manager` | `post.announce`, `kpi.dollars` | own salon |
| `district_leader` | `post.announce`, `kpi.dollars`, `tickets.work` | salons in their district |
| `hr` | `post.announce`, `admin.users`, `admin.content`, `hr.inbox`, `moderate` | none (people access only) |
| `executive` | `post.announce`, `kpi.dollars`, `kpi.company` | all |
| `admin` | everything, including `admin.settings` | all |

Two mechanisms:

- **Permissions** gate whole routes: `requirePerm('admin.users')` and so on.
- **Scope** gates rows: `rbac.scopeSalonIds(user)` returns `'all'` or a list of salon ids; `rbac.requireSalonScope(user, salonId)` throws 403 outside it.

Rules worth knowing before changing anything:

- A salon outside the caller's scope returns the public tier only (name, address, hours, manager, rank, pace percent). `kpis` is `null` and no dollar figure is sent.
- Individual stylist numbers are visible to the stylist, and to managers and above with that salon in scope (`rbac.canSeeStylistStats`). HR is excluded.
- HR inquiries are visible to the author, `hr` and `admin` only. Executives and managers cannot read them.
- Only an `admin` can create or change `admin` and `executive` accounts (`assertCanManage` in `routes/admin.js`).

`test/scope.test.js` exercises each of these over HTTP.

## Data model

The tables are listed in `SPEC.md` section 4 and created by `server/migrations/001_init.sql`. `002_dsr_run_rate.sql` adds `kpi_goals.run_rate_c`. In outline:

| Group | Tables |
|---|---|
| Organisation | `markets`, `districts`, `entities`, `salons` |
| People and access | `users`, `sessions`, `invites` |
| Feed | `posts`, `shoutout_targets`, `comments`, `reactions`, `post_reads`, `reports` |
| Numbers | `kpi_daily`, `kpi_goals`, `stylist_daily`, `alerts` |
| Operations | `checklist_templates`, `checklist_runs`, `tickets`, `ticket_events`, `events` |
| HR and content | `hr_inquiries`, `hr_messages`, `promos`, `resources`, `acknowledgements`, `videos` |
| System | `notifications`, `audit_log`, `settings`, `schema_migrations` |

Conventions: integer ids, money in integer cents (`*_c`), timestamps as ISO-8601 UTC text, calendar dates as `YYYY-MM-DD`, foreign keys on. Every `*_pct` value in the API is in percent units (104.2, not 1.042).

Migrations are forward only. `server/migrate.js` applies each new numbered file once, inside a transaction, and records it in `schema_migrations`. It runs on every server start and through `npm run migrate`.

## KPI computation

`server/kpi.js` builds everything the salon page, scoreboard and company view show: month to date, yesterday, week over week on matching weekdays, pace to goal, the five "check the boxes" tiles and the rank score. The result is cached in memory for 30 seconds and dropped when goals, salons or imports change through the API. A load from another process is picked up within 30 seconds.

The governing rule: **the portal shows only sales data the DSR and DHR provide.** In practice:

| Measure | How it is computed |
|---|---|
| Projected month and pace to goal | The DSR's own run rate (`kpi_goals.run_rate_c`) against the DSR sales target (`sales_goal_c`), so the portal matches the report the field already reads. A straight-line projection from days elapsed is used only when no run rate is loaded for that salon and month. |
| Sales per hour (`srph_c`) | Net sales divided by clocked hours, the DSR's "Total Sales / Total Hours". The field name is historical; it is not service revenue only. |
| Sales per hour and product percent tiles | Compared with the company median. The reports carry a sales target only, so `srph_goal_c` and `product_pct_goal` are empty after a real load. |
| Average ticket tile | Compared with the company median. |
| Checklists tile | Share of opening and closing checklists signed off in the last two weeks, against 90 percent. |
| Rank score | Pace 40, sales per hour 25, product percent 20, checklist completion 15. Each part is capped at 120 percent of its reference. |
| Per-person figures | None. The reports are by salon. `GET /me/stats` returns the caller's salon figures with `level: 'salon'`, plus the shout-outs that person received. The scoreboard ranks people on recognition only, and the salon page hides its stylist leaderboard while `stylist_daily` is empty. |

## The KPI pipeline

Sales reach the portal in five steps. Steps 1 and 2 run from the parent `dogwood-agents` workspace because other jobs share them; `pipeline/` holds a reference copy of both scripts (a snapshot, not the running code) so the whole path can be read here.

| Step | Script | What it does |
|---|---|---|
| 1 | `dogwood-agents/scripts/dsr-dhr-download.py` | Reads the daily DSR and DHR report emails from the `claude@dogwoodbrands.com` mailbox and saves each workbook as `data/dsr-dhr/raw/DSR_YYYY-MM-DD.xlsx` or `DHR_YYYY-MM-DD.xlsx`. |
| 2 | `dogwood-agents/scripts/dsr-dhr-parse.py` | Rebuilds `data/dsr-dhr/daily.csv`. A DSR dated N holds month-to-date totals through N-1, so a day's figures are the difference between consecutive files. |
| 3 | `scripts/dsr-targets.py` | Reads each month's sales target and run rate per salon from the "BY TL" sheet of the last DSR of that month and writes `data/dsr-targets.csv` (`period, salon_number, target_dollars, run_rate_dollars`). |
| 4 | `server/import/load-sales.js` | Upserts every salon-day into `kpi_daily` (source `dsr`), removes leftover sample days, sets `kpi_goals.sales_goal_c` and `run_rate_c` from the DSR, clears `product_pct_goal` and `srph_goal_c` on every row, deletes all of `stylist_daily`, and records the run in `settings.kpi_refresh` and the audit log. |
| 5 | `server/refresh.js` | Tells the pages when numbers were last loaded and when they load next. |

`scripts/refresh-sales.sh` runs steps 1 to 4 in order and logs to `dogwood-agents/logs/supercuts-portal-sales.log`. It is safe to run by hand. A failed download is not fatal: the ledger is rebuilt from the workbooks already on disk.

**Schedule.** `ops/com.dogwood.supercuts-portal-sales.plist` runs the refresh at 11:20 AM and 3:20 PM Central (the host's clock). The same two times are in `RUN_TIMES` in `server/refresh.js`, which is what produces the "Next refresh" line on the salon and company pages. Change both together.

**Validation in the import** (`server/import/dsr.js`): rows for stores that are not active salons are skipped; rows with a non-numeric value, negative counts, more than 500 hours or more than $50,000 in a day are rejected with a reason. Importing the same file twice updates rather than duplicates.

**Known gaps in the data.**

- The email feed is a scrape of a report a person sends by hand each morning. A late or missing email means a stale day.
- There is no per-stylist feed, so there are no individual sales figures. `stylist_daily` is emptied on every load. The table, `GET /salons/:id/stylists` and the stylist branches of `GET /leaderboards` remain in place for when a feed exists.
- Every load clears `product_pct_goal` and `srph_goal_c`, so values typed into Admin console, Goals for those two columns do not survive the next load.
- A handful of historical salon-days are missing because the source report was corrupt or absent: all of 2026-08-01, four salon-days in July, one in June, and three single-salon days in October.

An administrator can also import a ledger file by hand: Admin console, Data import, or `node server/import/dsr.js <file.csv>`.

## Frontend

```
public/
  index.html            static shell: fonts, four stylesheets, one module script
  js/app.js             boot, sign-in screen, app shell, router, session handling
  js/core/dom.js        h(), frag, clear, mount, debounce, markdown()
  js/core/api.js        fetch wrapper: X-SCP header, error shape, 401 handling, image downsizing for uploads
  js/core/format.js     money, pct, signed, dates, timeAgo, roleLabel, whereLabel, refreshNote
  js/core/icons.js      the icon set, as SVG paths
  js/core/ui.js         shared components: cards, buttons, tables, forms, modals, charts, rings, toasts
  js/core/pwa.js        install prompt and service worker registration
  js/pages/<name>.js    one module per page
  js/pages/admin/*.js   one module per admin section, plus kit.js and crud.js helpers
  css/tokens.css        every colour, size, radius and motion value
  css/base.css          reset, type, layout utilities
  css/components.css    styles for the shared components
  css/shell.css         sidebar, top bar, phone tab bar, sign-in screen
  css/pages/<name>.css  page styles, loaded on demand
```

**Router.** Hash based (`#/salon/15`). The `ROUTES` table in `js/app.js` maps a path pattern to a page module name. On navigation the router tears down the current page, imports `./pages/<name>.js`, loads `/css/pages/<name>.css` if the module exports `css: true`, calls `render(ctx)` and mounts the element it returns.

**Page module contract** (SPEC section 7):

```js
export default {
  title: 'My salon',
  css: true,                       // optional: load css/pages/<name>.css first
  async render(ctx) { return el }, // ctx = { user, settings, params, query, navigate, can, refreshUnread }
  teardown() {},                   // optional
};
```

**Rules pages follow.** Build DOM with `h()`; text children are inserted as text nodes, so user content cannot become markup. No inline styles in HTML strings and no inline scripts (the content security policy would block them); styles set through `h(tag, { style: {...} })` go through the CSSOM and are fine. No hex colours in page code: use the custom properties in `tokens.css`.

**Navigation.** `navModel()` in `js/app.js` builds the sidebar from the signed-in person's role and permissions. The phone tab bar is defined in `buildShell()` in the same file.

**Installable app and offline shell.** `manifest.webmanifest` plus `sw.js`. The service worker never caches `/api/` or `/uploads/`. The app shell is network first with a cached fallback; fonts and media are cache first.

> **Version bump rule.** `public/sw.js` starts with `const VERSION = 'scp-v1-N'`. Increase N whenever you change anything under `public/css`, `public/js` or `index.html`. The new worker then replaces the old cache on the next load. Without the bump, installed phones can keep serving an old shell while offline.

## Security posture

| Area | What is in place | Where |
|---|---|---|
| Content security policy | `default-src 'self'`; no inline script or style; frames only from the training site and youtube-nocookie; `frame-ancestors 'none'` | `server/app.js` |
| Request forgery | `X-SCP` header plus `Origin` host check on every non-GET | `server/auth.js` |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS; token stored only as a hash | `server/auth.js` |
| Passwords | scrypt, timing-safe compare, uniform failure message, forced change after a reset | `server/auth.js`, `routes/auth.js` |
| Access | Permission and salon-scope checks on the server for every route | `server/rbac.js`, `routes/*` |
| SQL | Prepared statements throughout. Table and column names in the generic admin CRUD come from code, never from the request | `routes/admin.js` |
| Uploads | JPEG, PNG or WebP only, 6 MB cap, magic bytes checked against the declared type, random file name, served only to signed-in people | `routes/content.js`, `app.js` |
| Audit log | Sign-ins and failures, user and role changes, password resets, content edits, goals, imports, moderation, settings, announcements, uploads, CLI actions | `ctx.audit` |
| Rate limits | 900 requests per minute per address; 10 sign-in attempts per 15 minutes | `app.js`, `routes/auth.js` |
| Transport | HTTPS terminates at Cloudflare; the app binds to `127.0.0.1` and is reachable only through the tunnel | `ops/*.plist` |

Current limits, all addressed in `docs/PRODUCTION-PLAN.md`: rate-limit counters are in memory and per process; there is one host; there is no second sign-in factor; the database file is not encrypted at rest by the application; backups sit on the same disk unless copied elsewhere.

## Tests

`npm test` runs `test/*.test.js`. `test/helpers.js` starts a real server on a random port against a throwaway seeded database and gives each test a cookie-aware client (`p.as('demo.manager')`). Suites: `auth.test.js`, `scope.test.js`, `feed-hr.test.js`, `import.test.js`.

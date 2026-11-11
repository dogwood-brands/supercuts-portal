# Production plan

The engineering work to take SC Portal from a working v1.0 demo to a system the field can depend on for years.

## Where v1.0 stands

| Area | Today | Consequence |
|---|---|---|
| Hosting | One Mac mini in the office, behind a Cloudflare tunnel, started by a LaunchAgent | An office power or network outage takes the portal down. No failover. |
| Database | A SQLite file at `data/portal.db` on that machine | Single writer, single disk. Backups are on the same disk unless copied by hand. |
| Sign-in | Username and password, 30-day session cookie | No second factor. Shared demo sign-ins exist (`demo.*` and a shared `stylist` account). |
| Rate limits | Counters held in process memory | Reset on every restart; would not hold across more than one instance. |
| Sales feed | Report emails are read from a mailbox, then parsed | Depends on a person sending the email each morning. |
| Per-stylist numbers | None. The reports are by salon, so the portal shows salon figures only and ranks people on recognition. | Stylists cannot see their own sales until a per-stylist feed exists. |
| People | Real salons, districts, district leaders, leadership. Sample stylists and managers. | The real roster is not loaded. |
| History | A few salon-days missing where the source report was corrupt or absent (all of 2026-08-01, four in July, one in June, three single-salon days in October) | Month totals for those months are slightly understated. |
| Delivery | No CI, no staging, no error tracking, no uptime check | Problems are found by users. |

None of this blocks a leadership demo. All of it should be closed before stylists rely on the portal.

## (a) Managed PostgreSQL

**Recommendation.** A managed PostgreSQL service: AWS RDS for PostgreSQL if the rest of the stack goes to AWS, or Neon for a lighter operational footprint. Requirements either way: encryption at rest, TLS in transit, automated daily backups, point-in-time recovery with at least 7 days of retention, and a private network path or IP allow-list from the application.

**Scope of the port.** The code uses `better-sqlite3`, which is synchronous. `pg` is asynchronous. That difference, not the SQL, is most of the work.

| File | Database call sites | What changes |
|---|---|---|
| `server/db.js` | connection and pragmas | Replace with a `pg` pool. Drop the pragmas. |
| `server/migrate.js`, `server/migrations/001_init.sql` | runner and schema | Keep the runner design. Translate the schema (see below). |
| `server/routes/admin.js` | 55 | Largest file. Includes the generic CRUD builder. |
| `server/routes/feed.js` | 35 | |
| `server/routes/content.js` | 20 | |
| `server/routes/salons.js` | 20 | |
| `server/routes/hr.js` | 18 | |
| `server/routes/ops.js` | 18 | |
| `server/routes/auth.js` | 13 | |
| `server/kpi.js` | 9 | Prepared once at start; the 30-second cache stays. |
| `server/auth.js` | 6 | Session lookup runs on every request: keep it one indexed query. |
| `server/app.js`, `rbac.js`, `shape.js`, `refresh.js`, `index.js` | 11 in total | |
| `server/import/dsr.js`, `load-sales.js` | 15 | Bulk upserts: use multi-row `INSERT ... ON CONFLICT`. |
| `server/seed/org.js`, `sample.js`, `run.js` | 48 | Only needed for development and tests. |
| `scripts/create-admin.js`, `reset-password.js`, `backup.sh` | 10 | `backup.sh` is replaced by the managed service's backups. |

Counts are occurrences of `db.prepare`, `db.exec`, `db.transaction` and `db.pragma` at the time of writing, roughly 280 in all.

**Mechanical changes.**

1. Every handler that touches the database becomes `async`, and Express 4 needs each wrapped so a rejected promise reaches the error handler (or move to Express 5, which does this natively).
2. `db.transaction(fn)()` becomes `BEGIN` / `COMMIT` on a single pooled client.
3. Placeholders change from `?` to `$1, $2, ...`.
4. `info.lastInsertRowid` becomes `INSERT ... RETURNING id`.
5. Schema: `INTEGER PRIMARY KEY` becomes `BIGINT GENERATED ALWAYS AS IDENTITY`; ISO text timestamps can stay as `TEXT` for a like-for-like port or move to `TIMESTAMPTZ`; `*_json` columns become `JSONB`; `CHECK` constraints carry over unchanged.
6. SQL dialect: `LIKE` is case sensitive in PostgreSQL, so search queries need `ILIKE`; `||` concatenation and `COALESCE` carry over; the error code for a unique violation changes from `SQLITE_CONSTRAINT_UNIQUE` to `23505` in the error handler in `server/app.js`.
7. Tests: `test/helpers.js` creates a throwaway SQLite file per run. Point it at a disposable PostgreSQL database or schema per run instead.

**Suggested approach.** Introduce a thin data-access layer first (one module per table group exposing async functions), move the routes onto it while still on SQLite, then swap the layer's implementation to `pg`. That keeps each step testable with the existing 47 tests. Budget: about two weeks for one engineer including data migration and a rehearsal.

**Data migration.** Export from SQLite table by table in foreign-key order, load into PostgreSQL, reset identity sequences, then compare row counts and month-to-date sales per salon between the two before cutting over.

## (b) Managed hosting

Move the application off the office machine.

| Piece | Recommendation |
|---|---|
| Application | A container on AWS App Runner or ECS Fargate (if on AWS with RDS), or Render or Fly.io for less setup. One small instance is enough for 51 salons; run two for availability once sessions and rate limits are no longer in memory. |
| Container | A plain Node 22 image: `npm ci --omit=dev`, `node server/index.js`. Nothing to build. After the PostgreSQL port there is no native module to compile. |
| Uploads | Object storage (S3 or equivalent) behind the existing signed-in check, in place of `data/uploads`. The change is contained in the upload route in `server/routes/content.js` and the `/uploads/:name` handler in `server/app.js`. |
| Secrets | Database URL and any API credentials in the platform's secrets manager. Nothing in the repository or the image. |
| Configuration | Already environment driven: `PORT`, `HOST`, `SCP_COOKIE_SECURE`, `SCP_DB`, `SCP_UPLOADS`, `SCP_ADMIN_PASSWORD`. Add `DATABASE_URL`. Set `HOST=0.0.0.0` in a container. |
| Proxy | `app.set('trust proxy', 1)` assumes exactly one proxy hop. Set it to match the platform's load balancer chain or `req.ip` and the Secure cookie flag will be wrong. |
| Rate limits | Move the two `express-rate-limit` stores to Redis or PostgreSQL so they survive restarts and work across instances. |
| Scheduled sales load | Replace the LaunchAgent with the platform's scheduler, calling the same load step. See (e). |

## (c) Domain cut-over to supercuts.ai

**Current state.** `supercuts.ai` is registered at 101domain, uses 101domain name servers, and its A records currently point at two AWS addresses that are not this portal. Find out what, if anything, is served there before changing DNS.

**Steps.**

1. Decide the host name: the apex `supercuts.ai`, or a subdomain such as `portal.supercuts.ai` if the apex is wanted for something else.
2. Move DNS for the zone to the provider that fronts the application (Cloudflare today, or Route 53 on AWS), or add records at 101domain. Lower the TTL a day ahead.
3. Point the host at the application and issue the TLS certificate (managed by the platform or Cloudflare).
4. Application checks, all host dependent:
   - the request forgery guard in `server/auth.js` compares the `Origin` host with the `Host` header, so the proxy must pass the public host through unchanged;
   - the session cookie is host only, so everyone signs in once more on the new host;
   - the content security policy is `'self'` based and needs no change; the `frameSrc` list still names `academy.dogwoodbrands.com`;
   - `public/manifest.webmanifest` uses relative `start_url` and `scope`, so it works on any host, but an app installed from the old host stays tied to the old host. People reinstall from the new address.
5. Redirect `supercutsportal.dogwoodbrands.com` to the new host with a permanent redirect, and keep it in place for at least a year.
6. Increase `VERSION` in `public/sw.js` with the release that goes live on the new host.
7. Update the address in `README.md`, the sign-in instructions and any printed material.

## (d) Identity

| Item | Recommendation |
|---|---|
| Home office and leadership | Single sign-on with the company's Google Workspace accounts (OpenID Connect). Removes passwords for the accounts with the widest access. |
| Stylists and managers | Many have no company email. Options, in order of preference: emailed or texted one-time sign-in links to a personal address or phone on file; or keep username and password with the invite-code flow that already exists in the API (`POST /api/admin/invites`, `POST /api/auth/invite/accept`). The admin console has no button for invites yet. |
| Second factor | Required for `admin`, `hr` and `executive`. TOTP at minimum. Comes for free with Google SSO if Workspace enforces it. |
| Password policy | The API already requires 10 characters for self-service changes. Add a check against known-breached passwords and remove any path that can set a shorter one. |
| Shared sign-ins | Remove `demo.*` and the shared `stylist` account before field rollout. Every person gets their own account so the audit log means something. |
| Sessions | Add "sign out everywhere" and a list of signed-in devices to the account page (the `sessions` table already stores address and browser). Consider a shorter session for home-office roles. |
| Offboarding | Tie account status to the HR system of record so a leaver is deactivated the same day. |

## (e) Data

| Item | Today | Target |
|---|---|---|
| Daily sales and hours | `dsr-dhr-download.py` reads report emails from a mailbox; `dsr-dhr-parse.py` rebuilds `daily.csv`; `load-sales.js` loads it | A direct, scheduled export from Zenoti (API or SFTP drop) into the portal's database. Removes the mailbox, the hand-sent email and the month-to-date differencing. Until then, make the copies in `pipeline/` the running code so the pipeline lives in one repository. |
| Monthly targets and run rate | Read from the "BY TL" sheet of the DSR workbook by `scripts/dsr-targets.py`. The scheduled load overwrites the sales goal and clears the product and per-hour goal columns. | Delivered with the export. If operations want product or per-hour goals, add them to the report or make the Goals screen the source of truth for those two columns and stop the load clearing them. |
| Pace to goal | The DSR's own run rate against the DSR target, so the portal matches the report. Straight-line only when no run rate is loaded. | Keep one method. A direct export must carry the run rate or the agreed formula for it. |
| Per-stylist numbers | Removed. `load-sales.js` empties `stylist_daily` on every load. | A per-stylist feed from Zenoti (service sales, product sales, guests, hours per stylist per day, into `stylist_daily`) is the prerequisite for bringing individual stats back. It needs a stable mapping from Zenoti employee id to portal user. The table, `GET /salons/:id/stylists`, the stylist leaderboards and the salon page's stylist panel are already built and reappear when rows exist; `GET /me/stats` and the step in `load-sales.js` that deletes the rows need changing at the same time. |
| Roster | Sample staff | Import the real roster (Admin console, People, Import roster), with salon manager and district assignments. Then clear the sample accounts and their activity. |
| Salon details | Default hours, city-centre coordinates, working district names | Real hours, coordinates and district names, edited in Admin console, Salons and districts. |
| Missing history | A few salon-days absent | Backfill from Zenoti when the direct export exists. |
| Content | Sample promos, standards and policies | The company's own, reviewed by operations and HR. |
| Retention | None defined | Decide how long to keep audit entries, HR threads and sessions, and write it down. |

## (f) Operations and delivery

| Item | Recommendation |
|---|---|
| Continuous integration | GitHub Actions running `npm ci` and `npm test` on every push and pull request. Protect `main`. |
| Environments | A staging environment with its own database, deployed automatically from `main`; production deployed from a tag. |
| Error tracking | Sentry or equivalent on the server (the single error handler in `server/app.js` is the hook) and in the browser (the `catch` in the router in `public/js/app.js`). |
| Logs | Structured JSON to the platform's log service. Never log request bodies. |
| Uptime | An external check on `/healthz` every minute with alerts to two people. |
| Data freshness | Alert when `settings.kpi_refresh.data_through` is more than one day behind by noon Central. A stale feed went unnoticed for six weeks before v1.0. |
| Backups | Managed point-in-time recovery plus a restore rehearsal once a quarter. |
| Dependencies | Dependabot or Renovate. There are five runtime dependencies. |
| Security review | An independent review of authentication, access rules and uploads before field rollout. `test/scope.test.js` is the starting checklist. |
| Accessibility | A pass with a screen reader and keyboard only on the feed, salon page and forms. |

## (g) Native apps

The portal installs to the home screen on iOS and Android today as a web app. Stay with that unless one of these proves necessary in practice: reliable push notifications to stylists on iOS, an App Store presence for discoverability, or device features the browser does not offer. If so, wrap the existing web app (Capacitor) before considering a rewrite.

## (h) Phased checklist

| Phase | Item | Owner |
|---|---|---|
| **0: this week** | Give BM access to the repository and the current host | ZM |
| 0 | Find out what `supercuts.ai` serves today and who controls its DNS at 101domain | BM |
| 0 | Copy nightly backups off the office machine (install `ops/com.dogwood.supercuts-portal-backup.plist`, sync `data/backups` elsewhere) | BM |
| 0 | Add CI: `npm test` on every push | BM |
| 0 | Agree the feature list for the field with Chris | CL |
| **1: two weeks** | Data-access layer, then port to managed PostgreSQL with point-in-time recovery | BM |
| 1 | Containerise and deploy to managed hosting; staging and production | BM |
| 1 | Move uploads to object storage and rate limits to a shared store | BM |
| 1 | Error tracking, uptime check, data-freshness alert | BM |
| 1 | Single sign-on for home office and leadership; second factor for admin, HR and executive | BM |
| 1 | Cut over to the production domain with a redirect from the old host | BM |
| 1 | Run the DSR and DHR scripts from `pipeline/` in this repository instead of the parent workspace | BM |
| **2: before field rollout** | Direct Zenoti export for daily sales and hours | BM / ZM |
| 2 | Per-stylist feed and the Zenoti-to-portal user mapping (prerequisite for individual stats) | BM / ZM |
| 2 | Import the real roster; remove sample staff, sample activity and shared sign-ins; turn off the Preview marker | ZM / HR |
| 2 | Real salon hours, coordinates and district names | CL |
| 2 | Replace sample promos, standards and policies with approved content | CL / HR |
| 2 | Sign-in method for stylists without company email (one-time links or invite codes) | BM |
| 2 | Independent security review and an accessibility pass | BM |
| 2 | Pilot with one district, then all salons | CL |

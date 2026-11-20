# Production readiness plan

Plan for taking CutsHub (SC Portal) from v1.1 on the office machine to a system every stylist can rely on for years. It covers the five requirements from leadership, in their priority order, and the three v1.1 additions.

- **Written:** 2026-11-17
- **Owner:** BM, unless noted
- **Builds on:** [PRODUCTION-PLAN.md](../PRODUCTION-PLAN.md). That document holds the detailed engineering notes (the PostgreSQL port by file, the domain cut-over checks, the identity options). This plan turns them into work against the requirements, adds the AWS choices, and records what is already done. Where the two disagree, this plan is newer. The differences are listed in section 10.
- **Costs:** the running-cost estimate was shared with Zemar and Chris as a separate page. Summary in section 8.

## 1. The requirements and their completion tests

| # | Requirement | Done when |
|---|---|---|
| 1 | A secure, managed database: managed PostgreSQL, encrypted at rest and in transit, private networking, automated daily backups with point-in-time recovery, no production data on an office machine | Production runs on managed PostgreSQL and a restore has been tested end to end |
| 2 | Professional hosting: managed platform, separate staging and production, secrets in a secrets manager, uploads in object storage, tests on every push, uptime and error monitoring | A push to `main` is tested and deployed without anyone touching a server |
| 3 | The supercuts.ai domain with managed TLS; the temporary address redirects. Zemar and Chris confirm use of the name with the franchisor before field rollout | The portal answers on supercuts.ai and the old address forwards to it |
| 4 | Identity and access: one account per person from the real roster, single sign-on or emailed sign-in links, multi-factor for leadership and administrators, shared demo sign-ins removed | Every employee signs in as themselves and no shared password exists |
| 5 | A dependable data feed: DSR and DHR stay the single source of sales truth, delivered by a direct scheduled export instead of email; a per-stylist feed when one is available | Sales arrive without depending on a person sending an email |
| v1.1 | Ask HR delivered through HR@scsalons.com; per-stylist data for the pay-plan page; uploads in proper file storage | See sections 2.6, 2.7 and 2.8 |

## 2. Status: what is done and what is left

### 2.1 Managed database

**Done**
- Configuration is environment driven (`PORT`, `HOST`, `SCP_DB`, `SCP_UPLOADS`, `SCP_COOKIE_SECURE`, `SCP_ADMIN_PASSWORD`).
- Forward-only numbered migrations with a runner (`server/migrate.js`, `server/migrations/001` to `003`).
- Nightly backup script (`scripts/backup.sh`, `ops/com.dogwood.supercuts-portal-backup.plist`). It writes to the same disk as the database.
- About 55 automated tests (`npm test`), run in CI on every push, to protect the port.

**Left**
- The app still uses SQLite through `better-sqlite3`, with about 280 direct database calls.
- No managed PostgreSQL, data migration or restore test.
- Backups are not yet copied off the office machine (an interim gap, see phase 0).

### 2.2 Hosting and delivery

**Done**
- `GET /healthz` reports app and database health.
- A single error handler in `server/app.js` and a router `catch` in `public/js/app.js` give clean places to attach error tracking.
- No build step and five runtime dependencies, so a container is simple.

**Left**
- No CI (there is no `.github/` folder), no staging, no container, no secrets manager.
- No error tracking, uptime check or data-freshness alert.
- Rate limits are held in memory.
- `trust proxy` is fixed at one hop for the Cloudflare tunnel (`server/app.js:24`).
- The sales load runs from a macOS LaunchAgent.

### 2.3 supercuts.ai

**Done**
- The app works on any host. The manifest uses relative `start_url` and `scope`, and the content security policy is based on `'self'`.
- The cut-over steps are written up in PRODUCTION-PLAN section (c).

**Left**
- Find out what supercuts.ai serves today. It is registered at 101domain, and its A records point at two AWS addresses that are not this portal.
- Franchisor confirmation (Zemar and Chris).
- DNS, TLS, the redirect from `supercutsportal.dogwoodbrands.com`, and the follow-up updates.

### 2.4 Identity and access

**Done**
- Passwords are hashed with scrypt; session tokens are stored as hashes.
- Request forgery guard and sign-in rate limit.
- 10-character minimum on self-service password changes.
- Invite API (`POST /api/admin/invites`, `POST /api/auth/invite/accept`).
- Roster import from our template or an iSolved export (`server/import/roster.js`). `users.employee_id` makes re-uploads update people instead of duplicating them.

**Left**
- Single sign-on, emailed sign-in links, and a second factor.
- An admin-console button for invites.
- Real roster loaded.
- `demo.*` and the shared `stylist` sign-ins removed (`server/seed/run.js`, `server/seed/sample.js`).
- Breached-password check, session management, and offboarding.

### 2.5 Data feed

**Done**
- Loader with validation (`server/import/dsr.js`, `load-sales.js`) and the DSR targets and run-rate reader (`scripts/dsr-targets.py`).
- Manual goals are now protected: the load clears product and per-hour goals only where `goal_source != 'manual'`.
- The per-stylist table, endpoints, leaderboards and salon panel exist and reappear when rows exist.

**Left**
- Sales still arrive by reading report emails from a mailbox (`claude@dogwoodbrands.com`), run from the parent `dogwood-agents` workspace.
- No direct export and no per-stylist source.
- `load-sales.js` empties `stylist_daily` on every load (line 54).
- A few historical salon-days are missing.

### 2.6 v1.1: Ask HR through HR@scsalons.com

**Done.** The code is complete in `server/hr-relay.js`:
- It sends through the Gmail API as HR@scsalons.com, to HR@scsalons.com.
- It deletes the content on delivery and keeps only who and when (`hr_submissions`), with a 730-day retention default.
- A manual "Moved to HR inbox" fallback works today.

**Left**
- Google Workspace permission for HR@scsalons.com to send, with the credentials stored as secrets.
- A lock so two app instances cannot send the same message twice.
- An alert when messages wait too long.

### 2.7 v1.1: Per-stylist feed

**Done**
- The pay-plan page (`public/js/pages/pay-plan.js`) shows salon figures and says personal figures are coming.

**Left**
- A source for the data, through Emory Smith.
- A mapping from employee id to portal user.
- The import itself, plus changes to `load-sales.js` and `GET /me/stats`.
- Personal tiles on the pay-plan page.
- An estimated bonus, which waits for verified pay-plan thresholds from HR.

### 2.8 v1.1: Upload storage

**Done**
- Promo videos (MP4, MOV or WebM, up to 200 MB, content admins only) and stylist albums (10 photos per person) work.
- Both are stored in `data/uploads` and served only to signed-in people.

**Left**
- Move them to S3, copy the existing files across, and set a retention rule for deleted and departed-staff photos.

## 3. Platform choice: AWS

| Piece | Choice | Why |
|---|---|---|
| Region | US West (Oregon), `us-west-2` | Closest low-cost region to the California, Nevada and Arizona salons |
| Database | RDS for PostgreSQL, current major version, `db.t4g.small`, Multi-AZ in production; `db.t4g.micro` Single-AZ in staging | Managed backups, point-in-time recovery, encryption and failover. A current major version avoids Extended Support charges. |
| Application | ECS on Fargate (ARM), behind an Application Load Balancer; two tasks in production, one in staging | Runs inside our VPC next to the database, with no servers to patch. Two tasks allow failure and rolling deploys. |
| Files | S3, one bucket per environment, public access blocked, encryption on, versioning on | Replaces `data/uploads` |
| Secrets | AWS Secrets Manager; the RDS-managed master secret | Nothing in the repository or the image |
| Scheduled jobs | EventBridge Scheduler starting an ECS task | Replaces the LaunchAgents |
| DNS and TLS | Route 53 hosted zone and an ACM certificate on the load balancer | Managed TLS with automatic renewal |
| Email (sign-in links) | Amazon SES with a verified sending domain | Cheap and reliable; separate from the HR Gmail path |
| Protection | AWS WAF on the load balancer: AWS managed rules plus a rate rule | Replaces part of what the in-memory limiter does today, at the edge |
| Infrastructure as code | AWS CDK (TypeScript) in this repository under `infra/` | Staging and production built from the same code |
| CI/CD | GitHub Actions, with OIDC to an AWS deploy role (no stored AWS keys) | Tests and deploys on every push |
| Monitoring | Sentry (server and browser), CloudWatch logs and alarms, Route 53 health check on `/healthz` | Uptime, errors and freshness alerts |

**Network.** The database runs in private subnets only, with no public address, and accepts connections only from the app's security group. The app tasks run in public subnets with security groups that admit only the load balancer, so they can reach Gmail, Sentry and Zenoti without a NAT gateway. A NAT gateway (fully private tasks) is an option at about $37 a month more if a security review asks for it.

**Accounts.** One AWS account per environment is best practice. One account with fully separate staging and production resources (database, bucket, secrets, IAM roles) is acceptable at this size and simpler to run. Decide in phase 0.

## 4. Work plan by phase

### Phase 0: this week (groundwork and interim safety)

| # | Task | Owner |
|---|---|---|
| 0.1 | Give BM access to the repository, the office host, Cloudflare and the 101domain account | ZM |
| 0.2 | Install the backup LaunchAgent and copy `data/backups` off the office machine every night (interim, until RDS). **Code done:** `scripts/backup-offsite.sh`, called by `backup.sh`; set-up steps in `ops/RUNBOOK.md`. **Left:** choose the destination, then install on the office machine. | BM |
| 0.3 | Add GitHub Actions: `npm ci` and `npm test` on every push and pull request; protect `main` (required checks, no direct pushes). **Code done:** `.github/workflows/ci.yml`. **Left:** first green run, then branch protection on `main`. | BM |
| 0.4 | Add Dependabot for npm and GitHub Actions. **Code done:** `.github/dependabot.yml`. **Left:** turn on Dependabot alerts and security updates in the repository settings. | BM |
| 0.5 | Find out what supercuts.ai serves today and who controls its DNS | BM |
| 0.6 | Ask the franchisor about using supercuts.ai | ZM / CL |
| 0.7 | Ask the Google Workspace administrator for scsalons.com to set up sending as HR@scsalons.com (section 6.1) | BM / ZM |
| 0.8 | Ask Emory Smith for a sample per-stylist report and its employee identifiers, and ask about Zenoti API or scheduled-export access | BM / ES |
| 0.9 | Open the AWS account(s), turn on billing alerts (budget alert at $250 a month), enable IAM Identity Center for console access | ZM / BM |
| 0.10 | Agree the feature list for the field with Chris | CL |

### Phase 1: about two to three weeks (requirements 1 and 2, together)

Requirements 1 and 2 ship as one cut-over. "No production data on an office machine" is only true once the app leaves the office machine too.

**1a. Data-access layer, still on SQLite.** Move every `db.prepare`, `db.exec` and `db.transaction` call into async functions, one module per table group (`server/data/*.js`). Move routes onto it one file at a time and keep all tests passing after each file. Order: `auth.js` and `server/auth.js` first (session lookup on every request must stay one indexed query), then `kpi.js`, `feed.js`, `salons.js`, `ops.js`, `hr.js` plus `hr-relay.js`, `content.js`, `admin.js` (largest, including the generic CRUD builder), then imports, seeds and scripts.

**1b. Switch the layer to PostgreSQL** (`pg`). The changes, from PRODUCTION-PLAN (a):
1. Handlers become `async`. Move to Express 5 (rejected promises reach the error handler natively) or wrap each handler.
2. `db.transaction(fn)()` becomes `BEGIN`/`COMMIT` on one pooled client.
3. Placeholders change from `?` to `$1, $2, ...`.
4. `info.lastInsertRowid` becomes `INSERT ... RETURNING id`.
5. Schema: `INTEGER PRIMARY KEY` becomes `BIGINT GENERATED ALWAYS AS IDENTITY`. `*_json` columns become `JSONB`. Timestamps move to `TIMESTAMPTZ` (or stay `TEXT` for a like-for-like port; decide at the start). `CHECK` constraints carry over.
6. `LIKE` searches become `ILIKE`. The unique-violation check in `server/app.js:140` changes from `SQLITE_CONSTRAINT_UNIQUE` to code `23505`.
7. Bulk sales upserts use multi-row `INSERT ... ON CONFLICT`.
8. Tests: `test/helpers.js` creates a throwaway PostgreSQL schema or database per run. CI runs a PostgreSQL service container.
9. Remove `better-sqlite3`, the pragmas and `scripts/backup.sh`.

**1c. Shared state for more than one instance.**
- Move the two `express-rate-limit` stores to PostgreSQL.
- Guard the HR relay `flush()` with `SELECT ... FOR UPDATE SKIP LOCKED` on `hr_outbox` (or a PostgreSQL advisory lock) so two tasks never send the same message.
- Make the hourly session purge safe to run on both tasks.
- Check `server/kpi.js`'s 30-second in-memory cache: each task keeps its own, which is acceptable because loads are picked up within 30 seconds.

**1d. Container.**
- Node 22 slim image: `npm ci --omit=dev`, `node server/index.js`, run as a non-root user.
- Set `HOST=0.0.0.0` and add `DATABASE_URL` (from Secrets Manager).
- Run migrations as a one-off task before each deploy, not on every task start, so two tasks never race.

**1e. Infrastructure (CDK, `infra/`), staging and production.**
- VPC with two availability zones.
- RDS: encrypted storage, `rds.force_ssl = 1`, backup retention of 14 to 35 days, deletion protection on, and Performance Insights free tier.
- ECS cluster and services, the load balancer with WAF, the S3 buckets, the secrets, and the EventBridge schedules.
- Route 53 health check, CloudWatch log groups (30 to 90 days of retention) and alarms.

**1f. Uploads to S3.**
- Videos (up to 200 MB) and photos go from the browser straight to S3 using a short-lived pre-signed `PUT` URL issued by the API after the existing permission checks (`admin.content` for videos; the 10-photo album limit).
- Viewing uses short-lived pre-signed `GET` URLs issued only to signed-in people. These support range requests for video seeking.
- `PUT /api/uploads`, `PUT /api/uploads/video` and `GET /uploads/:name` change. Stored URLs keep the `/uploads/<name>` form so old records still resolve.
- Copy the existing `data/uploads` files to S3 during the cut-over.
- Turn on CloudFront later if video traffic grows (section 8).

**1g. Delivery pipeline.** On every push to `main`:
1. Run the tests (with a PostgreSQL service).
2. Build and push the image to ECR.
3. Run migrations on staging and deploy to staging.
4. Run smoke tests (`/healthz`, sign-in, one page per role).
5. Run migrations on production and deploy to production (rolling, with automatic rollback on failed health checks).

Pull requests run tests only. A GitHub environment approval on production is optional (section 9).

**1h. Monitoring.**
- Sentry on the server (the error handler) and in the browser (the router `catch`).
- Structured JSON logs to CloudWatch. Never log request bodies, HR content or passwords.
- Route 53 health check on `/healthz` every minute, with an alarm to two people.
- Data-freshness alarm when `settings.kpi_refresh.data_through` is more than one day behind at noon Central.
- An alarm when an `hr_outbox` row is older than 30 minutes.
- Alarms on database CPU, storage and connections.

**1i. Set `trust proxy`** to match the load balancer (one hop behind the ALB) and confirm `req.ip`, `req.secure` and the `Secure` cookie flag on staging.

**1j. Migration rehearsal on staging, then cut-over.**
1. Export SQLite table by table in foreign-key order, load into PostgreSQL, and reset identity sequences.
2. Compare row counts per table and month-to-date sales per salon between the two.
3. Copy the uploads to S3 and check a sample opens.
4. **Restore test:** restore staging's database to a point in time as a new instance, point a staging task at it, verify the counts, record the steps and timings in `ops/RUNBOOK.md`, then delete it.
5. Production cut-over in a quiet window: stop writes on the office machine, run the final export and import, verify, switch DNS for the current host to AWS, then keep the office copy read-only for two weeks before wiping it.
6. Repeat the restore test against production and schedule it every quarter.

**Phase 1 is complete when** both completion tests for requirements 1 and 2 pass.

### Phase 2: domain (requirement 3), after franchisor confirmation

1. Decide the host name: the apex `supercuts.ai` or a subdomain such as `portal.supercuts.ai`.
2. Lower the TTL a day ahead. Move DNS to Route 53 or add records at 101domain.
3. Issue the ACM certificate and point the host at the load balancer (alias record).
4. Check the host-dependent behaviour:
   - The request forgery guard in `server/auth.js` compares the `Origin` host with the `Host` header, so the load balancer must pass the public host through unchanged.
   - Session cookies are host only, so everyone signs in once more.
   - `frameSrc` in `server/app.js:56` still names `academy.dogwoodbrands.com`. Update it if the Academy moves.
   - An app installed on a home screen from the old host stays tied to it, so people reinstall from the new address.
5. Redirect `supercutsportal.dogwoodbrands.com` to the new host with a permanent (301) redirect, kept for at least a year (Cloudflare redirect rule or a load-balancer rule).
6. Increase `VERSION` in `public/sw.js` (now `scp-v1-1-1`) in the release that goes live on the new host.
7. Update `README.md`, the sign-in instructions, the admin guide and any printed material.

The domain is a single configuration value in the infrastructure code. If the franchisor declines, only this phase changes.

### Phase 3: identity (requirement 4), before field rollout

| Item | Plan |
|---|---|
| Home office, leadership, HR, admins | Google sign-in (OpenID Connect) through an **Internal** Google Workspace app. The second factor is enforced by Workspace for these accounts. Accounts are matched on email. |
| Second factor without Google | Authenticator-app codes (TOTP) required for the `admin`, `hr` and `executive` roles on any account that does not use Google sign-in. Include recovery codes. |
| Stylists and salon managers | Emailed one-time sign-in links (SES, short expiry, single use, rate limited). Many have no email on file, so they need a fallback: text-message links (adds SMS cost and sender registration) or manager-issued invite codes using the existing invite API. Add the missing admin-console button for invites either way. |
| Real roster | Import from iSolved through Admin console, People, Import roster, with salon, manager and district assignments and `employee_id`. Then delete sample staff and their activity, and turn off the Preview marker (`settings.sample_data`). |
| Shared sign-ins | Remove `demo.*` and the shared `stylist` account from production. Keep the seed only for development and tests, and guard it so it cannot run against production. |
| Passwords that remain | Check new passwords against a known-breached list. Remove any path that sets a password shorter than 10 characters. |
| Sessions | Add "sign out everywhere" and a list of signed-in devices on the account page (the `sessions` table already stores address and browser). Use a shorter session for home-office roles. |
| Offboarding | Deactivating the portal account is part of the leaver checklist now. Automatic deactivation from iSolved is a later phase. |

**Phase 3 is complete when** every active employee has their own account and no shared password exists.

### Phase 4: data feeds (requirement 5 and v1.1)

1. **Pipeline into this repository.** Until the direct export exists, make `pipeline/` the running code (it is a reference copy today) and run it as a scheduled ECS task, so the office machine and the `dogwood-agents` workspace drop out.
2. **Direct DSR and DHR export.** A scheduled export from Zenoti (API or SFTP) or a scheduled report delivered to an S3 bucket, loaded by the existing `load-sales.js` step. The export must carry the DSR's run rate (or the agreed formula), because pace to goal uses it. This removes the mailbox, the hand-sent email and the month-to-date differencing. Backfill the missing history (all of 2026-08-01, four salon-days in July, one in June, three single-salon days in October) once it exists.
3. **Per-stylist feed.** Source to be confirmed with Emory Smith. Options:
   - the production or sales accrual report;
   - an existing franchisor-side report;
   - the Zenoti API.
   
   Fields: total sales, TSTH, Supercut Plus, haircuts, wet services and product sales, per stylist per day.
   - Map Zenoti employee ids to `users.employee_id`.
   - Interim: a manual CSV upload by the home office.
   - Code changes: stop `load-sales.js` deleting `stylist_daily`, add the new measures to `stylist_daily`, return personal figures from `GET /me/stats`, and add personal tiles to the pay-plan page.
   - Access rules stay as `rbac.canSeeStylistStats`: the stylist, plus managers and above with that salon in scope. HR is excluded.
   - The estimated bonus waits for verified thresholds from HR.
4. **Goals.** Decide whether product and per-hour goals come from the export or from the Goals screen. Today manual goals survive the load, and DSR-sourced rows are cleared.

**Phase 4 is complete when** sales arrive for a week with nobody sending an email.

### Before field rollout

- Independent security review of authentication, access rules and uploads (`test/scope.test.js` is the starting checklist).
- Accessibility pass with a screen reader and keyboard only on the feed, salon page and forms.
- Real salon hours, coordinates and district names (Admin console).
- Replace sample promos, standards and policies with approved content (CL / HR).
- Write down retention rules for audit entries, sessions, the HR who and when log (730 days today), and photos.
- Pilot with one district, then all salons (CL).

## 5. Order and timing

| Window | Phases |
|---|---|
| Week of 2026-11-17 | Phase 0 |
| 2026-11-30 | v1.1 launches on the current host, labelled Preview. Ask HR goes live as soon as Workspace setup is done (phase 0.7); it does not need AWS. |
| Late November to mid December | Phase 1 (database and hosting) |
| December | Phase 2 (domain), when the franchisor confirms |
| December to January | Phase 3 (identity), then the pilot district |
| Depends on Zenoti and franchisor access | Phase 4 (feeds); the manual per-stylist upload can ship earlier |

Phases 1 to 3 are about four to six weeks for one engineer. The field rollout should wait for phases 1 and 3.

## 6. Configuration notes

### 6.1 Ask HR sending permission

- Create the OAuth client in a Google Cloud project owned by the scsalons.com Workspace, with the app type set to **Internal**. An External app left in Testing status issues refresh tokens that expire after 7 days, and Ask HR would silently stop sending.
- Scope: `https://www.googleapis.com/auth/gmail.send` only.
- Store `SCP_MAIL_CLIENT_ID`, `SCP_MAIL_CLIENT_SECRET`, `SCP_MAIL_REFRESH_TOKEN` and `SCP_MAIL_FROM=HR@scsalons.com` in Secrets Manager, one secret per environment. Staging should send to a test inbox, not HR.
- Alternative: a service account with domain-wide delegation limited to `gmail.send`, impersonating HR@scsalons.com. There is no refresh token to expire, but it needs Workspace super-admin approval.

### 6.2 New environment variables

`DATABASE_URL`, `SCP_S3_BUCKET`, `SCP_SENTRY_DSN`, `SCP_GOOGLE_CLIENT_ID`, `SCP_GOOGLE_CLIENT_SECRET`, `SCP_SES_FROM`, and the four `SCP_MAIL_*` values. All come from Secrets Manager or the task definition, never from the repository.

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Franchisor declines supercuts.ai | Phase 2 blocked | Domain is one setting; launch on another address |
| No Zenoti or franchisor access for exports | Requirement 5 and individual numbers blocked | Start the conversation in phase 0; pipeline in this repo as the interim; manual per-stylist upload |
| Stylists without email | Requirement 4 incomplete | Decide on text links or invite codes with HR |
| Port regressions | Wrong numbers or access leaks | Data-access layer first, tests after each file, staging rehearsal with sales comparison |
| HR Gmail token expiry | Ask HR stops silently | Internal app, outbox age alarm, manual fallback stays |
| Video traffic grows | Data-transfer cost rises | CloudFront (1 TB a month in its free tier) |
| Old PostgreSQL version | Extended Support surcharge | Keep to a supported major version; plan an annual upgrade |

## 8. Running cost (US West, Oregon, list prices on 2026-11-17)

| Setup | Per month | Per year |
|---|---|---|
| Lean (Single-AZ database, no WAF) | $145 | about $1,740 |
| **Recommended** (Multi-AZ database, WAF, no NAT gateway) | **$182** | **about $2,190** |
| Maximum isolation (adds a NAT gateway for fully private tasks) | $208 | about $2,500 |

Outside AWS: Sentry $0 to $26 a month; GitHub Actions and the Gmail API are free.

## 9. Open decisions

| Decision | Who | Default if not decided |
|---|---|---|
| Fully automatic production deploys, or one approval click | ZM | Automatic after staging smoke tests pass |
| Apex `supercuts.ai` or a subdomain | ZM / CL | Apex |
| Sign-in for stylists without email: text links or invite codes | HR / ZM | Invite codes (no extra cost) |
| Google Workspace administrator for scsalons.com | ZM | Needed for 6.1 and Google sign-in |
| Per-stylist data source | ES / BM | Manual upload until confirmed |
| One AWS account or one per environment | ZM / BM | One account, fully separate resources |
| Setup option (section 8) | ZM / CL | Recommended |

## 10. Reconciliation with PRODUCTION-PLAN.md

Every item in PRODUCTION-PLAN.md is covered here, with these changes:

| PRODUCTION-PLAN.md | This plan |
|---|---|
| (a) RDS for PostgreSQL or Neon | RDS for PostgreSQL (AWS chosen) |
| (b) App Runner, ECS Fargate, Render or Fly.io | ECS Fargate behind a load balancer, with WAF |
| (b) Rate limits to Redis or PostgreSQL | PostgreSQL (no extra service) |
| (b) Uploads through the existing route | Pre-signed S3 upload and view URLs, so 200 MB videos do not pass through the app |
| (e) Load clears product and per-hour goals | Partly fixed in v1.1: manual goals survive. The source of truth is still to be decided. |
| (f) Staging from `main`, production from a tag | Production deploys from `main` after staging passes, as the requirement 2 completion test asks |
| (f) Restore rehearsal once a quarter | Also a cut-over step: requirement 1 is not done until a restore is tested |
| (g) Native apps | Unchanged and out of scope: stay a web app unless iOS push or app-store presence proves necessary |
| v1.1: Academy hosting before its 2027 launch | Out of scope here. The same AWS setup can host it later. Update `frameSrc` if its address changes. |

New in this plan:
- the AWS component choices;
- the HR relay lock and outbox alarm;
- the Internal-app requirement for the Gmail credentials;
- SES for sign-in links;
- migrations run as a one-off task;
- the cut-over and restore steps;
- the cost estimate;
- the Extended Support risk.

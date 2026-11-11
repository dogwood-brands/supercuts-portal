# SC Portal

SC Portal is the employee and leadership portal for the SC Entities Supercuts salons (51 active salons in California, Nevada and Arizona).
Stylists and salon managers use it for their salon's numbers, promos, standards, training, checklists, support tickets and team recognition.
District leaders, HR and leadership use the same portal with wider access, plus an admin console for people, content and goals.

It is modelled on the "Prime Portal" Chris Larkins designed: a company feed with shout-outs, a page for every salon, hub sections, and levels of access.

## Status

| | |
|---|---|
| Version | 1.0 (demo) |
| Live at | https://supercutsportal.dogwoodbrands.com |
| Sales data | Real, by salon. Loaded from the daily DSR and DHR reports at 11:20 AM and 3:20 PM Central. The portal shows only figures those reports provide. |
| Salons, districts, district leaders, leadership | Real |
| Stylists, salon managers, posts, tickets | Sample names and activity. There are no per-stylist sales figures: the reports are by salon, so people see their salon's numbers and are ranked on recognition only. |
| Promos, standards, policies | Sample content, editable in the admin console |

The plan to take this from demo to production is in [docs/PRODUCTION-PLAN.md](docs/PRODUCTION-PLAN.md).

## Quick start

Requires Node 22 or newer. There is no build step.

```sh
npm install
npm run seed      # creates data/portal.db with the organisation and sample data
npm start         # http://127.0.0.1:3996
npm test          # 47 tests: sign-in, access rules, HR privacy, uploads, imports
```

`npm run seed` writes the generated sign-ins to `data/demo-logins.txt` (readable only by the current user). It is never committed.
A freshly seeded database holds sample sales and sample per-stylist figures; the first real load replaces the former and removes the latter. To load the real ledger, see "The KPI pipeline" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Starting the server on an empty, unseeded database creates a single `admin` account and prints its one-time password to the log.

## Project map

| Path | What it holds |
|---|---|
| `SPEC.md` | The build contract: roles, data model, API, frontend rules. Section 10 holds binding clarifications. |
| `server/` | Express app. `app.js` wires it, `index.js` starts it, `auth.js` and `rbac.js` decide access, `kpi.js` computes the numbers. |
| `server/routes/` | One file per API area: auth, feed, salons, ops, hr, content, admin. |
| `server/migrations/` | Numbered, forward-only SQL migrations. |
| `server/import/` | Sales import: `dsr.js` (ledger CSV), `load-sales.js` (scheduled load), `csv.js` (parser). |
| `server/seed/` | `org.js` (real roster), `sample.js` (sample people and activity), `run.js` (entry point). |
| `scripts/` | Backup, create an admin, reset a password, read DSR targets and run rates, refresh sales. |
| `pipeline/` | Reference copies of the two report scripts that run from the parent workspace, with a short README. |
| `ops/` | LaunchAgent definitions and `RUNBOOK.md`. |
| `content/` | Seed content as JSON: promos, resources, videos, checklists, events, values. |
| `public/` | The web app: `index.html`, `js/app.js` (shell and router), `js/core/` (helpers), `js/pages/` (one module per page), `css/`, `media/`, `sw.js`. |
| `test/` | `node:test` suites and the shared harness in `helpers.js`. |
| `data/` | Runtime only: database, uploads, backups, logins. Ignored by git. |

## Documentation

| Document | For |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built and why |
| [docs/HOW-TO-CHANGE.md](docs/HOW-TO-CHANGE.md) | Step-by-step recipes for common changes |
| [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | Running the portal from the admin console, no code |
| [docs/PRODUCTION-PLAN.md](docs/PRODUCTION-PLAN.md) | Moving to a managed database, managed hosting and the production domain |
| [ops/RUNBOOK.md](ops/RUNBOOK.md) | Start, stop, back up, restore on the current host |
| [SPEC.md](SPEC.md) | The contract the code is written against |

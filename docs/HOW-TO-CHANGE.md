# How to change things

Task-based recipes. Paths are relative to the repository root. Read "Ship a change safely" at the end before deploying any of them.

There is no build step. Edit a file, reload the browser, and the change is there. Server changes need a restart.

## Contents

1. [Change a colour or font](#1-change-a-colour-or-font)
2. [Change the wording on a page](#2-change-the-wording-on-a-page)
3. [Add a page and a navigation item](#3-add-a-page-and-a-navigation-item)
4. [Add an API endpoint](#4-add-an-api-endpoint)
5. [Add a database column](#5-add-a-database-column)
6. [Add a permission or a role](#6-add-a-permission-or-a-role)
7. [Change the sales refresh times](#7-change-the-sales-refresh-times)
8. [Add a recognition value](#8-add-a-recognition-value)
9. [Replace the sample team with the real roster](#9-replace-the-sample-team-with-the-real-roster)
10. [Reset a password](#10-reset-a-password)
11. [Ship a change safely](#11-ship-a-change-safely)

## 1. Change a colour or font

Every colour, type size, radius and motion value is a custom property in `public/css/tokens.css`. Nothing else should hold a hex value.

1. Open `public/css/tokens.css`.
2. Brand accent (bronze, `#8a6a3e`, with `#c9aa7c` on dark; red is deliberately not used): change `--brand` (accent on light surfaces), `--brand-ink` (accent text), `--brand-soft` (tint behind accent) and `--brand-bright` (accent on the dark sidebar). Change `--ring` to the same hue so focus outlines match.
3. Status colours are separate on purpose: `--good`, `--warn`, `--bad`. Do not point `--bad` at the brand colour; off-track tiles would stop reading as warnings.
4. Fonts: replace the two `.woff2` files in `public/fonts/` and update the `@font-face` blocks and `--font-display` / `--font-text` at the top of `tokens.css`. If the file names change, also update the two `<link rel="preload">` lines in `public/index.html` and the `SHELL` list in `public/sw.js`.
5. App icon: edit `public/media/icons/favicon.svg`, then regenerate the PNG sizes listed in `public/manifest.webmanifest` from it.
6. Check contrast on both the light page and the dark sidebar, then follow section 11.

## 2. Change the wording on a page

1. Find the text. Each page is one file in `public/js/pages/`; admin sections are in `public/js/pages/admin/`. Searching the folder for a distinctive phrase is the fastest way: `grep -rn "Check the boxes" public/js`.
2. Sidebar labels and the sign-in screen are in `public/js/app.js` (`navModel()` and `renderLogin()`).
3. Edit the string in place. Text passed to `h()` is always inserted as text, so punctuation and quotes need no escaping beyond normal JavaScript.
4. Server-side messages (validation errors, notifications) are in `server/routes/*.js` next to the check that raises them.
5. Content that people read as documents (promos, standards, policies, product sheets, checklists, events) is data, not code. Change it in the admin console under Content. See `docs/ADMIN-GUIDE.md`.

House style: sentence case, short, plain. Say "salon", "guest", "stylist".

## 3. Add a page and a navigation item

Example: a "Schedules" page at `#/schedules`.

1. Create `public/js/pages/schedules.js`:

   ```js
   import { h } from '../core/dom.js';
   import { api } from '../core/api.js';
   import { ui } from '../core/ui.js';

   export default {
     title: 'Schedules',
     async render(ctx) {
       try {
         const data = await api.get('/events');
         return h('div', null,
           ui.pageHeader({ eyebrow: 'Run the salon', title: 'Schedules' }),
           ui.card({ title: 'This month' }, `${data.items.length} dates`));
       } catch (err) {
         return ui.errorState(err, () => ctx.navigate('/schedules'));
       }
     },
   };
   ```

2. Register the route: add `['/schedules', 'schedules'],` to the `ROUTES` array in `public/js/app.js`. The second value is the module file name without `.js`.
3. Add the navigation item: in `navModel()` in the same file, add `{ path: '/schedules', label: 'Schedules', icon: 'calendar' }` to the right group. Icon names are the keys in `public/js/core/icons.js`.
4. To show it only to some people, wrap it: `can('tickets.work') ? { ... } : null`. Null entries are filtered out. This only hides the link; the server must still refuse the data (section 4).
5. Page-specific styles: create `public/css/pages/schedules.css` and add `css: true` to the module. The router loads the file before first render.
6. Use `ui.skeleton(...)` while loading, `ui.empty(...)` for no data and `ui.errorState(err, retry)` on failure. Check the page at 360 px and 1440 px.

## 4. Add an API endpoint

Example: `GET /api/salons/:id/notes`, visible to people with that salon in scope.

1. Pick the route file for the area (`server/routes/salons.js` here). Routes are plain Express handlers; a thrown error becomes the standard JSON error.
2. Add the handler:

   ```js
   r.get('/salons/:id/notes', (req, res) => {
     const id = idParam(req);
     if (!db.prepare('SELECT 1 FROM salons WHERE id = ?').get(id)) throw notFound('We could not find that salon.');
     rbac.requireSalonScope(req.user, id);            // 403 outside the caller's salons
     const items = db.prepare('SELECT id, body, created_at FROM salon_notes WHERE salon_id = ? ORDER BY id DESC LIMIT 100').all(id);
     res.json({ items });
   });
   ```

3. Choose the right guard:
   - a whole route for one permission: `r.get('/x', requirePerm('admin.content'), handler)`;
   - rows limited by salon: `rbac.requireSalonScope(req.user, salonId)` or filter with `rbac.scopeSalonIds(req.user)`;
   - dollar figures: check `can(req.user, 'kpi.dollars')` and that the salon is in scope before sending any `*_c` field.
4. Validate every input with the helpers in `server/util.js` (`v.str` with a `max`, `v.int`, `v.oneOf`, `v.date`). Use prepared statements with `?` placeholders only.
5. For a write, call `audit(req, 'salon_note.created', 'salon_note', id)` if it changes people, roles, content, settings, moderation or HR data.
6. Add a test in `test/scope.test.js` (or a new `test/*.test.js`):

   ```js
   test('salon notes: in scope reads, out of scope is refused', async () => {
     assert.equal((await manager.get(`/api/salons/${MDR}/notes`)).status, 200);
     assert.equal((await manager.get(`/api/salons/${LV}/notes`)).status, 403);
   });
   ```

7. Run `npm test`. Document the endpoint in `SPEC.md` section 5 so the contract stays true.

Non-GET requests from the browser already carry the required `X-SCP` header through `api.post`, `api.put`, `api.patch` and `api.del`.

## 5. Add a database column

Never edit `001_init.sql` and never change the database by hand.

1. Create the next numbered file after the highest one in `server/migrations/` (currently `002_dsr_run_rate.sql`), for example `003_salon_timezone.sql`:

   ```sql
   ALTER TABLE salons ADD COLUMN timezone TEXT;
   ```

2. Take a backup: `npm run backup`.
3. Apply it: restart the server, or run `npm run migrate`. Each file runs once, inside a transaction, and is recorded in `schema_migrations`.
4. Read and write the column in the relevant route. For tables managed by the generic admin CRUD (`salons`, `districts`, `markets`, `promos`, `resources`, `videos`, `events`, `checklist_templates`), add a validator for the new column to that table's `fields` object in `server/routes/admin.js`.
5. If the seed should set it, update `server/seed/org.js` or `server/seed/sample.js`.
6. Add the column to `SPEC.md` section 4 and run `npm test`.

SQLite cannot drop or retype a column in place in every case. For anything beyond adding a column, write the migration as: create the new table, copy the rows, drop the old table, rename.

## 6. Add a permission or a role

**A permission** (the common case):

1. Add the name to the right roles in `PERMISSIONS` in `server/rbac.js`.
2. Guard routes with `requirePerm('your.permission')`.
3. In the frontend, test it with `ctx.can('your.permission')` in a page, or `can(...)` in `navModel()`. The list reaches the browser in `GET /api/auth/me` as `user.permissions`.
4. Add a test that a role without it receives 403.

**A role** (rare; touches more places):

1. `server/rbac.js`: add it to `ROLES`, `RANK`, `PERMISSIONS`, and to `HOME_OFFICE` if it is a home-office role. Decide its salon scope in `scopeSalonIds`.
2. The `users.role` column has a `CHECK` constraint listing the six roles. Add a migration that rebuilds the `users` table with the new list (see the note at the end of section 5).
3. `public/js/core/format.js`: add the display name to `ROLE_LABELS`.
4. `public/js/pages/admin/people.js` and `public/js/pages/directory.js`: add it to the role pickers.
5. Decide who may create it: `assertCanManage` in `server/routes/admin.js`.
6. Update the role table in `SPEC.md` section 3 and add scope tests.

## 7. Change the sales refresh times

The schedule lives in two places that must agree.

1. `ops/com.dogwood.supercuts-portal-sales.plist`: edit the `Hour` and `Minute` pairs under `StartCalendarInterval`. Times are the host's local clock (Central).
2. `server/refresh.js`: edit `RUN_TIMES` to the same pairs, and the wording in `schedule_label`.
3. Update the comment at the top of `scripts/refresh-sales.sh`.
4. Reinstall the job:

   ```sh
   cp ops/com.dogwood.supercuts-portal-sales.plist ~/Library/LaunchAgents/
   launchctl bootout gui/$(id -u)/com.dogwood.supercuts-portal-sales
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dogwood.supercuts-portal-sales.plist
   ```

5. Restart the portal so the "Next refresh" line uses the new times (section 11, step 4).
6. To load now instead of waiting: `bash scripts/refresh-sales.sh`, then read the last lines of `../logs/supercuts-portal-sales.log`.

## 8. Add a recognition value

The values people pick when giving a shout-out are a setting, not code.

1. Sign in as an administrator and open Admin console, Settings.
2. Add a row under the recognition values: a key (lower-case letters, numbers, dashes or underscores, for example `goes_further`), a label, and an optional one-line meaning. The limit is 12 values.
3. Save. The new value appears in the shout-out composer on the next page load.
4. To make it part of a fresh seed as well, add it to `content/values.json`.

Do not rename the key of a value that has been used: existing shout-outs store the key.

## 9. Replace the sample team with the real roster

1. Take a backup: `npm run backup`.
2. Prepare a CSV with a header row. Required columns: `first_name`, `last_name`, `role`. `salon_number` is required for stylists and salon managers. Optional: `username`, `email`, `title`, `phone`, `hire_date` (`YYYY-MM-DD`), `birthday_md` (`MM-DD`).

   ```csv
   first_name,last_name,role,salon_number,hire_date
   Jordan,Reyes,salon_manager,8495,2019-04-01
   Sam,Okafor,stylist,8495,2023-08-14
   ```

   `role` is one of `stylist`, `salon_manager`, `district_leader`, `hr`, `executive`, `admin`. A blank role is treated as `stylist`. Without a `username`, one is generated as `first.last`.
3. Admin console, People, Import roster. Up to 300 rows per file. The result lists every new username with a one-time password, and every skipped row with the reason. Copy the list before closing it: the passwords are shown once.
4. Deactivate the sample people: Admin console, People, set each sample account to Inactive (their posts stay), or remove the sample accounts in bulk with a one-off script against a backup-tested database.
5. Sample posts, tickets and HR inquiries were written by the sample accounts and stay in the feed after those accounts are deactivated. There is no built-in tool that removes sample activity while keeping real accounts. Clearing it is a one-off database task: take a backup, write the deletes against a copy, check the result, then apply. `docs/PRODUCTION-PLAN.md` lists this under Phase 2.
6. Turn off the preview marker when no sample data remains: Admin console, Settings, sample data switch.

Only an administrator can import administrator or executive accounts. HR can import everyone else.

## 10. Reset a password

- **In the portal:** Admin console, People, find the person, Reset password. They are signed out everywhere and a one-time password is shown once. They choose their own at next sign-in.
- **From the terminal**, when nobody can reach the admin console:

  ```sh
  node scripts/reset-password.js some.username
  node scripts/create-admin.js jane.doe "Jane" "Doe" jane@example.com
  ```

  Both print a one-time password and write a `cli.*` entry to the audit log.

- **Yourself:** account menu, Account and password. New passwords need at least 10 characters.

## 11. Ship a change safely

1. `npm test` must pass.
2. If anything under `public/` changed, increase the number in `const VERSION = 'scp-v1-N'` at the top of `public/sw.js`. Installed phones only drop their cached shell when this changes.
3. If the database changed, take a backup first: `npm run backup`.
4. Restart the server (needed for any change under `server/`; static files need no restart):

   ```sh
   launchctl kickstart -k gui/$(id -u)/com.dogwood.supercuts-portal
   curl http://127.0.0.1:3996/healthz
   ```

5. Sign in as a stylist and as an administrator and open the page you changed, on a phone-width window as well as a desktop one.
6. Commit with a message that says what changed and why. Keep `SPEC.md` in step with any change to roles, tables or API shapes.

If something goes wrong, restore from the backup using the steps in `ops/RUNBOOK.md`.

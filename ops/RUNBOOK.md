# SC Portal runbook

Everything needed to run the portal day to day. Commands are run from
`/Users/dogwoodbrandscompany/dogwood-agents/supercuts-portal` unless noted.

| What | Where |
|---|---|
| App | `server/` (Node 22, Express, SQLite). No build step. |
| Database | `data/portal.db` (plus `-wal` and `-shm` beside it while running) |
| Uploaded photos | `data/uploads/` |
| Backups | `data/backups/` (newest 30 kept) |
| Logs | `../logs/supercuts-portal.log` and `supercuts-portal.err.log` |
| Port | `3996`, bound to `127.0.0.1` (the tunnel is the only way in) |
| Health check | `curl http://127.0.0.1:3996/healthz` returns `{"ok":true,...}` |

## Start, stop, restart

The portal runs as a LaunchAgent so it starts at login and restarts itself if it stops.

```sh
# install (once)
cp ops/com.dogwood.supercuts-portal.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist

# restart (after changing code or settings in the plist)
launchctl kickstart -k gui/$(id -u)/com.dogwood.supercuts-portal

# stop
launchctl unload ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist

# run by hand in a terminal instead (stop the LaunchAgent first)
PORT=3996 node server/index.js
```

On start the server applies any new database migrations, then listens. On a brand-new, empty database it
creates one account called `admin` and prints a one-time password to the log (or uses `SCP_ADMIN_PASSWORD`
if that is set). Shutdown is graceful: open requests finish first.

Environment variables (set in the plist):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3996 | Port to listen on |
| `HOST` | 127.0.0.1 | Address to bind |
| `SCP_COOKIE_SECURE` | unset | Optional. Behind the tunnel the cookie is already marked Secure (the server trusts one proxy hop and reads the HTTPS header). Set to `1` only to force it |
| `SCP_DB` | `data/portal.db` | Database file |
| `SCP_UPLOADS` | `data/uploads` | Uploaded photos |
| `SCP_ADMIN_PASSWORD` | unset | Password for the first `admin` account on an empty database |

## Back up

```sh
sh scripts/backup.sh
```

Safe to run while the portal is in use. It writes `data/backups/portal_<date>_<time>.db.gz` (checked for
integrity before it is kept) and `uploads_<date>_<time>.tar.gz`, then prunes to the newest 30 of each.

To run it every night at 2:30 am:

```sh
cp ops/com.dogwood.supercuts-portal-backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dogwood.supercuts-portal-backup.plist
```

`data/backups/` is on the same disk as the portal. Copy it somewhere else as well (the NAS or Drive);
a backup on the same machine does not protect against losing the machine.

## Restore

```sh
launchctl unload ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist      # 1. stop
mv data/portal.db data/portal.db.before-restore                                  # 2. keep the current file
rm -f data/portal.db-wal data/portal.db-shm
gunzip -c data/backups/portal_YYYY-MM-DD_HHMMSS.db.gz > data/portal.db           # 3. put the backup in place
tar -xzf data/backups/uploads_YYYY-MM-DD_HHMMSS.tar.gz -C data                   # 4. photos (optional)
launchctl load ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist         # 5. start
curl http://127.0.0.1:3996/healthz                                               # 6. check
```

Everyone stays signed in if their session existed at the time of the backup; otherwise they sign in again.

## People

Day to day, use **Admin → People** in the portal (HR and administrators):

- **Add a person**: enter name, role and salon. The portal shows a one-time password once. Give it to them;
  they must choose their own at first sign-in.
- **Add many people**: Admin → People → Import, with a CSV whose columns are
  `first_name,last_name,role,salon_number` (optional: `username,email,title,phone,hire_date,birthday_md`).
  Up to 300 rows at a time. The result lists each new username with its one-time password, and any rejected
  lines with the reason.
- **Invite code**: Admin → People → Invite creates a single-use code tied to a role and salon. The person
  picks their own username and password.
- **Someone leaves**: set their status to Inactive. They are signed out immediately and cannot sign in.
  Their posts and history stay.
- **Reset a password**: Admin → People → Reset password. It signs them out everywhere and shows a new
  one-time password.

Only administrators can create or change administrator and executive accounts. HR can manage everyone else.

From the terminal, when nobody can get into Admin:

```sh
node scripts/create-admin.js jane.doe "Jane" "Doe" jane@example.com   # new administrator, prints a one-time password
node scripts/reset-password.js some.username                          # new one-time password for any account
```

Both are recorded in the audit log as `cli.*`.

## Import the daily sales report (DSR)

The portal reads the same daily ledger the weekly pulse uses: `dogwood-agents/data/dsr-dhr/daily.csv`.
Columns: `date, store_id, center_name, region, daily_net_sales, daily_haircuts, daily_tickets,
daily_clocked_hours, daily_service_rev, daily_product_rev, daily_supercut_plus`.

- In the portal: **Admin → Data import**, choose the file. (Administrators only.)
- From the terminal: `node server/import/dsr.js ../data/dsr-dhr/daily.csv`

`store_id` is matched to the salon number. Rows are matched on salon and date, so importing the same file
again is safe: it updates rather than duplicates. The result shows rows loaded, salons covered, the date
range, and every rejected row with a reason (unknown store, bad date, a value that is not a number).

**Before the first real import.** The preview database contains invented sample numbers. Loading real
figures on top of them would mix the two. To go live with real data:

1. Take a backup.
2. Remove the sample KPI rows: `sqlite3 data/portal.db "DELETE FROM kpi_daily WHERE source='sample'; DELETE FROM stylist_daily;"`
3. Import the real ledger.
4. Set real goals in **Admin → Goals** for the current month.
5. Turn off the preview marker: **Admin → Settings → Sample data**.

Per-stylist numbers (`stylist_daily`) have no import yet; the stylist views stay empty until one is added.

## Change the database (migrations)

Never edit the database structure by hand and never edit a migration that has already run.

1. Add the next numbered file in `server/migrations/`, for example `002_add_salon_timezone.sql`, containing
   plain SQL (`ALTER TABLE salons ADD COLUMN timezone TEXT;`).
2. Take a backup.
3. Restart the portal. It applies new files in order, each inside a transaction, and records them in the
   `schema_migrations` table. `npm run migrate` does the same without starting the server.
4. Run `npm test`.

## Tests

```sh
npm test
```

Covers sign-in, session expiry, the request-forgery guard, every access rule (who can see which salon's
numbers, tickets, HR inquiries, admin screens), feed audiences, upload checks and the sales import. Run it
after any change to `server/`.

## Resetting the preview

```sh
launchctl unload ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist
npm run seed:reset        # deletes data/portal.db and rebuilds the organisation + sample data
launchctl load ~/Library/LaunchAgents/com.dogwood.supercuts-portal.plist
```

This writes fresh preview and leadership passwords to `data/demo-logins.txt` (readable only by this user).
It refuses to delete a database that holds imported sales unless `--yes` is added. Do not run it once the
portal is live with real people.

## When something is wrong

| Symptom | Check |
|---|---|
| Site does not load | `curl http://127.0.0.1:3996/healthz`. No answer: look at `../logs/supercuts-portal.err.log`, then restart. Answers locally but not from outside: the tunnel. |
| "Too many sign-in attempts" | Ten tries per username per 15 minutes. Wait, or restart the portal to clear it. |
| Someone is locked out | Reset their password (above). |
| Numbers look stale | The salon page shows "updated through" the last imported day. Import the latest ledger. |
| Disk filling up | `du -sh data/*`. Photos live in `data/uploads`; backups prune themselves to 30. |
| Who changed something? | **Admin → Audit log**, or `sqlite3 data/portal.db "SELECT created_at, action, target_type, target_id FROM audit_log ORDER BY id DESC LIMIT 50;"` |

## Daily sales refresh (current setup)

Sales load automatically; the manual import steps above are only a fallback.

- `scripts/refresh-sales.sh` downloads new DSR / DHR report emails, rebuilds the ledger, reads targets and run-rate
  (`scripts/dsr-targets.py`) and loads everything (`server/import/load-sales.js`). Safe to run by hand at any time.
- It runs at 11:20 AM and 3:20 PM Central from `ops/com.dogwood.supercuts-portal-sales.plist`.
  The same times are listed in `server/refresh.js`, which produces the "Next refresh" note on salon pages. Change both together.
- Log: `dogwood-agents/logs/supercuts-portal-sales.log`. Each run ends with a line starting with the time and "loaded".
- The load clears sample per-stylist figures and sample product % / per-hour goals every time, and resets each salon's
  sales goal and run-rate from the report. Treat **Admin → Goals** as read only while this is in place.
- The reports are sent by hand each morning. If one has not arrived by 3:20 PM, the portal keeps yesterday's numbers
  and says so ("through" date on every salon page).

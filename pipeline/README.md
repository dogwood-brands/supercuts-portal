# Sales report pipeline (running code)

These scripts turn the daily DSR and DHR report emails into the ledger the portal loads. Since the
Nov 30 go-live they run from this repository on the office machine, scheduled at 11:20 AM and 3:20 PM
Central by `ops/com.dogwood.supercuts-portal-sales.plist`; `scripts/refresh-sales.sh` runs all four
steps and is safe to run by hand. See `ops/RUNBOOK.md` for set-up.

| Step | Script | Output |
|---|---|---|
| 1 | `pipeline/dsr-dhr-download.py` | report workbooks in `data/dsr-dhr/raw/` |
| 2 | `pipeline/dsr-dhr-parse.py` | `data/dsr-dhr/daily.csv` (one row per salon per day) |
| 3 | `scripts/dsr-targets.py` | `data/dsr-targets.csv` (monthly target per salon) |
| 4 | `server/import/load-sales.js` | rows in the portal database |

Every path is env-configurable so the same scripts move to a scheduled ECS task after the AWS
cut-over (phase 4) without edits:

| Variable | Used by | Default |
|---|---|---|
| `SCP_PIPELINE_RAW_DIR` | download, parse, targets | `data/dsr-dhr/raw` (repo) |
| `SCP_PIPELINE_OUT_DIR` | parse | `data/dsr-dhr` (repo) |
| `SCP_TARGETS_FILE` | targets, load-sales | `data/dsr-targets.csv` (repo) |
| `SCP_GMAIL_CREDENTIALS_FILE` | download | office machine `.gmail-mcp/credentials.json` |
| `SCP_GMAIL_OAUTH_KEYS_FILE` | download | office machine `.gmail-mcp/gcp-oauth.keys.json` |

The download reads `(from:reports@scsalons.com OR from:es@dogwoodbrands.com) has:attachment
(DSR OR DHR)` — reports sent by hand by Emory carry a subject date that is checked against the day
the email was actually sent. The parser tolerates the quirks of the Google Sheets exports: `FILTER()`
formulas left as text, blank `Net Sales MTD` (reconstructed from service + product), and month-to-date
columns that go down (that day is skipped rather than loading a wrong number). `test/pipeline.test.js`
covers all of this against synthetic workbooks.

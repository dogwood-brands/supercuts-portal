# Sales report pipeline (reference copy)

These two scripts turn the daily DSR and DHR report emails into the ledger the portal loads.
They run from the parent `dogwood-agents` workspace (`scripts/`), because other jobs share them;
the copies here are a snapshot taken on 2026-11-11 so the whole pipeline can be read in one place.

| Step | Script | Output |
|---|---|---|
| 1 | `dsr-dhr-download.py` | report workbooks in `data/dsr-dhr/raw/` |
| 2 | `dsr-dhr-parse.py` | `data/dsr-dhr/daily.csv` (one row per salon per day) |
| 3 | `../scripts/dsr-targets.py` | `data/dsr-targets.csv` (monthly target per salon) |
| 4 | `../server/import/load-sales.js` | rows in the portal database |

`../scripts/refresh-sales.sh` runs all four. See `docs/ARCHITECTURE.md`.

#!/usr/bin/env python3
"""Read each month's sales target per salon from the DSR workbooks ("BY TL" sheet) and write
data/dsr-targets.csv (period, salon_number, target_dollars, run_rate_dollars). The last DSR of a month carries that
month's final targets. A DSR dated N reports through N-1, so its month is the month of N-1."""
import csv, glob, os, re, sys
from datetime import date, timedelta
import openpyxl

RAW = "/Users/dogwoodbrandscompany/dogwood-agents/data/dsr-dhr/raw"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "dsr-targets.csv")

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def targets(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if "BY TL" not in wb.sheetnames: return {}
    rows = list(wb["BY TL"].iter_rows(values_only=True))
    hdr_i = next((i for i, r in enumerate(rows[:8]) if r and any(str(c).strip() == "#" for c in r if c is not None)), None)
    if hdr_i is None: return {}
    hdr = [str(c).strip() if c is not None else "" for c in rows[hdr_i]]
    c_num = hdr.index("#")
    norm = [re.sub(r"\s+", " ", h).lower() for h in hdr]
    c_tgt = next((i for i, h in enumerate(norm) if "net rev" in h and "tar" in h), None)
    if c_tgt is None or c_tgt < 1: return {}
    c_pct = c_tgt + 1
    out = {}
    for r in rows[hdr_i + 1:]:
        if len(r) <= c_pct: continue
        sid, rr, tgt, pct = r[c_num], num(r[c_pct - 2]), num(r[c_pct - 1]), num(r[c_pct])
        if sid is None or not str(sid).strip().isdigit() or not tgt or tgt < 1000: continue
        # the sheet's own ratio must agree, or the columns are not what we think they are
        if rr and pct and abs(rr / tgt - pct) > 0.01: continue
        out[str(sid).strip()] = (round(tgt, 2), round(rr, 2) if rr else "")
    return out

latest = {}
for p in sorted(glob.glob(os.path.join(RAW, "DSR_*.xlsx"))):
    m = re.search(r"DSR_(\d{4})-(\d{2})-(\d{2})\.xlsx", p)
    if not m: continue
    period = (date(*map(int, m.groups())) - timedelta(days=1)).strftime("%Y-%m")
    latest[period] = p
rows = []
for period, p in sorted(latest.items()):
    try: t = targets(p)
    except Exception as e:
        print(f"  {period}: could not read {os.path.basename(p)} ({e})", file=sys.stderr); continue
    print(f"  {period}: {len(t)} targets from {os.path.basename(p)}, total ${sum(v[0] for v in t.values()):,.0f}", file=sys.stderr)
    rows += [(period, sid, v[0], v[1]) for sid, v in sorted(t.items())]
with open(OUT, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["period", "salon_number", "target_dollars", "run_rate_dollars"]); w.writerows(rows)
print(f"wrote {len(rows)} targets -> {OUT}", file=sys.stderr)

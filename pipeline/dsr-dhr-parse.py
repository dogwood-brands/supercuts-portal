#!/usr/bin/env python3
"""
Parse DSR + DHR xlsx files into a daily ledger.

DSR Input sheet schema (per location row):
  Center Name | Haircuts RR | Net Sales RR | Haircuts MTD | Net Sales MTD |
  Service Tickets MTD | ATV MTD | Clocked Hours | Total Sales/Total Hours |
  Service Revenue MTD | Product Revenue MTD | Supercut Plus | Region

DHR Input sheet schema:
  Center Name | Hours 05/11 | Hours 05/12 | ... | Hours 05/17

Outputs:
  data/dsr-dhr/snapshots.csv  — one row per store per DSR date with MTD values
  data/dsr-dhr/dhr_hours.csv  — one row per store per calendar date with daily hours
  data/dsr-dhr/daily.csv      — derived daily sales = MTD_today - MTD_prev_day_same_month
"""
import csv
import glob
import os
import re
from datetime import date, datetime, timedelta

import openpyxl

RAW_DIR = "/Users/dogwoodbrandscompany/dogwood-agents/data/dsr-dhr/raw"
OUT_DIR = "/Users/dogwoodbrandscompany/dogwood-agents/data/dsr-dhr"

# Cali pattern: "01 APPLE VALLEY 80660" -> 80660 (trailing 4-5 digit)
# NV/AZ pattern: "LV02 - 82298 - Sahara Town Sqr", "EE03 - 82614 - ..." -> first standalone 4-5 digit after entity code
# SmartStyle: name is literally "Smartstyle" (no salon # in cell) -> hardcoded 18828
CALI_STORE_RE = re.compile(r"^\s*\d{1,2}\s+.+?\s+(\d{4,5})\s*$")
NVAZ_STORE_RE = re.compile(r"^\s*(?:EE|LV|PH)\d{2}\s*-\s*(\d{4,5})\s*-")
SMARTSTYLE_ID = 18828

SKIP_NAMES = {"center name", "^ total", "grand total", ""}


def parse_store_id(center_name):
    if not isinstance(center_name, str):
        return None
    name = center_name.strip()
    if name.lower() in SKIP_NAMES:
        return None
    m = CALI_STORE_RE.match(name)
    if m:
        return int(m.group(1))
    m = NVAZ_STORE_RE.match(name)
    if m:
        return int(m.group(1))
    if name.lower() == "smartstyle":
        return SMARTSTYLE_ID
    return None


def to_float(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s.startswith("FILTER(") or s.startswith("#"):
            return None
        try:
            return float(s.replace("$", "").replace(",", ""))
        except ValueError:
            return None
    return None


def parse_dsr(path):
    """Return list of dicts: store_id, net_sales_mtd, haircuts_mtd, tickets_mtd,
    clocked_hours, service_rev_mtd, product_rev_mtd, supercut_plus, atv_mtd,
    haircuts_rr, net_sales_rr, region."""
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Input"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        center, haircuts_rr, sales_rr, haircuts_mtd, sales_mtd, tickets_mtd, atv_mtd, \
            clocked, sales_per_hr, service_mtd, product_mtd, scp, region, *_ = list(r) + [None]*13
        sid = parse_store_id(center)
        if not sid:
            continue
        # Some recent DSR exports leave "Net Sales MTD" blank but populate Service + Product MTD.
        # Net sales = service + product, so reconstruct it when blank to keep the daily ledger intact.
        _net = to_float(sales_mtd)
        if _net is None:
            _sv, _pr = to_float(service_mtd), to_float(product_mtd)
            if _sv is not None or _pr is not None:
                _net = (_sv or 0.0) + (_pr or 0.0)
        rows.append({
            "store_id": sid,
            "center_name": center,
            "region": region,
            "haircuts_rr": to_float(haircuts_rr),
            "net_sales_rr": to_float(sales_rr),
            "haircuts_mtd": to_float(haircuts_mtd),
            "net_sales_mtd": _net,
            "tickets_mtd": to_float(tickets_mtd),
            "atv_mtd": to_float(atv_mtd),
            "clocked_hours_mtd": to_float(clocked),
            "sales_per_hour_mtd": to_float(sales_per_hr),
            "service_rev_mtd": to_float(service_mtd),
            "product_rev_mtd": to_float(product_mtd),
            "supercut_plus_mtd": to_float(scp),
        })
    return rows


def parse_dhr(path):
    """Return list of dicts: store_id, date, hours (daily). Skips empty/formula values."""
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Input"]
    # Header has 'Hours MM/DD' columns
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    # Find file's referenced year — use filename
    fn = os.path.basename(path)
    m = re.search(r"DHR_(\d{4})-(\d{2})-(\d{2})\.xlsx", fn)
    file_year = int(m.group(1)) if m else date.today().year
    # Map each Hours column to a date
    date_cols = []
    for idx, hdr in enumerate(header):
        if isinstance(hdr, str) and hdr.startswith("Hours "):
            md = hdr.replace("Hours ", "").strip()
            try:
                mm, dd = md.split("/")
                d = date(file_year, int(mm), int(dd))
                # Heuristic for year-rollover: if header month > file month + 1, prior year
                date_cols.append((idx, d))
            except Exception:
                pass
    out = []
    for r in rows_iter:
        if not r or r[0] is None:
            continue
        sid = parse_store_id(r[0])
        if not sid:
            continue
        for idx, d in date_cols:
            v = to_float(r[idx]) if idx < len(r) else None
            if v is None:
                continue
            out.append({"store_id": sid, "date": d.isoformat(), "hours": v})
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # ---- DSR snapshots (one row per file per store) ----
    snapshot_rows = []
    dsr_paths = sorted(glob.glob(os.path.join(RAW_DIR, "DSR_*.xlsx")))
    for p in dsr_paths:
        fn = os.path.basename(p)
        m = re.search(r"DSR_(\d{4}-\d{2}-\d{2})\.xlsx", fn)
        if not m:
            continue
        snap_date = m.group(1)
        for r in parse_dsr(p):
            r["snapshot_date"] = snap_date
            snapshot_rows.append(r)

    snap_path = os.path.join(OUT_DIR, "snapshots.csv")
    if snapshot_rows:
        fieldnames = ["snapshot_date", "store_id", "center_name", "region",
                      "haircuts_mtd", "net_sales_mtd", "tickets_mtd", "atv_mtd",
                      "clocked_hours_mtd", "sales_per_hour_mtd",
                      "service_rev_mtd", "product_rev_mtd", "supercut_plus_mtd",
                      "haircuts_rr", "net_sales_rr"]
        with open(snap_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for row in snapshot_rows:
                w.writerow({k: row.get(k) for k in fieldnames})
        print(f"Wrote {len(snapshot_rows)} snapshot rows -> {snap_path}")

    # ---- DHR daily hours (per store per date) ----
    # Use latest DHR (it has the most-complete week); also de-dup by (store, date) keeping latest non-null
    hour_map = {}  # (store_id, date) -> hours from latest source
    dhr_paths = sorted(glob.glob(os.path.join(RAW_DIR, "DHR_*.xlsx")))
    for p in dhr_paths:
        fn = os.path.basename(p)
        for r in parse_dhr(p):
            key = (r["store_id"], r["date"])
            # later files overwrite earlier ones (more-complete data)
            hour_map[key] = r["hours"]

    dhr_path = os.path.join(OUT_DIR, "dhr_hours.csv")
    with open(dhr_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["store_id", "date", "hours"])
        w.writeheader()
        for (sid, d), h in sorted(hour_map.items()):
            w.writerow({"store_id": sid, "date": d, "hours": h})
    print(f"Wrote {len(hour_map)} DHR rows -> {dhr_path}")

    # ---- Derived daily sales (MTD deltas within same month) ----
    # For each store, sort snapshots by date; compute daily delta:
    #   daily_sales(N) = MTD(file N) - MTD(file N-1) if same month else MTD(file N)
    # Daily sales attribution: the DSR file dated N is sent the morning of N and covers
    # data through close-of-business N-1. So daily_sales for date (N-1) = MTD(N) - MTD(N-1).
    by_store = {}
    for r in snapshot_rows:
        by_store.setdefault(r["store_id"], []).append(r)
    daily_rows = []
    for sid, rows in by_store.items():
        rows.sort(key=lambda x: x["snapshot_date"])
        for i, r in enumerate(rows):
            snap_d = date.fromisoformat(r["snapshot_date"])
            attrib_d = snap_d - timedelta(days=1)  # MTD-as-of-N covers through N-1
            prev_mtd_sales = 0.0
            prev_mtd_haircuts = 0.0
            prev_mtd_tickets = 0.0
            prev_mtd_hours = 0.0
            prev_mtd_service = 0.0
            prev_mtd_product = 0.0
            prev_mtd_scp = 0.0
            # Compare attribution months (the MTD inside a DSR is for the month of attrib_d).
            # If attrib_d is day 1, this is the first day of a new month so MTD = daily directly.
            if attrib_d.day == 1:
                pass  # zeros stand
            elif i > 0:
                prev = rows[i-1]
                prev_snap_d = date.fromisoformat(prev["snapshot_date"])
                prev_attrib_d = prev_snap_d - timedelta(days=1)
                if (snap_d - prev_snap_d).days == 1 and prev_attrib_d.month == attrib_d.month:
                    prev_mtd_sales = prev.get("net_sales_mtd") or 0.0
                    prev_mtd_haircuts = prev.get("haircuts_mtd") or 0.0
                    prev_mtd_tickets = prev.get("tickets_mtd") or 0.0
                    prev_mtd_hours = prev.get("clocked_hours_mtd") or 0.0
                    prev_mtd_service = prev.get("service_rev_mtd") or 0.0
                    prev_mtd_product = prev.get("product_rev_mtd") or 0.0
                    prev_mtd_scp = prev.get("supercut_plus_mtd") or 0.0
                else:
                    continue
            else:
                continue
            if r.get("net_sales_mtd") is None:
                continue
            d_sales = round((r["net_sales_mtd"] or 0) - prev_mtd_sales, 2)
            d_tickets = int((r["tickets_mtd"] or 0) - prev_mtd_tickets)
            d_hours = round((r["clocked_hours_mtd"] or 0) - prev_mtd_hours, 2)
            # A cumulative MTD can't go DOWN within a month. A negative delta means the
            # current OR prior DSR export had a corrupted MTD column (e.g. it printed a daily
            # value instead of month-to-date). Skip the day rather than emit garbage.
            if prev_mtd_sales and (d_sales < 0 or d_tickets < 0 or d_hours < 0):
                continue
            daily_rows.append({
                "date": attrib_d.isoformat(),
                "store_id": sid,
                "center_name": r["center_name"],
                "region": r["region"],
                "daily_net_sales": d_sales,
                "daily_haircuts": int((r["haircuts_mtd"] or 0) - prev_mtd_haircuts),
                "daily_tickets": d_tickets,
                "daily_clocked_hours": d_hours,
                "daily_service_rev": round((r["service_rev_mtd"] or 0) - prev_mtd_service, 2),
                "daily_product_rev": round((r["product_rev_mtd"] or 0) - prev_mtd_product, 2),
                "daily_supercut_plus": int((r["supercut_plus_mtd"] or 0) - prev_mtd_scp),
            })

    daily_path = os.path.join(OUT_DIR, "daily.csv")
    fields = ["date", "store_id", "center_name", "region",
              "daily_net_sales", "daily_haircuts", "daily_tickets",
              "daily_clocked_hours", "daily_service_rev", "daily_product_rev",
              "daily_supercut_plus"]
    with open(daily_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        daily_rows.sort(key=lambda x: (x["date"], x["store_id"]))
        for row in daily_rows:
            w.writerow(row)
    print(f"Wrote {len(daily_rows)} daily rows -> {daily_path}")

    # Summary stats
    if daily_rows:
        dates = sorted(set(r["date"] for r in daily_rows))
        print(f"Date range: {dates[0]} to {dates[-1]}")
        print(f"Stores with daily data: {len(set(r['store_id'] for r in daily_rows))}")

if __name__ == "__main__":
    main()

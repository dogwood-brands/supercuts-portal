#!/usr/bin/env python3
"""Generates tiny synthetic DSR/DHR report workbooks for the pipeline test.
Usage: python3 make-report-fixtures.py <output-dir>
Two salons (80123 California-style name, 82298 Nevada-style name), two DSR days and one DHR week,
including the quirks the real exports have: a Google-Sheets FILTER() formula left as text, a blank
"Net Sales MTD" column that must be reconstructed from service + product, and a Total row in BY TL.
All numbers are invented."""
import os
import sys

import openpyxl

DSR_HEADER = ["Center Name", "Haircuts RR", "Net Sales RR", "Haircuts MTD", "Net Sales MTD",
              "Service Tickets MTD", "ATV MTD", "Clocked Hours", "Total Sales Total Hours",
              "Service Revenue MTD", "Product Revenue MTD", "Supercut Plus", "Region"]

# (center name, rr formula text?, rr, rr_sales, haircuts, sales_mtd_or_None, tickets, atv, clocked, sph, service, product, scp, region)
SALON_80123 = "01 TEST SALON 80123"
SALON_82298 = "LV02 - 82298 - Sahara Test"

DSR_DAY1 = [
    [SALON_80123, "FILTER(Productions!E:E", 25000, 100, 15000, 95, 40, 500, 52, 14000, 1000, 60, "Cali"],
    [SALON_82298, 400, 18000, 80, None, 90, 36, 300, 55, 1000, 200, 30, "NV"],  # blank Net Sales MTD
]
DSR_DAY2 = [
    [SALON_80123, 610, 26500, 110, 16500, 105, 41, 530, 53, 15000, 1100, 65, "Cali"],
    [SALON_82298, 410, 18100, 88, None, 96, 37, 316, 57, 2000, 400, 33, "NV"],
]

BY_TL_HEADER = ["", "District", "#", "Entity", "Salon Name", "Salon Mgr", "",
                "Total Net Rev RR", "Total Net Rev Target", "Total Net Rev RR %"]
BY_TL_ROWS = [
    [None, "Heather", 80123, "SC31", "Test Salon", "Mgr T", None, 25000, 27500, 25000 / 27500],
    [None, "Karen", 82298, "LV", "Sahara Test", "Mgr K", None, 18000, 20000, 0.9],
    [None, "Heather Total", None, None, 2, None, None, 43000, 47500, 0.9052631579],  # must be skipped
]

DHR_HEADER = ["Center Name", "Hours 11/19", "Hours 11/20", "Hours 11/21", "Hours 11/22"]
DHR_ROWS = [
    [SALON_80123, 7.5, 8.25, "FILTER(Productions!E:E", None],
    [SALON_82298, 6.0, 6.5, None, None],
]


def write_sheet(path, sheets):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, header, rows in sheets:
        ws = wb.create_sheet(name)
        ws.append(header)
        for r in rows:
            ws.append(r)
    wb.save(path)


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    # The first DSR of a month per store is skipped by the differencing (it has no prior day to
    # subtract), so day 1's numbers only matter as the baseline.
    write_sheet(os.path.join(out_dir, "DSR_2026-11-20.xlsx"),
                [("Input", DSR_HEADER, DSR_DAY1)])
    write_sheet(os.path.join(out_dir, "DSR_2026-11-21.xlsx"),
                [("Input", DSR_HEADER, DSR_DAY2), ("BY TL", BY_TL_HEADER, BY_TL_ROWS)])
    write_sheet(os.path.join(out_dir, "DHR_2026-11-21.xlsx"),
                [("Input", DHR_HEADER, DHR_ROWS)])
    print(f"wrote fixtures to {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")

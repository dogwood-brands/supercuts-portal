-- Per-stylist figures now arrive two ways: the nightly sales load, and a manual upload by the home
-- office when a report is late or the automated import fails (Nov 30 go-live). Only invented sample
-- rows may be cleared by a load, so each row carries where it came from: 'sample' for seed data,
-- 'manual' for uploads. A future Zenoti feed adds its own value. Rows from before this column
-- existed were seed data, so they default to 'sample'.
ALTER TABLE stylist_daily ADD COLUMN source TEXT NOT NULL DEFAULT 'sample';

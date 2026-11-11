-- The DSR reports its own month-end run-rate per salon. The portal shows that figure as "projected"
-- so pace to goal matches the report the field already reads, instead of a second projection method.
ALTER TABLE kpi_goals ADD COLUMN run_rate_c INTEGER;

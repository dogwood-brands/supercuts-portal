-- 003: v1.1 changes from the 2026-11-12 review with Chris Larkins and Emory Smith.
-- See SPEC.md section 11 for the behaviour each column supports.

-- People: shift managers see checklists and store alerts; employee_id lets a roster re-upload update people
-- instead of duplicating them; pay_plan picks the pay-plan page; directory_listed puts a person in the
-- directory's portfolio leadership list.
ALTER TABLE users ADD COLUMN shift_manager INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN employee_id TEXT;
ALTER TABLE users ADD COLUMN pay_plan TEXT;
ALTER TABLE users ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_users_employee_id ON users(employee_id) WHERE employee_id IS NOT NULL;

-- Salons: the salon's own email address for the directory.
ALTER TABLE salons ADD COLUMN email TEXT;

-- Goals: haircut figures from the DSR "BY TL" sheet, and whether a goal was typed in by leadership
-- (manual) or loaded from the DSR. The twice-daily DSR load never overwrites a manual goal.
ALTER TABLE kpi_goals ADD COLUMN haircut_goal INTEGER;
ALTER TABLE kpi_goals ADD COLUMN haircuts_rr INTEGER;
ALTER TABLE kpi_goals ADD COLUMN haircuts_ly INTEGER;
ALTER TABLE kpi_goals ADD COLUMN goal_source TEXT NOT NULL DEFAULT 'dsr';

-- Promos: a short explainer video and its thumbnail.
ALTER TABLE promos ADD COLUMN video_url TEXT;
ALTER TABLE promos ADD COLUMN video_poster_url TEXT;

-- Checklists: who ticked each item and when, as {"itemId": {"by": userId, "at": iso}}.
ALTER TABLE checklist_runs ADD COLUMN done_by_json TEXT NOT NULL DEFAULT '{}';

-- Ask HR: the portal keeps only who wrote in, when, and when they acknowledged the receipt.
-- The message itself waits in hr_outbox only until it is delivered to the HR inbox, then it is deleted.
CREATE TABLE hr_submissions (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  delivered_at TEXT,
  delivery TEXT
);
CREATE INDEX idx_hr_submissions_author ON hr_submissions(author_id);
CREATE INDEX idx_hr_submissions_created ON hr_submissions(created_at DESC);

CREATE TABLE hr_outbox (
  submission_id INTEGER PRIMARY KEY REFERENCES hr_submissions(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);

-- The v1 threaded inquiries held message content and open / resolved status. Both are gone by design.
DELETE FROM hr_messages;
DELETE FROM hr_inquiries;

-- Stylist work photos: up to 10 per person (enforced by the API).
CREATE TABLE work_photos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_work_photos_user ON work_photos(user_id, created_at DESC);
CREATE INDEX idx_work_photos_created ON work_photos(created_at DESC);

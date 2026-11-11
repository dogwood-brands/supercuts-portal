-- 001_init: full schema for SC Portal v1 (see SPEC.md section 4).
-- Timestamps are ISO-8601 UTC text. Money is integer cents.

CREATE TABLE markets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL
);

CREATE TABLE districts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  leader_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL
);

CREATE TABLE salons (
  id INTEGER PRIMARY KEY,
  salon_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  concept TEXT NOT NULL DEFAULT 'SUPERCUTS',
  address TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT, shopping_center TEXT,
  market_id INTEGER REFERENCES markets(id),
  district_id INTEGER REFERENCES districts(id),
  entity_id INTEGER REFERENCES entities(id),
  manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hours_json TEXT,
  photo_url TEXT,
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'active',
  opened_on TEXT
);
CREATE INDEX idx_salons_market ON salons(market_id);
CREATE INDEX idx_salons_district ON salons(district_id);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL CHECK (role IN ('stylist','salon_manager','district_leader','hr','executive','admin')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT,
  salon_id INTEGER REFERENCES salons(id) ON DELETE SET NULL,
  district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL,
  phone TEXT,
  avatar_url TEXT,
  hire_date TEXT,
  birthday_md TEXT,
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_users_salon ON users(salon_id);
CREATE INDEX idx_users_district ON users(district_id);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  salon_id INTEGER REFERENCES salons(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('post','shoutout','announcement','win')),
  body TEXT NOT NULL,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('company','market','district','salon')),
  audience_id INTEGER,
  pinned_until TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_posts_created ON posts(created_at DESC, id DESC);
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_audience ON posts(audience_type, audience_id);

CREATE TABLE shoutout_targets (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user','salon','district')),
  target_id INTEGER NOT NULL,
  value_key TEXT,
  PRIMARY KEY (post_id, target_type, target_id)
);
CREATE INDEX idx_shoutout_target ON shoutout_targets(target_type, target_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_comments_post ON comments(post_id, id);

CREATE TABLE reactions (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like','clap','love','fire')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_reads (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_status ON reports(status);

CREATE TABLE kpi_daily (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  net_sales_c INTEGER NOT NULL DEFAULT 0,
  service_c INTEGER NOT NULL DEFAULT 0,
  product_c INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  haircuts INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 0,
  supercut_plus INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'import',
  PRIMARY KEY (salon_id, date)
);
CREATE INDEX idx_kpi_date ON kpi_daily(date);

CREATE TABLE kpi_goals (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  sales_goal_c INTEGER NOT NULL,
  product_pct_goal REAL,
  srph_goal_c INTEGER,
  PRIMARY KEY (salon_id, period)
);

CREATE TABLE stylist_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  service_c INTEGER NOT NULL DEFAULT 0,
  product_c INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX idx_stylist_daily_date ON stylist_daily(date);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL CHECK (group_key IN ('people','store','initiative')),
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','action')),
  due_on TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_alerts_salon ON alerts(salon_id);

CREATE TABLE checklist_templates (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE checklist_runs (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  done_json TEXT NOT NULL DEFAULT '[]',
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  UNIQUE (template_id, salon_id, date)
);
CREATE INDEX idx_runs_salon_date ON checklist_runs(salon_id, date);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('it','facilities','supplies','marketing')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_salon ON tickets(salon_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_author ON tickets(author_id);

CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status_to TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id);

CREATE TABLE hr_inquiries (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('pay','schedule','benefits','leave','concern','other')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_hr_author ON hr_inquiries(author_id);
CREATE INDEX idx_hr_status ON hr_inquiries(status);

CREATE TABLE hr_messages (
  id INTEGER PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES hr_inquiries(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_hr_messages_inquiry ON hr_messages(inquiry_id);

CREATE TABLE promos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  image_url TEXT,
  starts_on TEXT,
  ends_on TEXT,
  tag TEXT,
  audience TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'published',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('brand','products','policies','ops','hr')),
  category TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT,
  file_url TEXT,
  image_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  requires_ack INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_resources_section ON resources(section, sort);

CREATE TABLE acknowledgements (
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (resource_id, user_id)
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  poster_url TEXT,
  duration_s INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  kind TEXT NOT NULL DEFAULT 'general',
  audience_type TEXT NOT NULL DEFAULT 'company',
  audience_id INTEGER
);
CREATE INDEX idx_events_start ON events(starts_on);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, id DESC);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  meta_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(id DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

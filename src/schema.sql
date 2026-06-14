PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_on TEXT NOT NULL,
  left_on TEXT,
  UNIQUE(group_id, user_id, joined_on)
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
  default_usd_rate REAL NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_expense_count INTEGER NOT NULL DEFAULT 0,
  imported_settlement_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  policy TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'open',
  raw_row_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  source_row_number INTEGER,
  source_fingerprint TEXT,
  expense_date TEXT NOT NULL,
  description TEXT NOT NULL,
  paid_by_user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate_to_inr REAL NOT NULL,
  amount_inr_cents INTEGER NOT NULL,
  split_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  raw_row_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_source_fingerprint
ON expenses(group_id, source_fingerprint)
WHERE source_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS expense_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL,
  basis TEXT NOT NULL,
  UNIQUE(expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  source_row_number INTEGER,
  settlement_date TEXT NOT NULL,
  payer_user_id INTEGER NOT NULL REFERENCES users(id),
  payee_user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate_to_inr REAL NOT NULL,
  amount_inr_cents INTEGER NOT NULL,
  note TEXT,
  raw_row_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bills ADD COLUMN idempotency_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX bills_idempotency_unique ON bills(idempotency_key);
--> statement-breakpoint
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','cashier')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX profiles_email_unique ON profiles(email);
--> statement-breakpoint
CREATE TABLE user_outlets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, outlet_id)
);
--> statement-breakpoint
CREATE INDEX user_outlets_user_idx ON user_outlets(user_id);
--> statement-breakpoint
CREATE INDEX user_outlets_outlet_idx ON user_outlets(outlet_id);
--> statement-breakpoint
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  outlet_id TEXT REFERENCES outlets(id),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
--> statement-breakpoint
CREATE INDEX audit_logs_user_idx ON audit_logs(user_id);
--> statement-breakpoint
CREATE INDEX audit_logs_outlet_idx ON audit_logs(outlet_id);
--> statement-breakpoint
CREATE INDEX audit_logs_action_idx ON audit_logs(action);

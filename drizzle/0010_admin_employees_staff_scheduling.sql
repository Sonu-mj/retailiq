ALTER TABLE profiles ADD COLUMN phone TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN employee_id TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN last_login_at INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX profiles_employee_id_unique ON profiles(employee_id) WHERE employee_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE staff_plans ADD COLUMN scheduled_staff INTEGER;

CREATE TABLE `demand_forecasts` (
  `id` text PRIMARY KEY NOT NULL,
  `outlet_id` text NOT NULL,
  `forecast_timestamp` integer NOT NULL,
  `predicted_orders` real NOT NULL,
  `lower_bound` real,
  `upper_bound` real,
  `model_version` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (`predicted_orders` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demand_forecasts_outlet_time_version_unique` ON `demand_forecasts` (`outlet_id`,`forecast_timestamp`,`model_version`);
--> statement-breakpoint
CREATE INDEX `demand_forecasts_time_idx` ON `demand_forecasts` (`forecast_timestamp`);
--> statement-breakpoint
CREATE INDEX `demand_forecasts_outlet_idx` ON `demand_forecasts` (`outlet_id`);
--> statement-breakpoint
CREATE TABLE `forecast_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `trained_at` integer NOT NULL,
  `generated_at` integer,
  `status` text NOT NULL,
  `training_records` integer DEFAULT 0 NOT NULL,
  `outlet_count` integer DEFAULT 0 NOT NULL,
  `horizon_hours` integer DEFAULT 168 NOT NULL,
  `mae` real,
  `rmse` real,
  `mape` real,
  `model_version` text NOT NULL,
  `notes` text,
  CHECK (`status` IN ('completed','insufficient_data','failed'))
);
--> statement-breakpoint
CREATE INDEX `forecast_runs_trained_idx` ON `forecast_runs` (`trained_at`);
--> statement-breakpoint
CREATE TABLE `workforce_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `outlet_id` text,
  `orders_per_staff_hour` real DEFAULT 10 NOT NULL,
  `staffing_buffer_percent` real DEFAULT 10 NOT NULL,
  `minimum_staff` integer DEFAULT 1 NOT NULL,
  `maximum_staff` integer DEFAULT 8 NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (`orders_per_staff_hour` > 0),
  CHECK (`staffing_buffer_percent` >= 0 AND `staffing_buffer_percent` <= 100),
  CHECK (`minimum_staff` >= 0),
  CHECK (`maximum_staff` >= `minimum_staff`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workforce_settings_outlet_unique` ON `workforce_settings` (`outlet_id`);
--> statement-breakpoint
CREATE TABLE `staff_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `outlet_id` text NOT NULL,
  `forecast_timestamp` integer NOT NULL,
  `forecast_orders` real NOT NULL,
  `base_staff` integer NOT NULL,
  `recommended_staff` integer NOT NULL,
  `model_version` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (`forecast_orders` >= 0),
  CHECK (`base_staff` >= 0),
  CHECK (`recommended_staff` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_plans_outlet_time_version_unique` ON `staff_plans` (`outlet_id`,`forecast_timestamp`,`model_version`);
--> statement-breakpoint
CREATE INDEX `staff_plans_time_idx` ON `staff_plans` (`forecast_timestamp`);

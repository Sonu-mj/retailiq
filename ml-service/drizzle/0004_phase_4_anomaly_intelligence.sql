CREATE TABLE `anomaly_events` (
  `id` text PRIMARY KEY NOT NULL,
  `outlet_id` text NOT NULL,
  `event_timestamp` integer NOT NULL,
  `anomaly_type` text NOT NULL,
  `severity` text NOT NULL,
  `anomaly_score` real NOT NULL,
  `raw_model_score` real NOT NULL,
  `feature_snapshot` text NOT NULL,
  `summary` text NOT NULL,
  `recommendation` text NOT NULL,
  `related_bill_ids` text DEFAULT '[]' NOT NULL,
  `investigation_status` text DEFAULT 'new' NOT NULL,
  `model_version` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (`anomaly_type` IN ('high_returns','high_wastage','revenue_drop','revenue_spike','discount_spike','margin_drop','order_volume_anomaly','average_order_value_anomaly','profitability_anomaly','multi_factor_anomaly')),
  CHECK (`severity` IN ('watch','elevated','high_attention')),
  CHECK (`anomaly_score` >= 0 AND `anomaly_score` <= 100),
  CHECK (`investigation_status` IN ('new','reviewing','resolved','dismissed'))
);
--> statement-breakpoint
CREATE INDEX `anomaly_events_outlet_timestamp_idx` ON `anomaly_events` (`outlet_id`,`event_timestamp`);
--> statement-breakpoint
CREATE INDEX `anomaly_events_severity_idx` ON `anomaly_events` (`severity`);
--> statement-breakpoint
CREATE INDEX `anomaly_events_status_idx` ON `anomaly_events` (`investigation_status`);
--> statement-breakpoint
CREATE TABLE `intelligence_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `status` text NOT NULL,
  `observation_count` integer DEFAULT 0 NOT NULL,
  `outlet_count` integer DEFAULT 0 NOT NULL,
  `signal_count` integer DEFAULT 0 NOT NULL,
  `high_attention_count` integer DEFAULT 0 NOT NULL,
  `model_version` text NOT NULL,
  `notes` text,
  CHECK (`status` IN ('completed','insufficient_data','failed'))
);
--> statement-breakpoint
CREATE INDEX `intelligence_runs_started_idx` ON `intelligence_runs` (`started_at`);

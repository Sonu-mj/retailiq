CREATE TABLE `business_insights` (
  `id` text PRIMARY KEY NOT NULL,
  `outlet_id` text,
  `generated_at` integer NOT NULL,
  `insight_type` text NOT NULL,
  `severity` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `related_entity_type` text NOT NULL,
  `related_entity_id` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `status` text DEFAULT 'new' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_insights_dedupe_unique` ON `business_insights` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `business_insights_outlet_idx` ON `business_insights` (`outlet_id`);
--> statement-breakpoint
CREATE INDEX `business_insights_status_idx` ON `business_insights` (`status`);
--> statement-breakpoint
CREATE INDEX `business_insights_generated_idx` ON `business_insights` (`generated_at`);

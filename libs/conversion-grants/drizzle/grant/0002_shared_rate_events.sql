CREATE TABLE `rate_events` (
	`bucket` text NOT NULL,
	`event_id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_events_bucket` ON `rate_events` (`bucket`,`created_at_ms`);--> statement-breakpoint
-- Keeps recent start attempts counting toward the limit. The bucket and 60-second window match START_RATE_BUCKET and START_RATE_WINDOW_MS in conversion-grant-durable-object.ts.
INSERT INTO `rate_events` (`bucket`, `event_id`, `created_at_ms`, `expires_at_ms`)
SELECT 'grant-conversion-start', 'start-attempt-' || `id`, `attempted_at_ms`, `attempted_at_ms` + 60000
FROM `start_attempts`;--> statement-breakpoint
DROP TABLE `start_attempts`;

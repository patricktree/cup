CREATE TABLE `account_playback_positions` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`synchronization_unit_id` text NOT NULL,
	`offset_milliseconds` integer NOT NULL,
	FOREIGN KEY (`conversion_id`) REFERENCES `account_conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "playback_offset" CHECK("account_playback_positions"."offset_milliseconds" >= 0)
);

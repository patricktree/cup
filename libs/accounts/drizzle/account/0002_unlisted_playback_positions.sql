PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_playback_positions` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`synchronization_unit_id` text NOT NULL,
	`offset_milliseconds` integer NOT NULL,
	CONSTRAINT "playback_offset" CHECK("__new_account_playback_positions"."offset_milliseconds" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_account_playback_positions`("conversion_id", "synchronization_unit_id", "offset_milliseconds") SELECT "conversion_id", "synchronization_unit_id", "offset_milliseconds" FROM `account_playback_positions`;--> statement-breakpoint
DROP TABLE `account_playback_positions`;--> statement-breakpoint
ALTER TABLE `__new_account_playback_positions` RENAME TO `account_playback_positions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
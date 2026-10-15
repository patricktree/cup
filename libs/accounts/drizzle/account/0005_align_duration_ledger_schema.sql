-- Aligns account storage with conversion grants: typed conversion outcomes replace the outcome
-- JSON and request fingerprint, and audio segments use the shared duration ledger table.
-- Foreign keys stay enforced inside the migration transaction, so the conversion table and both
-- tables referencing it are rebuilt together and renamed into place once the old ones are dropped.
CREATE TABLE `__new_account_conversions` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`status` text NOT NULL,
	`completed_at_ms` integer,
	`title` text,
	`audiobook_reference_json` text,
	`has_cover_image` integer,
	`failure_category` text,
	`explanation` text,
	CONSTRAINT "account_conversion_status" CHECK("__new_account_conversions"."status" IN ('pending', 'ready', 'failed')),
	CONSTRAINT "account_conversion_reference_json" CHECK("__new_account_conversions"."audiobook_reference_json" IS NULL OR json_valid("__new_account_conversions"."audiobook_reference_json")),
	CONSTRAINT "account_conversion_outcome" CHECK(("__new_account_conversions"."status" = 'pending' AND "__new_account_conversions"."completed_at_ms" IS NULL AND "__new_account_conversions"."title" IS NULL AND "__new_account_conversions"."audiobook_reference_json" IS NULL AND "__new_account_conversions"."has_cover_image" IS NULL AND "__new_account_conversions"."failure_category" IS NULL AND "__new_account_conversions"."explanation" IS NULL)
        OR ("__new_account_conversions"."status" = 'ready' AND "__new_account_conversions"."completed_at_ms" IS NOT NULL AND "__new_account_conversions"."title" IS NOT NULL AND "__new_account_conversions"."audiobook_reference_json" IS NOT NULL AND "__new_account_conversions"."failure_category" IS NULL AND "__new_account_conversions"."explanation" IS NULL)
        OR ("__new_account_conversions"."status" = 'failed' AND "__new_account_conversions"."completed_at_ms" IS NOT NULL AND "__new_account_conversions"."title" IS NULL AND "__new_account_conversions"."audiobook_reference_json" IS NULL AND "__new_account_conversions"."has_cover_image" IS NULL AND "__new_account_conversions"."failure_category" IS NOT NULL AND "__new_account_conversions"."explanation" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_account_conversions` (
	`conversion_id`, `idempotency_key`, `source_url`, `created_at_ms`, `status`, `completed_at_ms`,
	`title`, `audiobook_reference_json`, `has_cover_image`, `failure_category`, `explanation`
) SELECT
	`conversion_id`, `idempotency_key`, `source_url`, `created_at_ms`, `status`, `completed_at_ms`,
	CASE WHEN `status` = 'ready' THEN json_extract(`outcome_json`, '$.title') END,
	CASE WHEN `status` = 'ready' THEN json_extract(`outcome_json`, '$.audiobookReference') END,
	CASE WHEN `status` = 'ready' AND json_extract(`outcome_json`, '$.hasCoverImage') = 1 THEN 1 END,
	CASE WHEN `status` = 'failed' THEN json_extract(`outcome_json`, '$.failureCategory') END,
	CASE WHEN `status` = 'failed' THEN json_extract(`outcome_json`, '$.explanation') END
FROM `account_conversions`;
--> statement-breakpoint
CREATE TABLE `__new_pending_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`conversion_id` text NOT NULL,
	`execution_epoch` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`conversion_id`) REFERENCES `__new_account_conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_job_epoch" CHECK("__new_pending_jobs"."execution_epoch" > 0),
	CONSTRAINT "pending_job_state" CHECK("__new_pending_jobs"."state" IN ('pending', 'delivered'))
);
--> statement-breakpoint
INSERT INTO `__new_pending_jobs` (`job_id`, `conversion_id`, `execution_epoch`, `state`)
SELECT `job_id`, `conversion_id`, `execution_epoch`, `state` FROM `pending_jobs`;
--> statement-breakpoint
CREATE TABLE `__new_audio_segments` (
	`conversion_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`narration_text_characters` integer NOT NULL,
	`estimated_milliseconds` integer NOT NULL,
	`state` text NOT NULL,
	`actual_milliseconds` integer NOT NULL,
	`charged_milliseconds` integer NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`conversion_id`, `sequence`),
	FOREIGN KEY (`conversion_id`) REFERENCES `__new_account_conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `credit_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audio_segment_sequence" CHECK("__new_audio_segments"."sequence" >= 0),
	CONSTRAINT "audio_segment_characters" CHECK("__new_audio_segments"."narration_text_characters" > 0),
	CONSTRAINT "audio_segment_estimate" CHECK("__new_audio_segments"."estimated_milliseconds" > 0),
	CONSTRAINT "audio_segment_duration" CHECK("__new_audio_segments"."charged_milliseconds" >= 0 AND "__new_audio_segments"."charged_milliseconds" <= "__new_audio_segments"."actual_milliseconds"),
	CONSTRAINT "audio_segment_state" CHECK(("__new_audio_segments"."state" = 'settled' AND "__new_audio_segments"."actual_milliseconds" > 0) OR ("__new_audio_segments"."state" IN ('reserved', 'released') AND "__new_audio_segments"."actual_milliseconds" = 0 AND "__new_audio_segments"."charged_milliseconds" = 0))
);
--> statement-breakpoint
INSERT INTO `__new_audio_segments` (
	`conversion_id`, `sequence`, `narration_text_characters`, `estimated_milliseconds`, `state`,
	`actual_milliseconds`, `charged_milliseconds`, `operation_id`
) SELECT
	`conversion_id`, `sequence`, `narration_characters`, `estimated_ms`, `state`,
	`actual_ms`, `charged_ms`, `operation_id`
FROM `account_audio_segments`;
--> statement-breakpoint
DROP TABLE `account_audio_segments`;
--> statement-breakpoint
DROP TABLE `pending_jobs`;
--> statement-breakpoint
DROP TABLE `account_conversions`;
--> statement-breakpoint
ALTER TABLE `__new_account_conversions` RENAME TO `account_conversions`;
--> statement-breakpoint
ALTER TABLE `__new_pending_jobs` RENAME TO `pending_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_audio_segments` RENAME TO `audio_segments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_idempotency_key_unique` ON `account_conversions` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_jobs_conversion_id_unique` ON `pending_jobs` (`conversion_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_segments_operation_id_unique` ON `audio_segments` (`operation_id`);

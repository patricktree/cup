-- Moves the grant's duration allowance onto the shared duration ledger. The configured allowance
-- becomes one grant event, and each audio segment becomes a reservation whose ledger events
-- reproduce its recorded state, so allowance, reserved, and spent duration stay unchanged.
CREATE TABLE `credit_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`unit` text NOT NULL,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`cause` text NOT NULL,
	CONSTRAINT "credit_operation_kind" CHECK("credit_operations"."kind" IN ('grant', 'reservation', 'adjustment')),
	CONSTRAINT "credit_operation_unit" CHECK("credit_operations"."unit" = 'audio-millisecond'),
	CONSTRAINT "credit_operation_amount" CHECK("credit_operations"."amount" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "credit_operation_state" CHECK("credit_operations"."state" IN ('completed', 'reserved', 'consumed', 'released')),
	CONSTRAINT "credit_operation_transition" CHECK(("credit_operations"."kind" IN ('grant', 'adjustment') AND "credit_operations"."state" = 'completed') OR ("credit_operations"."kind" = 'reservation' AND "credit_operations"."state" IN ('reserved', 'consumed', 'released')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_operations_request_id_unique` ON `credit_operations` (`request_id`);
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`event_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`unit` text NOT NULL,
	`amount` integer NOT NULL,
	`available_delta` integer NOT NULL,
	`reserved_delta` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`cause` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `credit_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credit_ledger_kind" CHECK("credit_ledger"."event_kind" IN ('grant', 'reserve', 'consume', 'release', 'adjustment')),
	CONSTRAINT "credit_ledger_unit" CHECK("credit_ledger"."unit" = 'audio-millisecond'),
	CONSTRAINT "credit_ledger_amount" CHECK("credit_ledger"."amount" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "credit_ledger_deltas" CHECK(("credit_ledger"."event_kind" = 'grant' AND "credit_ledger"."available_delta" = "credit_ledger"."amount" AND "credit_ledger"."reserved_delta" = 0) OR
    ("credit_ledger"."event_kind" = 'reserve' AND "credit_ledger"."available_delta" = -"credit_ledger"."amount" AND "credit_ledger"."reserved_delta" = "credit_ledger"."amount") OR
    ("credit_ledger"."event_kind" = 'consume' AND "credit_ledger"."available_delta" + "credit_ledger"."reserved_delta" = -"credit_ledger"."amount" AND "credit_ledger"."reserved_delta" < 0) OR
    ("credit_ledger"."event_kind" = 'release' AND "credit_ledger"."available_delta" = "credit_ledger"."amount" AND "credit_ledger"."reserved_delta" = -"credit_ledger"."amount") OR
    ("credit_ledger"."event_kind" = 'adjustment' AND ABS("credit_ledger"."available_delta") = "credit_ledger"."amount" AND "credit_ledger"."reserved_delta" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_terminal_settlement` ON `credit_ledger` (`operation_id`) WHERE "credit_ledger"."event_kind" IN ('consume', 'release');
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_operation_id_event_kind_unique` ON `credit_ledger` (`operation_id`,`event_kind`);
--> statement-breakpoint
CREATE TABLE `credit_balances` (
	`unit` text PRIMARY KEY NOT NULL,
	`available` integer NOT NULL,
	`reserved` integer NOT NULL,
	CONSTRAINT "credit_balance_unit" CHECK("credit_balances"."unit" = 'audio-millisecond'),
	CONSTRAINT "credit_balance_available" CHECK("credit_balances"."available" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "credit_balance_reserved" CHECK("credit_balances"."reserved" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "credit_balance_total" CHECK("credit_balances"."available" + "credit_balances"."reserved" >= 0)
);
--> statement-breakpoint
INSERT INTO `credit_operations` (`operation_id`, `request_id`, `kind`, `unit`, `amount`, `state`, `cause`)
SELECT 'allowance:' || `grant_id`, 'allowance:' || `grant_id`, 'grant', 'audio-millisecond', `allowance_milliseconds`, 'completed', 'migrated-allowance'
FROM `grant`;
--> statement-breakpoint
INSERT INTO `credit_ledger` (`event_id`, `operation_id`, `event_kind`, `unit`, `amount`, `available_delta`, `reserved_delta`, `created_at_ms`, `cause`)
SELECT 'allowance:' || `grant_id` || ':grant', 'allowance:' || `grant_id`, 'grant', 'audio-millisecond', `allowance_milliseconds`, `allowance_milliseconds`, 0, `created_at_ms`, 'migrated-allowance'
FROM `grant`;
--> statement-breakpoint
INSERT INTO `credit_operations` (`operation_id`, `request_id`, `kind`, `unit`, `amount`, `state`, `cause`)
SELECT
	'segment:' || `conversion_id` || ':' || `sequence` || ':migrated',
	'segment:' || `conversion_id` || ':' || `sequence` || ':migrated',
	'reservation',
	'audio-millisecond',
	`estimated_milliseconds`,
	CASE `state` WHEN 'settled' THEN 'consumed' ELSE `state` END,
	`conversion_id`
FROM `segment_usage`;
--> statement-breakpoint
INSERT INTO `credit_ledger` (`event_id`, `operation_id`, `event_kind`, `unit`, `amount`, `available_delta`, `reserved_delta`, `created_at_ms`, `cause`)
SELECT
	'segment:' || `segment_usage`.`conversion_id` || ':' || `sequence` || ':migrated:reserve',
	'segment:' || `segment_usage`.`conversion_id` || ':' || `sequence` || ':migrated',
	'reserve',
	'audio-millisecond',
	`estimated_milliseconds`,
	-`estimated_milliseconds`,
	`estimated_milliseconds`,
	`conversions`.`accepted_at_ms`,
	`segment_usage`.`conversion_id`
FROM `segment_usage` INNER JOIN `conversions` ON `conversions`.`conversion_id` = `segment_usage`.`conversion_id`;
--> statement-breakpoint
INSERT INTO `credit_ledger` (`event_id`, `operation_id`, `event_kind`, `unit`, `amount`, `available_delta`, `reserved_delta`, `created_at_ms`, `cause`)
SELECT
	'segment:' || `segment_usage`.`conversion_id` || ':' || `sequence` || ':migrated:' || CASE `state` WHEN 'settled' THEN 'consume' ELSE 'release' END,
	'segment:' || `segment_usage`.`conversion_id` || ':' || `sequence` || ':migrated',
	CASE `state` WHEN 'settled' THEN 'consume' ELSE 'release' END,
	'audio-millisecond',
	CASE `state` WHEN 'settled' THEN `charged_milliseconds` ELSE `estimated_milliseconds` END,
	CASE `state` WHEN 'settled' THEN `estimated_milliseconds` - `charged_milliseconds` ELSE `estimated_milliseconds` END,
	-`estimated_milliseconds`,
	COALESCE(`conversions`.`completed_at_ms`, `conversions`.`accepted_at_ms`),
	`segment_usage`.`conversion_id`
FROM `segment_usage` INNER JOIN `conversions` ON `conversions`.`conversion_id` = `segment_usage`.`conversion_id`
WHERE `state` IN ('settled', 'released');
--> statement-breakpoint
-- A grant object migrates before initialization too; its ledger then starts empty.
INSERT INTO `credit_balances` (`unit`, `available`, `reserved`)
SELECT 'audio-millisecond', SUM(`available_delta`), SUM(`reserved_delta`)
FROM `credit_ledger`
HAVING COUNT(*) > 0;
--> statement-breakpoint
CREATE TABLE `audio_segments` (
	`conversion_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`narration_text_characters` integer NOT NULL,
	`estimated_milliseconds` integer NOT NULL,
	`state` text NOT NULL,
	`actual_milliseconds` integer NOT NULL,
	`charged_milliseconds` integer NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`conversion_id`, `sequence`),
	FOREIGN KEY (`conversion_id`) REFERENCES `conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `credit_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audio_segment_sequence" CHECK("audio_segments"."sequence" >= 0),
	CONSTRAINT "audio_segment_characters" CHECK("audio_segments"."narration_text_characters" > 0),
	CONSTRAINT "audio_segment_estimate" CHECK("audio_segments"."estimated_milliseconds" > 0),
	CONSTRAINT "audio_segment_duration" CHECK("audio_segments"."charged_milliseconds" >= 0 AND "audio_segments"."charged_milliseconds" <= "audio_segments"."actual_milliseconds"),
	CONSTRAINT "audio_segment_state" CHECK(("audio_segments"."state" = 'settled' AND "audio_segments"."actual_milliseconds" > 0) OR ("audio_segments"."state" IN ('reserved', 'released') AND "audio_segments"."actual_milliseconds" = 0 AND "audio_segments"."charged_milliseconds" = 0))
);
--> statement-breakpoint
INSERT INTO `audio_segments` (
	`conversion_id`, `sequence`, `narration_text_characters`, `estimated_milliseconds`, `state`,
	`actual_milliseconds`, `charged_milliseconds`, `operation_id`
) SELECT
	`conversion_id`, `sequence`, `narration_text_characters`, `estimated_milliseconds`, `state`,
	`actual_milliseconds`, `charged_milliseconds`,
	'segment:' || `conversion_id` || ':' || `sequence` || ':migrated'
FROM `segment_usage`;
--> statement-breakpoint
DROP TABLE `segment_usage`;
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_segments_operation_id_unique` ON `audio_segments` (`operation_id`);
--> statement-breakpoint
CREATE TABLE `__new_grant` (
	`id` integer PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer,
	`credential_verifier` text,
	`credential_issued_at_ms` integer,
	`session_signing_key` text NOT NULL,
	`signing_key_generation` integer NOT NULL,
	`projection_revision` integer NOT NULL,
	`registry_confirmed_revision` integer NOT NULL,
	CONSTRAINT "grant_singleton" CHECK("__new_grant"."id" = 1),
	CONSTRAINT "grant_expiry" CHECK("__new_grant"."expires_at_ms" > "__new_grant"."created_at_ms"),
	CONSTRAINT "grant_signing_key_generation" CHECK("__new_grant"."signing_key_generation" > 0),
	CONSTRAINT "grant_registry_snapshot_revision" CHECK("__new_grant"."projection_revision" > 0),
	CONSTRAINT "grant_registry_confirmed_snapshot_revision" CHECK("__new_grant"."registry_confirmed_revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_grant` (
	`id`, `grant_id`, `created_at_ms`, `expires_at_ms`, `revoked_at_ms`, `credential_verifier`,
	`credential_issued_at_ms`, `session_signing_key`, `signing_key_generation`,
	`projection_revision`, `registry_confirmed_revision`
) SELECT
	`id`, `grant_id`, `created_at_ms`, `expires_at_ms`, `revoked_at_ms`, `credential_verifier`,
	`credential_issued_at_ms`, `session_signing_key`, `signing_key_generation`,
	`projection_revision`, `registry_confirmed_revision`
FROM `grant`;
--> statement-breakpoint
DROP TABLE `grant`;
--> statement-breakpoint
ALTER TABLE `__new_grant` RENAME TO `grant`;
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_grant_id_unique` ON `grant` (`grant_id`);
--> statement-breakpoint
ALTER TABLE `conversions` RENAME COLUMN `accepted_at_ms` TO `created_at_ms`;

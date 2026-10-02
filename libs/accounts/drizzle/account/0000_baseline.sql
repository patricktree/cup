CREATE TABLE `account_audio_segments` (
	`conversion_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`narration_characters` integer NOT NULL,
	`estimated_ms` integer NOT NULL,
	`state` text NOT NULL,
	`actual_ms` integer DEFAULT 0 NOT NULL,
	`charged_ms` integer DEFAULT 0 NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`conversion_id`, `sequence`),
	FOREIGN KEY (`conversion_id`) REFERENCES `account_conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `credit_operations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_segment_state" CHECK("account_audio_segments"."state" IN ('reserved', 'settled', 'released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_audio_segments_operation_id_unique` ON `account_audio_segments` (`operation_id`);--> statement-breakpoint
CREATE TABLE `account_conversions` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_url` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`status` text NOT NULL,
	`outcome_json` text,
	`completed_at_ms` integer,
	CONSTRAINT "account_conversion_status" CHECK("account_conversions"."status" IN ('pending', 'ready', 'failed')),
	CONSTRAINT "account_conversion_outcome" CHECK(("account_conversions"."status" = 'pending' AND "account_conversions"."outcome_json" IS NULL) OR ("account_conversions"."status" IN ('ready', 'failed') AND "account_conversions"."outcome_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_conversions_idempotency_key_unique` ON `account_conversions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `account_tombstone` (
	`id` integer PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	CONSTRAINT "account_tombstone_singleton" CHECK("account_tombstone"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`subject` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`state` text NOT NULL,
	`execution_epoch` integer NOT NULL,
	`recovery_deadline_ms` integer,
	CONSTRAINT "account_singleton" CHECK("account"."id" = 1),
	CONSTRAINT "account_state" CHECK("account"."state" IN ('active', 'deletion_scheduled', 'deleting')),
	CONSTRAINT "account_epoch" CHECK("account"."execution_epoch" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_account_id_unique` ON `account` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_subject_unique` ON `account` (`subject`);--> statement-breakpoint
CREATE TABLE `artifact_writers` (
	`writer_id` text PRIMARY KEY NOT NULL,
	`execution_epoch` integer NOT NULL,
	`prefix` text NOT NULL,
	`state` text NOT NULL,
	`unresolved_effect` text,
	`purpose` text NOT NULL,
	CONSTRAINT "artifact_writer_state" CHECK("artifact_writers"."state" IN ('running', 'drained', 'uncertain'))
);
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
CREATE UNIQUE INDEX `credit_terminal_settlement` ON `credit_ledger` (`operation_id`) WHERE "credit_ledger"."event_kind" IN ('consume', 'release');--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_operation_id_event_kind_unique` ON `credit_ledger` (`operation_id`,`event_kind`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `credit_operations_request_id_unique` ON `credit_operations` (`request_id`);--> statement-breakpoint
CREATE TABLE `deletion_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_challenges` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`execution_epoch` integer NOT NULL,
	`state` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`conversion_id` text NOT NULL,
	`execution_epoch` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`conversion_id`) REFERENCES `account_conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_job_epoch" CHECK("pending_jobs"."execution_epoch" > 0),
	CONSTRAINT "pending_job_state" CHECK("pending_jobs"."state" IN ('pending', 'delivered'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_jobs_conversion_id_unique` ON `pending_jobs` (`conversion_id`);--> statement-breakpoint
CREATE TABLE `rate_events` (
	`bucket` text NOT NULL,
	`event_id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_events_bucket` ON `rate_events` (`bucket`,`created_at_ms`);
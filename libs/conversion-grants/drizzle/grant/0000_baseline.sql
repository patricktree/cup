CREATE TABLE `conversions` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_url` text NOT NULL,
	`accepted_at_ms` integer NOT NULL,
	`workflow_started_at_ms` integer,
	`status` text NOT NULL,
	`last_started_phase` text,
	`completed_at_ms` integer,
	`title` text,
	`audiobook_reference_json` text,
	`measurements_json` text,
	`provider_usage_json` text,
	`failure_category` text,
	`explanation` text,
	`diagnostic_reference` text,
	`cleanup_state` text,
	CONSTRAINT "conversion_status" CHECK("conversions"."status" IN ('pending', 'ready', 'failed')),
	CONSTRAINT "conversion_phase" CHECK("conversions"."last_started_phase" IN ('conversion-start', 'source-material-preparation', 'narration-content-selection', 'narration-document-creation', 'audio-segment-production', 'audiobook-assembly', 'audiobook-storage', 'finalization')),
	CONSTRAINT "conversion_failure_category" CHECK("conversions"."failure_category" IS NULL OR "conversions"."failure_category" IN ('workflow-start', 'source-preparation', 'content-selection', 'content-limit', 'narration-synthesis', 'audiobook-assembly', 'workflow-platform', 'internal')),
	CONSTRAINT "conversion_cleanup_state" CHECK("conversions"."cleanup_state" IS NULL OR "conversions"."cleanup_state" IN ('pending', 'complete', 'cleanup_failed')),
	CONSTRAINT "conversion_reference_json" CHECK("conversions"."audiobook_reference_json" IS NULL OR json_valid("conversions"."audiobook_reference_json")),
	CONSTRAINT "conversion_measurements_json" CHECK("conversions"."measurements_json" IS NULL OR json_valid("conversions"."measurements_json")),
	CONSTRAINT "conversion_usage_json" CHECK("conversions"."provider_usage_json" IS NULL OR json_valid("conversions"."provider_usage_json")),
	CONSTRAINT "conversion_terminal_outcome" CHECK((
        "conversions"."last_started_phase" IS NOT NULL AND (
          ("conversions"."status" = 'pending' AND "conversions"."completed_at_ms" IS NULL AND "conversions"."audiobook_reference_json" IS NULL AND "conversions"."failure_category" IS NULL AND "conversions"."explanation" IS NULL)
          OR ("conversions"."status" = 'ready' AND "conversions"."completed_at_ms" IS NOT NULL AND "conversions"."title" IS NOT NULL AND "conversions"."audiobook_reference_json" IS NOT NULL AND "conversions"."failure_category" IS NULL AND "conversions"."explanation" IS NULL)
          OR ("conversions"."status" = 'failed' AND "conversions"."completed_at_ms" IS NOT NULL AND "conversions"."audiobook_reference_json" IS NULL AND "conversions"."failure_category" IS NOT NULL AND "conversions"."explanation" IS NOT NULL)
        )
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversions_idempotency_key_unique` ON `conversions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `grant` (
	`id` integer PRIMARY KEY NOT NULL,
	`allowance_milliseconds` integer DEFAULT 7200000 NOT NULL,
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
	CONSTRAINT "grant_allowance" CHECK("grant"."allowance_milliseconds" > 0),
	CONSTRAINT "grant_singleton" CHECK("grant"."id" = 1),
	CONSTRAINT "grant_expiry" CHECK("grant"."expires_at_ms" > "grant"."created_at_ms"),
	CONSTRAINT "grant_signing_key_generation" CHECK("grant"."signing_key_generation" > 0),
	CONSTRAINT "grant_registry_snapshot_revision" CHECK("grant"."projection_revision" > 0),
	CONSTRAINT "grant_registry_confirmed_snapshot_revision" CHECK("grant"."registry_confirmed_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_grant_id_unique` ON `grant` (`grant_id`);--> statement-breakpoint
CREATE TABLE `segment_usage` (
	`conversion_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`narration_text_characters` integer NOT NULL,
	`estimated_milliseconds` integer NOT NULL,
	`state` text NOT NULL,
	`actual_milliseconds` integer NOT NULL,
	`charged_milliseconds` integer NOT NULL,
	PRIMARY KEY(`conversion_id`, `sequence`),
	FOREIGN KEY (`conversion_id`) REFERENCES `conversions`(`conversion_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "segment_usage_sequence" CHECK("segment_usage"."sequence" >= 0),
	CONSTRAINT "segment_usage_characters" CHECK("segment_usage"."narration_text_characters" > 0),
	CONSTRAINT "segment_usage_estimate" CHECK("segment_usage"."estimated_milliseconds" > 0),
	CONSTRAINT "segment_usage_duration" CHECK("segment_usage"."charged_milliseconds" >= 0 AND "segment_usage"."charged_milliseconds" <= "segment_usage"."actual_milliseconds"),
	CONSTRAINT "segment_usage_state" CHECK(("segment_usage"."state" = 'settled' AND "segment_usage"."actual_milliseconds" > 0) OR ("segment_usage"."state" IN ('reserved', 'released') AND "segment_usage"."actual_milliseconds" = 0 AND "segment_usage"."charged_milliseconds" = 0))
);
--> statement-breakpoint
CREATE TABLE `start_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempted_at_ms` integer NOT NULL
);

CREATE TABLE `canceled_deletion_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_jobs` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_notifications` (
	`notification_key` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_receipts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`completed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identity_accounts` (
	`subject` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`phase` text NOT NULL,
	CONSTRAINT "identity_account_phase" CHECK("identity_accounts"."phase" IN ('provisioning', 'active', 'deleting_identity'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_accounts_account_id_unique` ON `identity_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `provisioning_jobs` (
	`subject` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_events` (
	`bucket` text NOT NULL,
	`event_id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_events_bucket` ON `rate_events` (`bucket`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `conversion_owners` (
	`conversion_id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`grant_id` text,
	`account_id` text,
	CONSTRAINT "conversion_owner_kind" CHECK("conversion_owners"."owner_kind" IN ('trial', 'account')),
	CONSTRAINT "conversion_owner_identity" CHECK(("conversion_owners"."owner_kind" = 'trial' AND "conversion_owners"."grant_id" IS NOT NULL AND "conversion_owners"."account_id" IS NULL) OR ("conversion_owners"."owner_kind" = 'account' AND "conversion_owners"."account_id" IS NOT NULL AND "conversion_owners"."grant_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `registry_grants` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`label` text NOT NULL,
	`phase` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`credential_issued` integer NOT NULL,
	`projection_allowance_milliseconds` integer DEFAULT 7200000 NOT NULL,
	`projection_revision` integer,
	`projection_revoked_at_ms` integer,
	`projection_reserved` integer,
	`projection_spent` integer,
	`projection_schema_version` integer,
	CONSTRAINT "registry_grant_phase" CHECK("registry_grants"."phase" IN ('reserved', 'initialized', 'active')),
	CONSTRAINT "registry_grant_credential" CHECK("registry_grants"."credential_issued" IN (0, 1)),
	CONSTRAINT "registry_grant_allowance" CHECK("registry_grants"."projection_allowance_milliseconds" > 0),
	CONSTRAINT "registry_grant_expiry" CHECK("registry_grants"."expires_at_ms" > "registry_grants"."created_at_ms"),
	CONSTRAINT "registry_grant_snapshot_reserved" CHECK("registry_grants"."projection_reserved" >= 0),
	CONSTRAINT "registry_grant_snapshot_spent" CHECK("registry_grants"."projection_spent" >= 0),
	CONSTRAINT "registry_grant_snapshot" CHECK((
        ("registry_grants"."projection_revision" IS NULL AND "registry_grants"."projection_reserved" IS NULL AND "registry_grants"."projection_spent" IS NULL AND "registry_grants"."projection_schema_version" IS NULL)
        OR ("registry_grants"."projection_revision" > 0 AND "registry_grants"."projection_reserved" IS NOT NULL AND "registry_grants"."projection_spent" IS NOT NULL AND "registry_grants"."projection_schema_version" > 0)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_grants_request_id_unique` ON `registry_grants` (`request_id`);
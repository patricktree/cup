-- Adds each account's usage projection to its identity mapping. Drizzle Kit copied the new columns
-- from the old table; the copy lists only existing columns, so every existing account starts without
-- a projection until the registry's alarm pulls one from the account.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_identity_accounts` (
	`subject` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`phase` text NOT NULL,
	`projection_revision` integer,
	`projection_allowance_milliseconds` integer,
	`projection_reserved_milliseconds` integer,
	`projection_spent_milliseconds` integer,
	`projection_schema_version` integer,
	CONSTRAINT "identity_account_phase" CHECK("__new_identity_accounts"."phase" IN ('provisioning', 'active', 'deleting_identity')),
	CONSTRAINT "identity_account_projection" CHECK((
        ("__new_identity_accounts"."projection_revision" IS NULL AND "__new_identity_accounts"."projection_allowance_milliseconds" IS NULL AND "__new_identity_accounts"."projection_reserved_milliseconds" IS NULL AND "__new_identity_accounts"."projection_spent_milliseconds" IS NULL AND "__new_identity_accounts"."projection_schema_version" IS NULL)
        OR ("__new_identity_accounts"."projection_revision" > 0 AND "__new_identity_accounts"."projection_allowance_milliseconds" >= 0 AND "__new_identity_accounts"."projection_reserved_milliseconds" >= 0 AND "__new_identity_accounts"."projection_spent_milliseconds" >= 0 AND "__new_identity_accounts"."projection_schema_version" > 0)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_identity_accounts`("subject", "account_id", "created_at_ms", "phase") SELECT "subject", "account_id", "created_at_ms", "phase" FROM `identity_accounts`;--> statement-breakpoint
DROP TABLE `identity_accounts`;--> statement-breakpoint
ALTER TABLE `__new_identity_accounts` RENAME TO `identity_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `identity_accounts_account_id_unique` ON `identity_accounts` (`account_id`);
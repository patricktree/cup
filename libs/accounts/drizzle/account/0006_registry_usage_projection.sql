-- Records which duration ledger revision the registry confirmed for the account's usage projection.
-- Drizzle Kit copied the new column from the old table; the copy lists only existing columns, so
-- every account starts unconfirmed and publishes its usage on its next alarm or registry pull.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`subject` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`state` text NOT NULL,
	`execution_epoch` integer NOT NULL,
	`recovery_deadline_ms` integer,
	`registry_confirmed_revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_singleton" CHECK("__new_account"."id" = 1),
	CONSTRAINT "account_state" CHECK("__new_account"."state" IN ('active', 'deletion_scheduled', 'deleting')),
	CONSTRAINT "account_epoch" CHECK("__new_account"."execution_epoch" > 0),
	CONSTRAINT "account_registry_confirmed_revision" CHECK("__new_account"."registry_confirmed_revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_account`("id", "account_id", "subject", "created_at_ms", "state", "execution_epoch", "recovery_deadline_ms") SELECT "id", "account_id", "subject", "created_at_ms", "state", "execution_epoch", "recovery_deadline_ms" FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `account_account_id_unique` ON `account` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_subject_unique` ON `account` (`subject`);
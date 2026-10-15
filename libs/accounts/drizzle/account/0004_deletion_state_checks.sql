PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deletion_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`state` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL,
	CONSTRAINT "deletion_attempt_state" CHECK("__new_deletion_attempts"."state" IN ('scheduled', 'restored', 'deleting')),
	CONSTRAINT "deletion_attempt_delivered" CHECK("__new_deletion_attempts"."delivered" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_deletion_attempts`("attempt_id", "payload_json", "state", "delivered") SELECT "attempt_id", "payload_json", "state", "delivered" FROM `deletion_attempts`;--> statement-breakpoint
DROP TABLE `deletion_attempts`;--> statement-breakpoint
ALTER TABLE `__new_deletion_attempts` RENAME TO `deletion_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_deletion_challenges` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`execution_epoch` integer NOT NULL,
	`state` text NOT NULL,
	`issued_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	CONSTRAINT "deletion_challenge_state" CHECK("__new_deletion_challenges"."state" IN ('active', 'deletion_scheduled')),
	CONSTRAINT "deletion_challenge_used" CHECK("__new_deletion_challenges"."used" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_deletion_challenges`("challenge_id", "execution_epoch", "state", "issued_at_ms", "expires_at_ms", "used") SELECT "challenge_id", "execution_epoch", "state", "issued_at_ms", "expires_at_ms", "used" FROM `deletion_challenges`;--> statement-breakpoint
DROP TABLE `deletion_challenges`;--> statement-breakpoint
ALTER TABLE `__new_deletion_challenges` RENAME TO `deletion_challenges`;
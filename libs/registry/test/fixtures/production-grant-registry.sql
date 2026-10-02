-- Production schema from c970a6e; retain independently of generated Drizzle schemas.
CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE registry_grants (
            grant_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN ('reserved', 'initialized', 'active')),
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
            credential_issued INTEGER NOT NULL CHECK (credential_issued IN (0, 1)),
            projection_revision INTEGER,
            projection_revoked_at_ms INTEGER,
            projection_reserved INTEGER CHECK (projection_reserved BETWEEN 0 AND 5),
            projection_spent INTEGER CHECK (projection_spent BETWEEN 0 AND 5),
            projection_schema_version INTEGER,
            CHECK (
              (projection_revision IS NULL AND projection_reserved IS NULL AND projection_spent IS NULL AND projection_schema_version IS NULL)
              OR (projection_revision > 0 AND projection_reserved IS NOT NULL AND projection_spent IS NOT NULL AND projection_schema_version > 0)
            )
          );
--> statement-breakpoint
CREATE TABLE conversion_grants (
            conversion_id TEXT PRIMARY KEY,
            grant_id TEXT NOT NULL REFERENCES registry_grants(grant_id)
          );
--> statement-breakpoint
CREATE TABLE registry_grants_new (
            grant_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN ('reserved', 'initialized', 'active')),
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
            credential_issued INTEGER NOT NULL CHECK (credential_issued IN (0, 1)),
            projection_revision INTEGER,
            projection_revoked_at_ms INTEGER,
            projection_reserved INTEGER CHECK (projection_reserved >= 0),
            projection_spent INTEGER CHECK (projection_spent >= 0),
            projection_schema_version INTEGER,
            CHECK (
              (projection_revision IS NULL AND projection_reserved IS NULL AND projection_spent IS NULL AND projection_schema_version IS NULL)
              OR (projection_revision > 0 AND projection_reserved IS NOT NULL AND projection_spent IS NOT NULL AND projection_schema_version > 0)
            )
          );
--> statement-breakpoint
INSERT INTO registry_grants_new SELECT * FROM registry_grants;
--> statement-breakpoint
ALTER TABLE registry_grants_new ADD COLUMN projection_max_slots INTEGER NOT NULL DEFAULT 5 CHECK (projection_max_slots > 0);
--> statement-breakpoint
CREATE TABLE conversion_grants_backup AS SELECT * FROM conversion_grants;
--> statement-breakpoint
DROP TABLE conversion_grants;
--> statement-breakpoint
DROP TABLE registry_grants;
--> statement-breakpoint
ALTER TABLE registry_grants_new RENAME TO registry_grants;
--> statement-breakpoint
CREATE TABLE conversion_grants (conversion_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES registry_grants(grant_id));
--> statement-breakpoint
INSERT INTO conversion_grants SELECT * FROM conversion_grants_backup;
--> statement-breakpoint
DROP TABLE conversion_grants_backup;
--> statement-breakpoint
ALTER TABLE registry_grants RENAME COLUMN projection_max_slots TO projection_allowance_milliseconds;
--> statement-breakpoint
UPDATE registry_grants SET projection_allowance_milliseconds = 7200000, projection_revision = projection_revision + 1, projection_reserved = 0, projection_spent = 0, projection_schema_version = 5 WHERE projection_revision IS NOT NULL;
--> statement-breakpoint
INSERT INTO _schema_migrations (version, applied_at_ms) VALUES (3, 1);

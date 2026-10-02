-- Production schema from c970a6e; retain independently of generated Drizzle schemas.
CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE grant (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            grant_id TEXT NOT NULL UNIQUE,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
            revoked_at_ms INTEGER,
            credential_verifier TEXT,
            credential_issued_at_ms INTEGER,
            session_signing_key TEXT NOT NULL,
            signing_key_generation INTEGER NOT NULL CHECK (signing_key_generation > 0),
            projection_revision INTEGER NOT NULL CHECK (projection_revision > 0),
            registry_confirmed_revision INTEGER NOT NULL CHECK (registry_confirmed_revision >= 0)
          );
--> statement-breakpoint
CREATE TABLE conversions (
            conversion_id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            article_url TEXT NOT NULL,
            accepted_at_ms INTEGER NOT NULL,
            workflow_started_at_ms INTEGER,
            status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
            completed_at_ms INTEGER,
            title TEXT,
            audiobook_reference_json TEXT CHECK (audiobook_reference_json IS NULL OR json_valid(audiobook_reference_json)),
            measurements_json TEXT CHECK (measurements_json IS NULL OR json_valid(measurements_json)),
            provider_usage_json TEXT CHECK (provider_usage_json IS NULL OR json_valid(provider_usage_json)),
            failure_category TEXT CHECK (failure_category IS NULL OR failure_category IN ('workflow-start', 'source-preparation', 'content-selection', 'content-limit', 'narration-synthesis', 'audiobook-assembly', 'workflow-platform', 'internal')),
            explanation TEXT,
            diagnostic_reference TEXT,
            cleanup_state TEXT CHECK (cleanup_state IS NULL OR cleanup_state IN ('pending', 'complete', 'cleanup_failed')),
            CHECK (
              (status = 'pending' AND completed_at_ms IS NULL AND audiobook_reference_json IS NULL AND failure_category IS NULL AND explanation IS NULL)
              OR (status = 'ready' AND completed_at_ms IS NOT NULL AND title IS NOT NULL AND audiobook_reference_json IS NOT NULL AND failure_category IS NULL AND explanation IS NULL)
              OR (status = 'failed' AND completed_at_ms IS NOT NULL AND audiobook_reference_json IS NULL AND failure_category IS NOT NULL AND explanation IS NOT NULL)
            )
          );
--> statement-breakpoint
CREATE TABLE start_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, attempted_at_ms INTEGER NOT NULL);
--> statement-breakpoint
ALTER TABLE conversions ADD COLUMN last_started_phase TEXT CHECK (last_started_phase IS NULL OR last_started_phase IN ('conversion-start', 'source-material-preparation', 'narration-content-selection', 'narration-document-creation', 'audio-segment-production', 'audiobook-assembly', 'audiobook-storage', 'finalization'));
--> statement-breakpoint
UPDATE conversions SET last_started_phase = CASE WHEN status = 'pending' THEN 'conversion-start' ELSE 'finalization' END;
--> statement-breakpoint
UPDATE grant SET projection_revision = projection_revision + 1;
--> statement-breakpoint
ALTER TABLE conversions RENAME COLUMN article_url TO source_url;
--> statement-breakpoint
ALTER TABLE grant ADD COLUMN max_slots INTEGER NOT NULL DEFAULT 5 CHECK (max_slots > 0);
--> statement-breakpoint
UPDATE grant SET projection_revision = projection_revision + 1;
--> statement-breakpoint
ALTER TABLE grant RENAME COLUMN max_slots TO allowance_milliseconds;
--> statement-breakpoint
CREATE TABLE segment_usage (
            conversion_id TEXT NOT NULL REFERENCES conversions(conversion_id),
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            narration_text_characters INTEGER NOT NULL CHECK (narration_text_characters > 0),
            estimated_milliseconds INTEGER NOT NULL CHECK (estimated_milliseconds > 0),
            state TEXT NOT NULL,
            actual_milliseconds INTEGER NOT NULL,
            charged_milliseconds INTEGER NOT NULL CHECK (charged_milliseconds >= 0 AND charged_milliseconds <= actual_milliseconds),
            PRIMARY KEY (conversion_id, sequence),
            CHECK (
              (state = 'settled' AND actual_milliseconds > 0)
              OR (state IN ('reserved', 'released') AND actual_milliseconds = 0 AND charged_milliseconds = 0)
            )
          );
--> statement-breakpoint
UPDATE grant SET allowance_milliseconds = 7200000, projection_revision = projection_revision + 1;
--> statement-breakpoint
INSERT INTO _schema_migrations (version, applied_at_ms) VALUES (5, 1);

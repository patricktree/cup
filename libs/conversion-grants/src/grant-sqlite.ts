import { asc, desc, eq } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import { segmentUsageSchema } from "#src/duration-accounting.ts";
import { conversionPhaseSchema } from "#src/grant-contracts.ts";
import type { GrantConversion, GrantRecord } from "#src/grant-model.ts";
import { GRANT_SCHEMA_VERSION } from "#src/grant-model.ts";
import {
  conversions as conversionTable,
  grants as grantTable,
  grantSqliteSchema,
  schemaMigrations,
  segmentUsage as segmentUsageTable,
  startAttempts as startAttemptTable,
} from "#src/sqlite-schema.ts";
import { nowMilliseconds } from "#src/time.ts";

export class ConversionGrantSqlite {
  private readonly database: DrizzleSqliteDODatabase<typeof grantSqliteSchema>;
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage, { schema: grantSqliteSchema });
    this.storage = storage;
  }

  async applyMigrations(): Promise<void> {
    this.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL)",
    );
    const latest =
      this.database
        .select({ version: schemaMigrations.version })
        .from(schemaMigrations)
        .orderBy(desc(schemaMigrations.version))
        .limit(1)
        .get()?.version ?? 0;
    if (latest > GRANT_SCHEMA_VERSION)
      throw new Error("Conversion grant schema is newer than this Worker");
    if (latest < 1) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `CREATE TABLE grant (
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
          )`,
        );
        this.storage.sql.exec(
          `CREATE TABLE conversions (
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
          )`,
        );
        this.storage.sql.exec(
          "CREATE TABLE start_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, attempted_at_ms INTEGER NOT NULL)",
        );
        this.database
          .insert(schemaMigrations)
          .values({ version: 1, appliedAtMs: nowMilliseconds() })
          .run();
      });
    }
    if (latest < 2) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `ALTER TABLE conversions ADD COLUMN last_started_phase TEXT CHECK (last_started_phase IS NULL OR last_started_phase IN ('conversion-start', 'source-material-preparation', 'narration-content-selection', 'narration-document-creation', 'audio-segment-production', 'audiobook-assembly', 'audiobook-storage', 'finalization'))`,
        );
        this.storage.sql.exec(
          "UPDATE conversions SET last_started_phase = CASE WHEN status = 'pending' THEN 'conversion-start' ELSE 'finalization' END",
        );
        this.storage.sql.exec("UPDATE grant SET projection_revision = projection_revision + 1");
        this.database
          .insert(schemaMigrations)
          .values({ version: 2, appliedAtMs: nowMilliseconds() })
          .run();
      });
      const existingGrant = this.database
        .select({ id: grantTable.id })
        .from(grantTable)
        .where(eq(grantTable.id, 1))
        .get();
      if (existingGrant !== undefined) await this.storage.setAlarm(nowMilliseconds());
    }
    if (latest < 3) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec("ALTER TABLE conversions RENAME COLUMN article_url TO source_url");
        this.database
          .insert(schemaMigrations)
          .values({ version: 3, appliedAtMs: nowMilliseconds() })
          .run();
      });
    }
    if (latest < 4) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          "ALTER TABLE grant ADD COLUMN max_slots INTEGER NOT NULL DEFAULT 5 CHECK (max_slots > 0)",
        );
        this.storage.sql.exec("UPDATE grant SET projection_revision = projection_revision + 1");
        this.database
          .insert(schemaMigrations)
          .values({ version: 4, appliedAtMs: nowMilliseconds() })
          .run();
      });
      if (this.database.select({ id: grantTable.id }).from(grantTable).get() !== undefined)
        await this.storage.setAlarm(nowMilliseconds());
    }
    if (latest < 5) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          "ALTER TABLE grant RENAME COLUMN max_slots TO allowance_milliseconds",
        );
        this.storage.sql.exec(
          `CREATE TABLE segment_usage (
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
          )`,
        );
        this.storage.sql.exec(
          "UPDATE grant SET allowance_milliseconds = 7200000, projection_revision = projection_revision + 1",
        );
        this.database
          .insert(schemaMigrations)
          .values({ version: 5, appliedAtMs: nowMilliseconds() })
          .run();
      });
      if (this.database.select({ id: grantTable.id }).from(grantTable).get() !== undefined)
        await this.storage.setAlarm(nowMilliseconds());
    }
  }

  async load(): Promise<GrantRecord | undefined> {
    const row = this.database.select().from(grantTable).where(eq(grantTable.id, 1)).get();
    if (row === undefined) return undefined;
    const conversions = this.database
      .select()
      .from(conversionTable)
      .orderBy(asc(conversionTable.acceptedAtMs), asc(conversionTable.conversionId))
      .all()
      .map(conversionRowToUnknown);
    const parsed: unknown = {
      grantId: row.grantId,
      allowanceMilliseconds: row.allowanceMilliseconds,
      segmentUsage: segmentUsageSchema
        .array()
        .parse(
          this.database
            .select()
            .from(segmentUsageTable)
            .orderBy(asc(segmentUsageTable.conversionId), asc(segmentUsageTable.sequence))
            .all(),
        ),
      createdAtMs: row.createdAtMs,
      expiresAtMs: row.expiresAtMs,
      ...(row.revokedAtMs === null ? {} : { revokedAtMs: row.revokedAtMs }),
      ...(row.credentialVerifier === null ? {} : { credentialVerifier: row.credentialVerifier }),
      ...(row.credentialIssuedAtMs === null
        ? {}
        : { credentialIssuedAtMs: row.credentialIssuedAtMs }),
      sessionSigningKey: row.sessionSigningKey,
      signingKeyGeneration: row.signingKeyGeneration,
      registrySnapshotRevision: row.registrySnapshotRevision,
      registryConfirmedSnapshotRevision: row.registryConfirmedSnapshotRevision,
      startAttempts: this.database
        .select({ attemptedAtMs: startAttemptTable.attemptedAtMs })
        .from(startAttemptTable)
        .orderBy(asc(startAttemptTable.attemptedAtMs), asc(startAttemptTable.id))
        .all()
        .map((attempt) => attempt.attemptedAtMs),
      conversions,
    };
    if (!isGrantRecord(parsed)) throw new Error("Conversion grant storage is corrupt");
    return parsed;
  }

  async requireRecord(): Promise<GrantRecord> {
    const record = await this.load();
    if (record === undefined) throw new Error("Conversion grant is not initialized");
    return record;
  }

  async save(record: GrantRecord): Promise<void> {
    const mutableGrant = {
      allowanceMilliseconds: record.allowanceMilliseconds,
      revokedAtMs: record.revokedAtMs ?? null,
      credentialVerifier: record.credentialVerifier ?? null,
      credentialIssuedAtMs: record.credentialIssuedAtMs ?? null,
      sessionSigningKey: record.sessionSigningKey,
      signingKeyGeneration: record.signingKeyGeneration,
      registrySnapshotRevision: record.registrySnapshotRevision,
      registryConfirmedSnapshotRevision: record.registryConfirmedSnapshotRevision,
    };
    this.database
      .insert(grantTable)
      .values({
        id: 1,
        grantId: record.grantId,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
        ...mutableGrant,
      })
      .onConflictDoUpdate({ target: grantTable.id, set: mutableGrant })
      .run();
    for (const conversion of record.conversions) {
      const row = conversionToRow(conversion);
      const { conversionId, ...mutableConversion } = row;
      this.database
        .insert(conversionTable)
        .values({ conversionId, ...mutableConversion })
        .onConflictDoUpdate({ target: conversionTable.conversionId, set: mutableConversion })
        .run();
    }
    for (const segment of record.segmentUsage)
      this.database
        .insert(segmentUsageTable)
        .values(segment)
        .onConflictDoUpdate({
          target: [segmentUsageTable.conversionId, segmentUsageTable.sequence],
          set: {
            estimatedMilliseconds: segment.estimatedMilliseconds,
            state: segment.state,
            actualMilliseconds: segment.actualMilliseconds,
            chargedMilliseconds: segment.chargedMilliseconds,
          },
        })
        .run();
    this.database.delete(startAttemptTable).run();
    if (record.startAttempts.length > 0)
      this.database
        .insert(startAttemptTable)
        .values(record.startAttempts.map((attemptedAtMs) => ({ attemptedAtMs })))
        .run();
  }
}

type ConversionRow = typeof conversionTable.$inferSelect;

function conversionRowToUnknown(row: ConversionRow): unknown {
  const base = {
    conversionId: row.conversionId,
    idempotencyKey: row.idempotencyKey,
    sourceUrl: row.sourceUrl,
    acceptedAtMs: row.acceptedAtMs,
    ...(row.workflowStartedAtMs === null ? {} : { workflowStartedAtMs: row.workflowStartedAtMs }),
    lastStartedPhase: row.lastStartedPhase,
  };
  if (row.status === "pending") return { ...base, status: "pending" };
  if (row.status === "ready")
    return {
      ...base,
      status: "ready",
      completedAtMs: row.completedAtMs,
      title: row.title,
      audiobookReference: row.audiobookReference,
      ...(row.measurements === null ? {} : { measurements: row.measurements }),
      ...(row.providerUsage === null ? {} : { providerUsage: row.providerUsage }),
    };
  return {
    ...base,
    status: row.status,
    completedAtMs: row.completedAtMs,
    ...(row.title === null ? {} : { title: row.title }),
    failureCategory: row.failureCategory,
    explanation: row.explanation,
    ...(row.diagnosticReference === null ? {} : { diagnosticReference: row.diagnosticReference }),
    ...(row.cleanupState === null ? {} : { cleanupState: row.cleanupState }),
  };
}

function conversionToRow(conversion: GrantConversion): typeof conversionTable.$inferInsert {
  const values =
    conversion.status === "ready"
      ? {
          completedAtMs: conversion.completedAtMs,
          title: conversion.title,
          audiobookReference: conversion.audiobookReference,
          measurements: conversion.measurements ?? null,
          providerUsage: conversion.providerUsage ?? null,
          failureCategory: null,
          explanation: null,
          diagnosticReference: null,
          cleanupState: null,
          lastStartedPhase: conversion.lastStartedPhase,
        }
      : conversion.status === "failed"
        ? {
            completedAtMs: conversion.completedAtMs,
            title: conversion.title ?? null,
            audiobookReference: null,
            measurements: null,
            providerUsage: null,
            failureCategory: conversion.failureCategory,
            explanation: conversion.explanation,
            diagnosticReference: conversion.diagnosticReference ?? null,
            cleanupState: conversion.cleanupState ?? null,
            lastStartedPhase: conversion.lastStartedPhase,
          }
        : {
            completedAtMs: null,
            title: conversion.title ?? null,
            audiobookReference: null,
            measurements: null,
            providerUsage: null,
            failureCategory: null,
            explanation: null,
            diagnosticReference: null,
            cleanupState: null,
            lastStartedPhase: conversion.lastStartedPhase,
          };
  return {
    conversionId: conversion.conversionId,
    idempotencyKey: conversion.idempotencyKey,
    sourceUrl: conversion.sourceUrl,
    acceptedAtMs: conversion.acceptedAtMs,
    workflowStartedAtMs: conversion.workflowStartedAtMs ?? null,
    status: conversion.status,
    ...values,
  };
}

function isGrantRecord(value: unknown): value is GrantRecord {
  return (
    isRecord(value) &&
    typeof value["allowanceMilliseconds"] === "number" &&
    Number.isSafeInteger(value["allowanceMilliseconds"]) &&
    value["allowanceMilliseconds"] > 0 &&
    typeof value["grantId"] === "string" &&
    typeof value["createdAtMs"] === "number" &&
    typeof value["expiresAtMs"] === "number" &&
    typeof value["sessionSigningKey"] === "string" &&
    typeof value["signingKeyGeneration"] === "number" &&
    typeof value["registrySnapshotRevision"] === "number" &&
    typeof value["registryConfirmedSnapshotRevision"] === "number" &&
    Array.isArray(value["startAttempts"]) &&
    value["startAttempts"].every((attempt) => typeof attempt === "number") &&
    Array.isArray(value["segmentUsage"]) &&
    Array.isArray(value["conversions"]) &&
    value["conversions"].every(isGrantConversion)
  );
}

function isGrantConversion(value: unknown): value is GrantConversion {
  if (
    !isRecord(value) ||
    typeof value["conversionId"] !== "string" ||
    typeof value["idempotencyKey"] !== "string" ||
    typeof value["sourceUrl"] !== "string" ||
    typeof value["acceptedAtMs"] !== "number" ||
    !conversionPhaseSchema.safeParse(value["lastStartedPhase"]).success
  ) {
    return false;
  }
  if (value["status"] === "pending") return true;
  if (value["status"] === "ready") {
    return (
      typeof value["completedAtMs"] === "number" &&
      typeof value["title"] === "string" &&
      isRecord(value["audiobookReference"]) &&
      typeof value["audiobookReference"]["key"] === "string" &&
      value["audiobookReference"]["contentType"] === "application/json" &&
      typeof value["audiobookReference"]["byteLength"] === "number" &&
      typeof value["audiobookReference"]["etag"] === "string"
    );
  }
  return (
    value["status"] === "failed" &&
    typeof value["completedAtMs"] === "number" &&
    typeof value["failureCategory"] === "string" &&
    typeof value["explanation"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

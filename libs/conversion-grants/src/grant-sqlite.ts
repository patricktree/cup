import { asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import { conversionPhaseSchema } from "@cup/conversion-contracts";
import { segmentUsageSchema } from "@cup/conversion-contracts/duration-accounting";

import type { GrantConversion, GrantRecord } from "#src/grant-model.ts";
import {
  conversions as conversionTable,
  grants as grantTable,
  grantSqliteSchema,
  segmentUsage as segmentUsageTable,
  startAttempts as startAttemptTable,
} from "#src/grant-sqlite-schema.ts";
import { migrateLegacyGrant } from "#src/legacy-grant-migrations.ts";
import { nowMilliseconds } from "#src/time.ts";

export class ConversionGrantSqlite {
  private readonly database: DrizzleSqliteDODatabase<typeof grantSqliteSchema>;
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage, { schema: grantSqliteSchema });
    this.storage = storage;
  }

  async applyMigrations(): Promise<void> {
    await migrateLegacyGrant(this.database);

    const grant = this.database.select().from(grantTable).get();
    if (
      grant !== undefined &&
      grant.registryConfirmedSnapshotRevision < grant.registrySnapshotRevision &&
      (await this.storage.getAlarm()) === null
    )
      await this.storage.setAlarm(nowMilliseconds());
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

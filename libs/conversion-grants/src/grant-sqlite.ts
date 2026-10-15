import { asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";

import { conversionPhaseSchema } from "@cup/conversion-contracts";
import { DurationLedger } from "@cup/duration-ledger";

import type { GrantConversion, GrantRecord } from "#src/grant-model.ts";
import {
  audioSegments,
  conversions as conversionTable,
  grants as grantTable,
  grantSqliteSchema,
} from "#src/grant-sqlite-schema.ts";
import { migrateLegacyGrant } from "#src/legacy-grant-migrations.ts";

export class ConversionGrantSqlite {
  readonly duration: DurationLedger;
  private readonly database: DrizzleSqliteDODatabase<typeof grantSqliteSchema>;
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage, { schema: grantSqliteSchema });
    this.duration = new DurationLedger(storage, audioSegments);
    this.storage = storage;
  }

  async applyMigrations(): Promise<void> {
    await migrateLegacyGrant(this.database);

    const grant = this.database.select().from(grantTable).get();
    if (
      grant !== undefined &&
      grant.registryConfirmedSnapshotRevision < grant.registrySnapshotRevision &&
      (await this.storage.getAlarm()) === null
    ) {
      await this.storage.setAlarm(Temporal.Now.instant().epochMilliseconds);
    }
  }

  async load(): Promise<GrantRecord | undefined> {
    const row = this.database.select().from(grantTable).where(eq(grantTable.id, 1)).get();
    if (row === undefined) {
      return undefined;
    }
    const conversions = this.database
      .select()
      .from(conversionTable)
      .orderBy(asc(conversionTable.createdAtMs), asc(conversionTable.conversionId))
      .all()
      .map(conversionRowToUnknown);
    const parsed: unknown = {
      grantId: row.grantId,
      segmentUsage: this.duration.allSegments(),
      duration: this.duration.totals(),
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
      conversions,
    };
    if (!isGrantRecord(parsed)) {
      throw new Error("Conversion grant storage is corrupt");
    }
    return parsed;
  }

  async requireRecord(): Promise<GrantRecord> {
    const record = await this.load();
    if (record === undefined) {
      throw new Error("Conversion grant is not initialized");
    }
    return record;
  }

  /** Saves the grant and its conversions; duration changes go through `duration` instead. */
  async save(record: Omit<GrantRecord, "segmentUsage" | "duration">): Promise<void> {
    const mutableGrant = {
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
  }
}

type ConversionRow = typeof conversionTable.$inferSelect;

function conversionRowToUnknown(row: ConversionRow): unknown {
  const base = {
    conversionId: row.conversionId,
    idempotencyKey: row.idempotencyKey,
    sourceUrl: row.sourceUrl,
    createdAtMs: row.createdAtMs,
    ...(row.workflowStartedAtMs === null ? {} : { workflowStartedAtMs: row.workflowStartedAtMs }),
    lastStartedPhase: row.lastStartedPhase,
  };
  if (row.status === "pending") {
    return { ...base, status: "pending" };
  }
  if (row.status === "ready") {
    return {
      ...base,
      status: "ready",
      completedAtMs: row.completedAtMs,
      title: row.title,
      audiobookReference: row.audiobookReference,
      ...(row.hasCoverImage === true ? { hasCoverImage: true } : {}),
      ...(row.measurements === null ? {} : { measurements: row.measurements }),
      ...(row.providerUsage === null ? {} : { providerUsage: row.providerUsage }),
    };
  }
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
          hasCoverImage: conversion.hasCoverImage ?? null,
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
            hasCoverImage: null,
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
            hasCoverImage: null,
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
    createdAtMs: conversion.createdAtMs,
    workflowStartedAtMs: conversion.workflowStartedAtMs ?? null,
    status: conversion.status,
    ...values,
  };
}

function isGrantRecord(value: unknown): value is GrantRecord {
  return (
    isRecord(value) &&
    typeof value["grantId"] === "string" &&
    typeof value["createdAtMs"] === "number" &&
    typeof value["expiresAtMs"] === "number" &&
    typeof value["sessionSigningKey"] === "string" &&
    typeof value["signingKeyGeneration"] === "number" &&
    typeof value["registrySnapshotRevision"] === "number" &&
    typeof value["registryConfirmedSnapshotRevision"] === "number" &&
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
    typeof value["createdAtMs"] !== "number" ||
    !conversionPhaseSchema.safeParse(value["lastStartedPhase"]).success
  ) {
    return false;
  }
  if (value["status"] === "pending") {
    return true;
  }
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

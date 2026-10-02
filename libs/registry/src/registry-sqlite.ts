import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import type { ConversionOwner } from "@cup/conversion-contracts";

import type { RegistryEntry, RegistryRecord } from "#src/registry-model.ts";
import {
  registryGrants as registryGrantTable,
  registrySqliteSchema,
  conversionOwners,
} from "#src/registry-sqlite-schema.ts";
import { migrateRegistry } from "#src/sqlite-migrations.ts";

// https://developers.cloudflare.com/durable-objects/platform/limits/
const MAX_SQL_PARAMETERS = 100;
const GRANTS_PER_BATCH = Math.floor(
  MAX_SQL_PARAMETERS / Object.keys(getTableColumns(registryGrantTable)).length,
);

export class RegistrySqlite {
  private readonly database: DrizzleSqliteDODatabase<typeof registrySqliteSchema>;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage, { schema: registrySqliteSchema });
  }

  applyMigrations(): Promise<void> {
    return migrateRegistry(this.database);
  }

  findConversionOwner(conversionId: string) {
    return this.database
      .select()
      .from(conversionOwners)
      .where(eq(conversionOwners.conversionId, conversionId))
      .get();
  }

  saveConversionOwner(conversionId: string, owner: ConversionOwner): void {
    this.database
      .insert(conversionOwners)
      .values({
        conversionId,
        kind: owner.kind,
        grantId: owner.kind === "trial" ? owner.grantId : null,
        accountId: owner.kind === "account" ? owner.accountId : null,
      })
      .onConflictDoNothing({ target: conversionOwners.conversionId })
      .run();
  }

  removeAccountConversionOwners(accountId: string): void {
    this.database
      .delete(conversionOwners)
      .where(and(eq(conversionOwners.kind, "account"), eq(conversionOwners.accountId, accountId)))
      .run();
  }

  async load(): Promise<RegistryRecord> {
    const grants = this.database
      .select()
      .from(registryGrantTable)
      .orderBy(asc(registryGrantTable.createdAtMs), asc(registryGrantTable.grantId))
      .all()
      .map((row) => ({
        requestId: row.requestId,
        grantId: row.grantId,
        label: row.label,
        phase: row.phase,
        createdAtMs: row.createdAtMs,
        expiresAtMs: row.expiresAtMs,
        credentialIssued: row.credentialIssued,
        ...(row.snapshotRevision === null ||
        row.snapshotReserved === null ||
        row.snapshotSpent === null ||
        row.snapshotSchemaVersion === null
          ? {}
          : {
              grantSnapshot: {
                grantId: row.grantId,
                revision: row.snapshotRevision,
                allowanceMilliseconds: row.snapshotAllowanceMilliseconds,
                ...(row.snapshotRevokedAtMs === null
                  ? {}
                  : { revokedAtMs: row.snapshotRevokedAtMs }),
                reservedMilliseconds: row.snapshotReserved,
                spentMilliseconds: row.snapshotSpent,
                schemaVersion: row.snapshotSchemaVersion,
              },
            }),
      }));
    const parsed: unknown = { grants };
    if (!isRegistryRecord(parsed)) throw new Error("Registry storage is corrupt");
    return parsed;
  }

  async save(record: RegistryRecord): Promise<void> {
    // Callers hold a storage transaction across the delete and every insert batch.
    this.database.delete(registryGrantTable).run();
    for (let offset = 0; offset < record.grants.length; offset += GRANTS_PER_BATCH)
      this.database
        .insert(registryGrantTable)
        .values(
          record.grants.slice(offset, offset + GRANTS_PER_BATCH).map((entry) => ({
            grantId: entry.grantId,
            requestId: entry.requestId,
            label: entry.label,
            phase: entry.phase,
            createdAtMs: entry.createdAtMs,
            expiresAtMs: entry.expiresAtMs,
            credentialIssued: entry.credentialIssued,
            snapshotRevision: entry.grantSnapshot?.revision ?? null,
            snapshotAllowanceMilliseconds: entry.grantSnapshot?.allowanceMilliseconds ?? 7_200_000,
            snapshotRevokedAtMs: entry.grantSnapshot?.revokedAtMs ?? null,
            snapshotReserved: entry.grantSnapshot?.reservedMilliseconds ?? null,
            snapshotSpent: entry.grantSnapshot?.spentMilliseconds ?? null,
            snapshotSchemaVersion: entry.grantSnapshot?.schemaVersion ?? null,
          })),
        )
        .run();
  }
}

function isRegistryRecord(value: unknown): value is RegistryRecord {
  return (
    isRecord(value) && Array.isArray(value["grants"]) && value["grants"].every(isRegistryEntry)
  );
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  return (
    isRecord(value) &&
    typeof value["requestId"] === "string" &&
    typeof value["grantId"] === "string" &&
    typeof value["label"] === "string" &&
    (value["phase"] === "reserved" ||
      value["phase"] === "initialized" ||
      value["phase"] === "active") &&
    typeof value["createdAtMs"] === "number" &&
    typeof value["expiresAtMs"] === "number" &&
    typeof value["credentialIssued"] === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

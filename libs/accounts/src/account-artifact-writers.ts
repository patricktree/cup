import { eq, ne } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";

import { getAccountConversionIdFromArtifactPrefix } from "@cup/conversion-contracts";

import type { AccountSnapshot } from "#src/account-contracts.ts";
import { artifactWriters, accountConversions } from "#src/account-sqlite-schema.ts";
import { requireRow } from "#src/sqlite-row.ts";

/** Tracks account storage effects so deletion waits for acknowledged production/export writes. */
export class AccountArtifactWriters {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly account: () => AccountSnapshot;

  constructor(storage: DurableObjectStorage, account: () => AccountSnapshot) {
    this.database = drizzle(storage);
    this.account = account;
  }

  prepareWrite(
    writerId: string,
    executionEpoch: number,
    prefix: string,
    purpose: "production" | "export",
    key: string,
  ) {
    if (!key.startsWith(prefix)) throw new Error("Artifact key is outside its prefix");
    this.database.transaction(() => {
      this.registerWriter(writerId, executionEpoch, prefix, purpose);
      this.writerEffect(writerId, "put:" + key);
    });
  }

  registerWriter(
    writerId: string,
    executionEpoch: number,
    prefix: string,
    purpose: "production" | "export",
  ) {
    const account = this.account();
    if (
      !this.canWrite(account, executionEpoch) ||
      getAccountConversionIdFromArtifactPrefix(prefix, account.accountId) === undefined
    )
      throw new Error("Artifact writer registration is fenced");
    this.assertWriterTarget(prefix, purpose);
    this.database
      .insert(artifactWriters)
      .values({ writerId, executionEpoch, prefix, state: "running", purpose })
      .onConflictDoNothing()
      .run();
    const existing = requireRow(
      this.database
        .select()
        .from(artifactWriters)
        .where(eq(artifactWriters.writerId, writerId))
        .get(),
    );
    if (
      existing.executionEpoch !== executionEpoch ||
      existing.prefix !== prefix ||
      existing.state !== "running"
    )
      throw new Error("Artifact writer identity conflict");
  }

  writerEffect(writerId: string, effect: string | null) {
    this.database.transaction(() => {
      const writer = requireRow(
        this.database
          .select()
          .from(artifactWriters)
          .where(eq(artifactWriters.writerId, writerId))
          .get(),
      );
      if (writer.state !== "running") throw new Error("Artifact writer is not running");
      if (effect !== null) this.assertWriterTarget(writer.prefix, writer.purpose);
      if (effect !== null && !this.canWrite(this.account(), writer.executionEpoch))
        throw new Error("Artifact writer execution is fenced");
      if (effect !== null && writer.effect !== null)
        throw new Error("Artifact writer has an unresolved effect");
      this.database
        .update(artifactWriters)
        .set({ effect })
        .where(eq(artifactWriters.writerId, writerId))
        .run();
    });
  }

  private assertWriterTarget(prefix: string, purpose: string) {
    const account = this.account();
    const conversionId = getAccountConversionIdFromArtifactPrefix(prefix, account.accountId);
    if (conversionId === undefined) throw new Error("Artifact writer target is invalid");
    if (purpose !== "production" && purpose !== "export")
      throw new Error("Artifact writer purpose is unsupported");
    const conversion = this.database
      .select({ status: accountConversions.status })
      .from(accountConversions)
      .where(eq(accountConversions.conversionId, conversionId))
      .get();
    if (conversion?.status !== (purpose === "export" ? "ready" : "pending"))
      throw new Error("Artifact writer target is fenced");
  }

  find(writerId: string) {
    return this.database
      .select()
      .from(artifactWriters)
      .where(eq(artifactWriters.writerId, writerId))
      .get();
  }

  writers() {
    return this.database
      .select({
        writerId: artifactWriters.writerId,
        prefix: artifactWriters.prefix,
        state: artifactWriters.state,
        effect: artifactWriters.effect,
      })
      .from(artifactWriters)
      .where(ne(artifactWriters.state, "drained"))
      .all();
  }

  private canWrite(account: AccountSnapshot, executionEpoch: number) {
    return (
      account.executionEpoch === executionEpoch &&
      (account.state === "active" ||
        (account.state === "deletion_scheduled" &&
          account.recoveryDeadlineMs !== null &&
          Temporal.Now.instant().epochMilliseconds < account.recoveryDeadlineMs))
    );
  }

  drainWriter(writerId: string) {
    const writer = requireRow(
      this.database
        .select()
        .from(artifactWriters)
        .where(eq(artifactWriters.writerId, writerId))
        .get(),
    );
    if (writer.effect !== null) throw new Error("Artifact writer has an unresolved storage effect");
    this.database
      .update(artifactWriters)
      .set({ state: "drained" })
      .where(eq(artifactWriters.writerId, writerId))
      .run();
  }
}

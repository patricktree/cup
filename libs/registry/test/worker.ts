import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";

import { AccountDurableObject as BaseAccountDurableObject } from "@cup/accounts";
import type { DeletionAttempt } from "@cup/accounts/lifecycle";

import { DeletionCoordinator } from "#src/account-deletion/deletion-coordinator.ts";
import { RegistryDurableObject as BaseRegistryDurableObject } from "#src/index.ts";
import { migrateRegistry } from "#src/storage/sqlite-migrations.ts";

import { createHoldingAccounts, type AccountMethod, type Hold } from "#test/holding-accounts.ts";

/** Simulates a launch acknowledgement loss followed by exhausted terminal RPC retries. */
export class AccountDispatchTestDurableObject extends BaseAccountDurableObject {
  constructor(
    context: DurableObjectState,
    env: {
      CONVERSION_OWNER_LIMIT: string;
      REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
      AUDIO_BUCKET: R2Bucket;
    },
  ) {
    super(context, {
      CONVERSION_OWNER_LIMIT: env.CONVERSION_OWNER_LIMIT,
      REGISTRY: env.REGISTRY,
      AUDIO_BUCKET: env.AUDIO_BUCKET,
      SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW: {
        create: async () => {
          throw new Error("Synthesis is controlled by the test");
        },
        get: async () => {
          throw new Error("Synthesis is controlled by the test");
        },
      },
      PREPARE_AUDIOBOOK_WORKFLOW: {
        create: async () => {
          throw new Error("Lost acknowledgement");
        },
        get: async () => ({
          status: async () => ({ status: "errored" }),
          restart: async () => {
            throw new Error("Restart is outside this dispatch test");
          },
        }),
      },
    });
  }
  async migrateForTest() {
    await this.migrate();
    return { snapshot: this.inspect(), accounting: this.inspectAccounting() };
  }
  reconcileForTest() {
    return this.alarm();
  }
}

/**
 * Ledger and lifecycle tests settle conversions directly without running preparation. Synthesis
 * dispatch is accepted but never runs, so tests complete or release segments themselves.
 */
export class AccountDurableObject extends BaseAccountDurableObject {
  constructor(
    context: DurableObjectState,
    env: {
      CONVERSION_OWNER_LIMIT: string;
      REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
      AUDIO_BUCKET: R2Bucket;
    },
  ) {
    super(context, {
      ...env,
      SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW: {
        create: async () => {},
        get: async () => {
          throw new Error("Synthesis is controlled by the test");
        },
      },
      PREPARE_AUDIOBOOK_WORKFLOW: {
        create: async () => {
          throw new Error("Preparation is controlled by the test");
        },
        get: async () => {
          throw new Error("Preparation is controlled by the test");
        },
      },
    });
  }
}
/** Simulates accounts that predate usage projections, so the alarm's backfill can be observed. */
export class RegistryDurableObject extends BaseRegistryDurableObject {
  forgetAccountUsageForTest(accountId: string) {
    this.ctx.storage.sql.exec(
      `UPDATE identity_accounts SET projection_revision = NULL,
        projection_allowance_milliseconds = NULL, projection_reserved_milliseconds = NULL,
        projection_spent_milliseconds = NULL, projection_schema_version = NULL
      WHERE account_id = ?`,
      accountId,
    );
  }
  reconcileForTest() {
    return this.alarm();
  }
}

export { ConversionGrantDurableObject } from "@cup/conversion-grants";

export default {
  fetch(): Response {
    return new Response("Account test Worker");
  },
} satisfies ExportedHandler;

export class DeletionTestDurableObject extends DurableObject<{
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
}> {
  constructor(
    context: DurableObjectState,
    env: { ACCOUNTS: DurableObjectNamespace<AccountDurableObject> },
  ) {
    super(context, env);
    void context.blockConcurrencyWhile(() => migrateRegistry(drizzle(context.storage)));
  }
  private responseStatus = 200;
  private retryAfter: string | undefined;
  private requests = 0;
  private readonly coordinator = new DeletionCoordinator(
    this.ctx.storage,
    {
      ACCOUNTS: this.env.ACCOUNTS,
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SECRET_KEY: "test",
      RESEND_API_KEY: "test",
      RESEND_BASE_URL: "https://resend.test",
    },
    {
      request: async () => {
        this.requests += 1;
        return new Response("{}", {
          status: this.responseStatus,
          headers: this.retryAfter ? { "Retry-After": this.retryAfter } : {},
        });
      },
    },
  );
  private readonly holdingAccounts = createHoldingAccounts(this.env.ACCOUNTS);
  private accountHold: Hold | undefined;
  /** `accept()` schedules a coordinator alarm; these tests reconcile explicitly instead. */
  override async alarm() {}
  configureProviderForTest(status: number, retryAfter?: string) {
    this.responseStatus = status;
    this.retryAfter = retryAfter;
  }
  requestsForTest() {
    return this.requests;
  }
  async reconcileForTest() {
    await this.coordinator.reconcile(
      () => {},
      () => {},
    );
    return this.coordinator.receipts();
  }

  acceptForTest(attempt: DeletionAttempt) {
    return this.coordinator.accept(attempt);
  }
  statusForTest() {
    return this.coordinator.status();
  }
  /**
   * Reconciles with real `fetch` against the given Resend origin, such as a Resend stub, and with
   * account calls through the holding ACCOUNTS double.
   */
  async reconcileWithProvidersForTest(resendBaseUrl: string, timeoutMs: number) {
    const coordinator = new DeletionCoordinator(
      this.ctx.storage,
      {
        ACCOUNTS: this.holdingAccounts.accounts,
        SUPABASE_URL: "http://127.0.0.1:9",
        SUPABASE_SECRET_KEY: "test",
        RESEND_API_KEY: "test-resend",
        RESEND_BASE_URL: resendBaseUrl,
      },
      { timeoutMs },
    );
    await coordinator.reconcile(
      () => {},
      () => {},
    );
    return coordinator.receipts();
  }
  holdNextAccountCallForTest(method: AccountMethod) {
    this.accountHold = this.holdingAccounts.holdNext(method);
  }
  async accountCallReachedForTest() {
    await this.accountHold?.reached;
  }
  releaseAccountCallForTest() {
    this.accountHold?.release();
  }
}

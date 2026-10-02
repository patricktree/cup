import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";

import { AccountDurableObject } from "@cup/accounts";

import { DeletionCoordinator } from "#src/deletion-coordinator.ts";
import type { RegistryDurableObject } from "#src/registry-durable-object.ts";
import { migrateRegistry } from "#src/sqlite-migrations.ts";

/** Simulates a launch acknowledgement loss followed by exhausted terminal RPC retries. */
export class AccountDispatchTestDurableObject extends AccountDurableObject {
  constructor(
    context: DurableObjectState,
    env: {
      CONVERSION_OWNER_LIMIT: string;
      REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
    },
  ) {
    super(context, {
      CONVERSION_OWNER_LIMIT: env.CONVERSION_OWNER_LIMIT,
      REGISTRY: env.REGISTRY,
      CREATE_AUDIOBOOK_FROM_URL_WORKFLOW: {
        create: async () => {
          throw new Error("Lost acknowledgement");
        },
        get: async () => ({ status: async () => ({ status: "errored" }) }),
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

export { AccountDurableObject };
export { RegistryDurableObject } from "#src/index.ts";

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
    },
    async () => {
      this.requests += 1;
      return new Response("{}", {
        status: this.responseStatus,
        headers: this.retryAfter ? { "Retry-After": this.retryAfter } : {},
      });
    },
  );
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
}

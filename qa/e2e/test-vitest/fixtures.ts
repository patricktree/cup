import { afterAll, beforeAll } from "vitest";

import { startTestWorker, type TestWorker } from "@cup/test-worker";

export type WorkerEnvironment = {
  readonly origin: string;
  createTrial(): Promise<{ grantId: string; credential: string }>;
};

export function useWorkerEnvironment(): WorkerEnvironment {
  let worker: TestWorker | undefined;

  beforeAll(async () => {
    worker = await startTestWorker();
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
  });

  const startedWorker = (): TestWorker => {
    if (worker === undefined) {
      throw new Error("The test Worker has not started.");
    }
    return worker;
  };

  return {
    get origin() {
      return startedWorker().origin;
    },
    async createTrial() {
      const { grantId, trialLink } = await startedWorker().createGrant("Native auth test");
      const credential = new URLSearchParams(new URL(trialLink).hash.slice(1)).get("credential");
      if (credential === null) {
        throw new Error("Missing trial credential");
      }
      return { grantId, credential };
    },
  };
}

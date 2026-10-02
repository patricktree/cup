import type { GrantRegistrySnapshot } from "#src/grant-model.ts";

export type GrantRegistry = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): {
    applyGrantRegistrySnapshot(
      snapshot: GrantRegistrySnapshot,
    ): Promise<"applied" | "replayed" | "stale">;
  };
};

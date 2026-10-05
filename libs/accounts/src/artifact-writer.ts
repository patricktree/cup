import type { AccountDurableObject } from "#src/account-durable-object.ts";

/** Every write is registered before R2 receives it; only acknowledged writes can drain. */
export function accountArtifactBucket(
  bucket: R2Bucket,
  account: DurableObjectStub<AccountDurableObject>,
  executionEpoch: number,
  prefix: string,
): R2Bucket {
  return new Proxy(bucket, {
    get(target, property, receiver) {
      if (property === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          let handedToR2 = false;
          try {
            const [key] = args;
            if (!key.startsWith(prefix))
              throw new Error("Artifact write is outside its account prefix");
            const digest = new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(executionEpoch + ":" + key),
              ),
            );
            const writerId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
              "",
            );
            const existing = await target.head(key);
            if (
              existing?.customMetadata?.["cup-writer-id"] === writerId &&
              (await account.reconcileArtifactWriter(writerId))
            ) {
              if (args[1] instanceof ReadableStream)
                await args[1].pipeTo(new WritableStream({ write() {} }));
              return existing;
            }
            await account.prepareArtifactWrite(writerId, executionEpoch, prefix, key);
            handedToR2 = true;
            const object = await target.put(args[0], args[1], {
              ...args[2],
              customMetadata: { ...args[2]?.customMetadata, "cup-writer-id": writerId },
            });
            await account.acknowledgeArtifactEffect(writerId);
            await account.drainArtifactWriter(writerId);
            return object;
          } catch (error) {
            if (!handedToR2 && args[1] instanceof ReadableStream)
              await args[1].cancel(error).catch(() => undefined);
            throw error;
          }
        };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

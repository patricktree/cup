import { useMutation } from "@tanstack/react-query";
import React from "react";

import { parseOkResponse } from "@cup/web-app-api.client";
import { deletionChallengeSchema } from "@cup/web-app-api.routes";

import {
  getAuthenticatedRpcClient,
  getFreshAccountSession,
  sessionSnapshot,
  signInGoogle,
  signOut,
} from "#src/auth/account-session.js";
import {
  readPendingAccountChallenge,
  storeAccountChallenge,
  clearAccountChallenge,
} from "#src/data-fetching/account-confirmation-storage.js";
import { invalidateAccountQueries } from "#src/data-fetching/account.js";

export function useAccountConfirmation(subject: string) {
  const [challenge, setChallenge] = React.useState(readPendingAccountChallenge);
  const change = useMutation({
    mutationFn: async (
      command: { type: "begin"; action: "delete" | "restore" } | { type: "confirm" },
    ) => {
      if (command.type === "begin") {
        const issued = deletionChallengeSchema.parse(
          await parseOkResponse(
            (await getAuthenticatedRpcClient(subject)).createDeletionChallenge(),
          ),
        );
        if (issued.subject !== subject || sessionSnapshot()?.user.id !== subject)
          throw new Error("Use the same Google account that requested confirmation.");
        const next = { ...issued, action: command.action };
        storeAccountChallenge(next);
        setChallenge(next);
        // Supabase AMR timestamps have whole-second precision; authenticate strictly after issuance.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1_100));
        if (sessionSnapshot()?.user.id !== subject) throw new Error("Use the same Google account.");
        await signInGoogle(true);
        return null;
      }

      const pending = readPendingAccountChallenge();
      if (!pending || pending.subject !== subject)
        throw new Error("Use the same Google account that requested confirmation.");
      const session = await getFreshAccountSession();
      if (session?.user.id !== subject) throw new Error("Use the same Google account.");
      const rpcClient = await getAuthenticatedRpcClient(subject);
      const input = {
        challengeId: pending.challengeId,
        ...(session.provider_token ? { providerToken: session.provider_token } : {}),
      };
      if (pending.action === "delete") await parseOkResponse(rpcClient.scheduleDeletion(input));
      else await parseOkResponse(rpcClient.restoreAccount(input));
      if (sessionSnapshot()?.user.id !== subject) return null;
      if (readPendingAccountChallenge()?.challengeId === pending.challengeId) {
        clearAccountChallenge();
        setChallenge(null);
      }
      await invalidateAccountQueries(subject);
      if (sessionSnapshot()?.user.id !== subject) return null;
      // signOut owns playback/media cleanup; the auth lifecycle clears account queries.
      if (pending.action === "delete") {
        await signOut();
        return null;
      }
      return "Your account is restored. Your existing minutes and conversions are available again.";
    },
  });
  return {
    challenge,
    isPending: change.isPending,
    error: change.error?.message,
    result: change.data,
    begin: (action: "delete" | "restore") => change.mutate({ type: "begin", action }),
    confirm: () => change.mutate({ type: "confirm" }),
    cancel: () => {
      if (change.isPending) return;
      clearAccountChallenge();
      setChallenge(null);
      change.reset();
    },
  };
}

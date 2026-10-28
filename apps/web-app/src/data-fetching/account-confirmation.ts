import { useIsMutating, useMutation } from "@tanstack/react-query";
import React from "react";

import { deletionChallengeSchema } from "@cup/listener-api.routes";

import {
  getFreshAccountSession,
  isSignedInAs,
  signInAgain,
  signOut,
} from "#src/auth/account-session.js";
import {
  readPendingAccountChallenge,
  storeAccountChallenge,
  clearAccountChallenge,
} from "#src/data-fetching/account-confirmation-storage.js";
import { invalidateAccountHistory } from "#src/data-fetching/account-history.js";
import { invalidateAccountQueries } from "#src/data-fetching/account.js";
import { requestApi } from "#src/data-fetching/api-request.js";
import { summarizeError, UserFacingError } from "#src/errors.js";

const ACCOUNT_CONFIRMATION_MUTATION_KEY = ["account-confirmation"];

export function useAccountConfirmation(subject: string) {
  const [challenge, setChallenge] = React.useState(readPendingAccountChallenge);
  const change = useMutation({
    mutationKey: ACCOUNT_CONFIRMATION_MUTATION_KEY,
    // The confirmation flow shows its failure next to the step the user is taking.
    meta: { errorDisplay: "inline" },
    mutationFn: async (
      command: { type: "begin"; action: "delete" | "restore" } | { type: "confirm" },
    ) => {
      if (command.type === "begin") {
        const issued = deletionChallengeSchema.parse(
          await requestApi({ subject }, (client) => client.createDeletionChallenge()),
        );
        if (issued.subject !== subject || !isSignedInAs(subject)) {
          throw new UserFacingError({
            title: "Use the same Google account that requested confirmation.",
          });
        }
        const next = { ...issued, action: command.action };
        storeAccountChallenge(next);
        setChallenge(next);
        // Supabase AMR timestamps have whole-second precision; authenticate strictly after issuance.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1_100));
        if (!isSignedInAs(subject)) {
          throw new UserFacingError({ title: "Use the same Google account." });
        }
        await signInAgain();
        return null;
      }

      const pending = readPendingAccountChallenge();
      if (!pending || pending.subject !== subject) {
        throw new UserFacingError({
          title: "Use the same Google account that requested confirmation.",
        });
      }
      // The Google provider token lives only on the session; requestApi below re-resolves its own
      // token and guard, so this check exists to name the account mismatch and narrow `session`.
      const session = await getFreshAccountSession();
      if (session?.user.id !== subject) {
        throw new UserFacingError({ title: "Use the same Google account." });
      }
      const input = {
        challengeId: pending.challengeId,
        ...(session.provider_token ? { providerToken: session.provider_token } : {}),
      };
      if (pending.action === "delete") {
        await requestApi({ subject }, (client) => client.scheduleDeletion(input));
      } else {
        await requestApi({ subject }, (client) => client.restoreAccount(input));
      }
      if (!isSignedInAs(subject)) {
        return null;
      }
      if (readPendingAccountChallenge()?.challengeId === pending.challengeId) {
        clearAccountChallenge();
        setChallenge(null);
      }
      await invalidateAccountQueries(subject);
      if (!isSignedInAs(subject)) {
        return null;
      }
      // signOut owns playback/media cleanup; the auth lifecycle clears account queries.
      if (pending.action === "delete") {
        await signOut();
        return null;
      }
      // Recents behind the account dialog failed to list the blocked account's history.
      await invalidateAccountHistory(subject);
      return "Your account is restored. Your existing minutes and conversions are available again.";
    },
  });
  return {
    challenge,
    isPending: change.isPending,
    error: change.error
      ? summarizeError(change.error, "The confirmation could not be completed.")
      : undefined,
    result: change.data,
    begin: (action: "delete" | "restore") => change.mutate({ type: "begin", action }),
    confirm: () => change.mutate({ type: "confirm" }),
    cancel: () => {
      if (change.isPending) {
        return;
      }
      clearAccountChallenge();
      setChallenge(null);
      change.reset();
    },
  };
}

/**
 * Whether a deletion or recovery step is running. Leaving the account dialog then would lose the
 * return from Google, which comes back to the dialog's URL.
 */
export function useIsAccountConfirmationPending(): boolean {
  return useIsMutating({ mutationKey: ACCOUNT_CONFIRMATION_MUTATION_KEY }) > 0;
}

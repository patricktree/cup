import { css } from "@linaria/core";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import { AccountQueryBoundary } from "#src/app/components/account-query-boundary.js";
import { AccountSettings } from "#src/app/components/account-settings.js";
import { Main } from "#src/app/components/main.tsx";
import { SignInButtons } from "#src/app/components/sign-in-dialog.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";
import { useAccountAuthState, useAccountSession, useSignInMethods } from "#src/auth/hooks.js";
import { useSignInMutation } from "#src/data-fetching/account.js";

/**
 * Restores an account whose deletion is scheduled; the scheduled-deletion email links here.
 * Scheduling deletion signs the listener out, so this page signs them in itself, outside the
 * account pages, which a signed-out listener cannot reach. Confirming signs in with Google again,
 * which returns here.
 */
export const Route = createFileRoute("/account-recovery")({
  component: AccountRecoveryPage,
});

function AccountRecoveryPage(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const signIn = useSignInMutation();
  const signInMethods = useSignInMethods();

  return (
    <Main
      {...interTypefaceScope}
      className={css`
        display: grid;
        gap: calc(2 * var(--spacing-base));
        align-content: center;
        max-width: var(--app-max-width);
        min-height: 100dvh;
        padding-block: var(--app-padding-block);
        padding-inline: var(--app-padding-inline);
        margin-inline: auto;
      `}
    >
      <h1
        className={composeClassnames(
          textStyles.h1,
          css`
            margin: 0;
          `,
        )}
      >
        Restore your account
      </h1>
      {authState.status === "loading" ? (
        <output>Loading account…</output>
      ) : authState.status === "error" ? (
        <p role="alert">{authState.error.message}</p>
      ) : session ? (
        <AccountQueryBoundary key={session.user.id}>
          <AccountSettings
            subject={session.user.id}
            email={session.user.email}
            purpose="recovery"
          />
        </AccountQueryBoundary>
      ) : (
        <section aria-label="Sign in">
          <p>Sign in with the account whose deletion is scheduled.</p>
          <SignInButtons
            signInMethods={signInMethods}
            pendingMethod={signIn.isPending ? signIn.variables : undefined}
            onSignIn={(method) => signIn.mutate(method)}
          />
          {signIn.error && <p role="alert">{signIn.error.message}</p>}
        </section>
      )}
    </Main>
  );
}

import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Navigate,
  redirect,
  useNavigate,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import React from "react";

import { ConversionEntryPage } from "#src/app/components/conversion-entry-page.js";
import { ErrorMessage } from "#src/app/components/error-message.js";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";
import { DSButton } from "#src/app/design-system/button.js";
import { getResourceAccountSession } from "#src/data-fetching/account-session.js";
import { useAccountSession } from "#src/data-fetching/account.js";
import {
  ApiError,
  createGrantQuery,
  createGrantQueryKey,
  exchangeCredential,
} from "#src/data-fetching/trial-link.js";
import { trialBrowserState } from "#src/trial-browser-state.js";

export const Route = createFileRoute("/trials/$grantId")({
  component: TrialPage,
  beforeLoad: async ({ context, location, params }) => {
    if (
      new URLSearchParams(location.searchStr).has("code") ||
      (await getResourceAccountSession())
    ) {
      return redirect({ to: "/", search: true, replace: true });
    }

    const access = readCredentialFromFragment(location.hash);

    if (access.kind === "malformed") {
      throw new TrialLinkMalformedError(
        "This trial link is invalid. Check that you opened the complete trial link.",
      );
    }

    if (access.kind === "credential") {
      const snapshot = await exchangeCredential(params.grantId, access.credential);
      context.queryClient.setQueryData(createGrantQueryKey(params.grantId), snapshot);
      trialBrowserState.setLastGrantId(params.grantId);
      return redirect({ to: ".", hash: "" });
    }

    if (access.kind === "session") {
      return Promise.resolve();
    }

    check.assertIsUnreachable(access);
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(createGrantQuery(params.grantId));
  },
  errorComponent: RouteErrorComponent,
});

function TrialPage(): React.JSX.Element {
  const session = useAccountSession();
  if (session) return <Navigate to="/" replace />;
  return <TrialConversionPage />;
}

function TrialConversionPage(): React.JSX.Element {
  const { grantId } = Route.useParams();
  const grantQuery = useSuspenseQuery(createGrantQuery(grantId));

  return (
    <ConversionEntryPage>
      <StartConversionForm mode="trial" grant={grantQuery.data} />
    </ConversionEntryPage>
  );
}

function RouteErrorComponent({ error }: ErrorComponentProps): React.JSX.Element {
  const navigate = useNavigate();

  if (error instanceof TrialLinkMalformedError) {
    return (
      <ErrorMessage title="This trial link is invalid.">
        Check that you opened the complete trial link.
      </ErrorMessage>
    );
  }

  if (error instanceof ApiError && error.status < 500 && error.code === "grant-revoked") {
    return (
      <ErrorMessage title="This trial link was revoked.">
        Check that you opened the complete trial link.
      </ErrorMessage>
    );
  }

  if (error instanceof ApiError && error.status < 500) {
    return (
      <ErrorMessage title="This trial link is invalid.">
        Check that you opened the complete trial link.
      </ErrorMessage>
    );
  }

  if (
    error instanceof ApiError &&
    (error.code === "grant-session-required" || error.code === "grant-session-invalid")
  ) {
    return (
      <ErrorMessage title="This browser no longer has access.">
        Open the original trial link again.
      </ErrorMessage>
    );
  }

  return (
    <ErrorMessage title="The trial link could not be opened.">
      <DSButton
        type="button"
        variant="contained"
        onClick={() => navigate({ to: ".", reloadDocument: true })}
      >
        Try again
      </DSButton>
    </ErrorMessage>
  );
}

class TrialLinkMalformedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrialLinkInvalidError";
  }
}

type InitialAccess =
  | { kind: "session" }
  | { kind: "credential"; credential: string }
  | { kind: "malformed" };

function readCredentialFromFragment(hash: string): InitialAccess {
  if (hash === "") {
    return { kind: "session" };
  }

  const params = new URLSearchParams(hash);
  const credentials = params.getAll("credential");
  if (
    credentials.length !== 1 ||
    [...params.keys()].some((key) => key !== "credential") ||
    !/^v1\.[A-Za-z0-9_-]{43}$/.test(credentials[0] ?? "")
  ) {
    return { kind: "malformed" };
  }

  return { kind: "credential", credential: credentials[0]! };
}

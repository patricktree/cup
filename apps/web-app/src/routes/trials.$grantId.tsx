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

import { ConversionShell } from "#src/app/components/conversion-shell.jsx";
import { ErrorScreen } from "#src/app/components/error-message.js";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";
import { getResourceAccountSession } from "#src/auth/account-session.js";
import { useAccountSession } from "#src/auth/hooks.js";
import { ERROR_CODE, type RpcError } from "#src/data-fetching/api-request.js";
import { createGrantQuery, exchangeCredential } from "#src/data-fetching/conversion-grant.js";
import { UserFacingError, type ErrorCopy } from "#src/errors.js";
import { trialBrowserState } from "#src/trial-browser-state.js";

const CHECK_COMPLETE_TRIAL_LINK = "Check that you opened the complete trial link.";
const TRIAL_LINK_INVALID = {
  title: "This trial link is invalid.",
  detail: CHECK_COMPLETE_TRIAL_LINK,
};
const TRIAL_LINK_REVOKED = {
  title: "This trial link was revoked.",
  detail: CHECK_COMPLETE_TRIAL_LINK,
};
const TRIAL_SESSION_LOST = {
  title: "This browser no longer has access.",
  detail: "Open the original trial link again.",
};

export const Route = createFileRoute("/trials/$grantId")({
  component: TrialPage,
  beforeLoad: async ({ location, params }) => {
    if (
      new URLSearchParams(location.searchStr).has("code") ||
      (await getResourceAccountSession())
    ) {
      throw redirect({ to: "/", search: true, replace: true });
    }

    const access = readCredentialFromFragment(location.hash);

    if (access.kind === "malformed") {
      throw new UserFacingError(TRIAL_LINK_INVALID);
    }

    if (access.kind === "credential") {
      await exchangeCredential(params.grantId, access.credential);
      trialBrowserState.setLastGrantId(params.grantId);
      throw redirect({ to: ".", hash: "" });
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
  return session ? <Navigate to="/" replace /> : <TrialConversionPage />;
}

function TrialConversionPage(): React.JSX.Element {
  const { grantId } = Route.useParams();
  const grantQuery = useSuspenseQuery(createGrantQuery(grantId));

  return (
    <ConversionShell>
      <StartConversionForm mode="trial" grant={grantQuery.data} />
    </ConversionShell>
  );
}

/** Opening a trial link words its refusals in terms of the link rather than the grant. */
function describeTrialLinkRefusal(error: RpcError): ErrorCopy {
  if (
    error.code === ERROR_CODE.GRANT_SESSION_REQUIRED ||
    error.code === ERROR_CODE.GRANT_SESSION_INVALID
  ) {
    return TRIAL_SESSION_LOST;
  }
  if (error.code === ERROR_CODE.GRANT_REVOKED) {
    return TRIAL_LINK_REVOKED;
  }
  return TRIAL_LINK_INVALID;
}

function RouteErrorComponent({ error }: ErrorComponentProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <ErrorScreen
      error={error}
      fallbackTitle="The trial link could not be opened."
      describeApiRefusal={describeTrialLinkRefusal}
      onRetry={() => navigate({ to: ".", reloadDocument: true })}
    />
  );
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

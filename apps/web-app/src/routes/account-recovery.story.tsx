import { delay, http } from "msw";

import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";

/** The account snapshot never answers, so the page keeps loading the account. */
export const LoadingAccount = accountStory({
  path: "/account-recovery",
  handlers: [http.get("/api/account", () => delay("infinite"))],
});

export const SignedOut = accountStory({ path: "/account-recovery", isSignedOut: true });
export const DeletionScheduled = accountStory({
  path: "/account-recovery",
  state: "deletion_scheduled",
});
export const ConfirmRecovery = accountStory({
  path: "/account-recovery",
  state: "deletion_scheduled",
  confirmation: "restore",
});
export const ActiveAccount = accountStory({ path: "/account-recovery" });
/** A deletion begun in the account dialog and abandoned before Google confirmed it. */
export const LeftoverDeletionChallenge = accountStory({
  path: "/account-recovery",
  state: "deletion_scheduled",
  confirmation: "delete",
});

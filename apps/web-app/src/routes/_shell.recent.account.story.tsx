import { delay, http } from "msw";

import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";

export const ActiveAccount = accountStory({ path: "/recent/account" });
export const SetupPending = accountStory({ path: "/recent/account", setupFailure: true });
export const ConfirmDeletion = accountStory({ path: "/recent/account", confirmation: "delete" });
export const RecoveryAvailable = accountStory({
  path: "/recent/account",
  state: "deletion_scheduled",
});
export const ConfirmRecovery = accountStory({
  path: "/recent/account",
  state: "deletion_scheduled",
  confirmation: "restore",
});
export const FinalDeletion = accountStory({ path: "/recent/account", state: "deleting" });

export const SetupRecovers = accountStory({ path: "/recent/account", setupFailure: "once" });
export const ConfirmDeletionPending = accountStory({
  path: "/recent/account",
  confirmation: "delete",
  handlers: [http.post("/api/account/deletion", () => delay("infinite"))],
});

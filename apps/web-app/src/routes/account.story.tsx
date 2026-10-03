import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";

export const ActiveAccount = accountStory({ path: "/account" });
export const SetupPending = accountStory({ path: "/account", setupFailure: true });
export const ConfirmDeletion = accountStory({ path: "/account", confirmation: "delete" });
export const RecoveryAvailable = accountStory({ path: "/account", state: "deletion_scheduled" });
export const ConfirmRecovery = accountStory({
  path: "/account",
  state: "deletion_scheduled",
  confirmation: "restore",
});
export const FinalDeletion = accountStory({ path: "/account", state: "deleting" });

export const SetupRecovers = accountStory({ path: "/account", setupFailure: "once" });

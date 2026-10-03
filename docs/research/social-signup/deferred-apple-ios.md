# Future task: Apple sign-in and the iOS app

> Deferred planning, incorporated 2026-10-02. This handoff is not an accepted launch commitment or evidence of implementation. Revalidate its provider requirements when work resumes. See [current authentication](../../architecture/authentication.md).

Deferred by Patrick on 2026-09-22. This is a handoff for a separate future effort, not an open dependency of the [current map](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/map.md). The current feature targets Google sign-in on Android and web only. No existing iOS code or infrastructure is removed by this planning change.

## Future scope

- Add Apple sign-in on supported platforms, including native Apple authentication on iOS.
- Bring the iOS app into the account feature, including Google sign-in, callbacks, secure session storage, refresh/logout and private playback/downloads.
- Revisit adding another provider to an existing account and Google/Apple linking without merging already-created accounts.
- Configure Apple Developer identifiers, capabilities, signing, services and credentials. Patrick has a membership; access was unavailable during the current effort.
- Prove Apple authorization-code exchange, secure custody of revocable credentials, revocation on account deletion and web/native differences.
- Register the email sender with Apple private relay and verify Hide My Email delivery, including the deletion/revocation sequence.
- Extend acceptance coverage to iOS authentication/media and Apple provider lifecycle behavior before shipping that scope.

## Existing context

Preserve the [native provider research](native-social-sso-research.md), [deletion research](account-deletion-research.md), [provider setup history](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/issues/15-native-auth-setup.md), [auth proof](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/issues/08-native-auth-proof.md) and [email setup history](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/issues/19-email-setup.md). Their Apple/iOS findings remain useful research, but their older launch requirements do not apply to the current Google-only effort. Revalidate provider and platform requirements when starting this task.

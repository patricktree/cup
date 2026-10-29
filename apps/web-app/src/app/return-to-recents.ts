import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";

/**
 * Whether a link on Recents pushed the current history entry (the `isOpenedFromRecents` history
 * state), so Recents is the entry below it.
 */
export function useIsOpenedFromRecents(): boolean {
  return useLocation({
    select: (location) => location.state.isOpenedFromRecents === true,
  });
}

/**
 * Leaves the current screen for Recents. Opened from Recents, it goes back one history entry, so
 * Recents returns at its scroll position; a share, a direct link or the return from a Google
 * sign-in has no Recents entry below it to return to, so it replaces the entry with `/recent`. The
 * returned promise settles once the router has rendered Recents.
 */
export function useReturnToRecents(): () => Promise<void> {
  const router = useRouter();
  const navigate = useNavigate();
  const isOpenedFromRecents = useIsOpenedFromRecents();

  return async () => {
    if (!isOpenedFromRecents) {
      await navigate({ to: "/recent", replace: true });
      return;
    }

    const rendered = new Promise<void>((resolve) => {
      const unsubscribe = router.subscribe("onRendered", () => {
        unsubscribe();
        resolve();
      });
    });
    router.history.back();
    await rendered;
  };
}

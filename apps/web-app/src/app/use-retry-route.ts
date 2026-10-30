import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

/**
 * Tries a route's `errorComponent` again: lets the suspense queries that failed fetch again and
 * reruns the route's `beforeLoad` and loader. Invalidating also resets the error boundary.
 */
export function useRetryRoute(): () => void {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  return () => {
    queryErrorResetBoundary.reset();
    void router.invalidate();
  };
}

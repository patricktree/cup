let pendingUrl: string | undefined;
let formListener: ((url: string) => void) | undefined;

export function receiveSharedUrl(url: string, onShare: () => void | Promise<void>): void {
  pendingUrl = url;
  void Promise.resolve(onShare()).then(deliverPendingUrl);
}

export function subscribeToSharedUrl(listener: (url: string) => void): () => void {
  formListener = listener;
  deliverPendingUrl();
  return () => {
    // A form that mounts before the previous one unmounts has already replaced the listener.
    if (formListener === listener) {
      formListener = undefined;
    }
  };
}

/** Whether a shared URL still waits for a form to take it. */
export function hasPendingSharedUrl(): boolean {
  return pendingUrl !== undefined;
}

function deliverPendingUrl(): void {
  if (formListener === undefined || pendingUrl === undefined) {
    return;
  }
  const url = pendingUrl;
  pendingUrl = undefined;
  formListener(url);
}

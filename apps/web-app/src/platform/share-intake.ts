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
    formListener = undefined;
  };
}

function deliverPendingUrl(): void {
  if (formListener === undefined || pendingUrl === undefined) {
    return;
  }
  const url = pendingUrl;
  pendingUrl = undefined;
  formListener(url);
}

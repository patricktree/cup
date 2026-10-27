/** What the system's media controls show for the loaded audiobook. */
export type MediaMetadataInput = { title: string; artworkUrl: string | undefined };

/**
 * Shows the loaded audiobook in the system's media controls and returns a function that clears it.
 *
 * It sets only the metadata: with no action handlers and no position state, the browser's defaults
 * drive the lock screen and notification controls from the `<audio>` element itself (ADR 0011).
 */
export function publishMediaMetadata({ title, artworkUrl }: MediaMetadataInput): () => void {
  if (!("mediaSession" in navigator)) {
    return () => undefined;
  }

  const { mediaSession } = navigator;
  mediaSession.metadata = new MediaMetadata({
    title,
    artwork: artworkUrl === undefined ? [] : [{ src: artworkUrl }],
  });

  return () => {
    mediaSession.metadata = null;
  };
}

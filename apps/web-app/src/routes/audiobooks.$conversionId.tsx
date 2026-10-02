import { css } from "@linaria/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { DSButton } from "#src/app/design-system/button.js";
import {
  refreshPlaybackAuthorization,
  getFreshAccountSession,
  getResourceAccountSession,
  stopPlayback,
} from "#src/data-fetching/account-session.js";
import { useAccountSession } from "#src/data-fetching/account.js";
import { ApiError, createAudiobookQuery } from "#src/data-fetching/trial-link.js";

export const Route = createFileRoute("/audiobooks/$conversionId")({
  component: AudiobookPage,
  loader: async ({ context, params }) => {
    await refreshPlaybackAuthorization(await getResourceAccountSession());
    await context.queryClient.ensureQueryData(createAudiobookQuery(params.conversionId));
  },
  errorComponent: RouteErrorComponent,
});

function AudiobookPage(): React.JSX.Element {
  const session = useAccountSession();
  const { conversionId } = Route.useParams();
  const { data: audiobook } = useSuspenseQuery(createAudiobookQuery(conversionId));

  return (
    <>
      <h1>{audiobook.title}</h1>
      <p>
        <a href={audiobook.originalUrl}>Open original source</a>
      </p>

      <p>
        <a download="audiobook.mp3" href={audiobook.audio.url}>
          Download MP3
        </a>
      </p>

      <p>
        <a download="audiobook.epub" href={audiobook.epub.url}>
          Download EPUB
        </a>
      </p>

      <audio
        className={css`
          inline-size: 100%;
        `}
        aria-label={`Play ${audiobook.title}`}
        controls
        onError={() => {
          stopPlayback();
          void getFreshAccountSession().then(refreshPlaybackAuthorization).catch(stopPlayback);
        }}
        crossOrigin={session ? "use-credentials" : "anonymous"}
        preload="metadata"
      >
        <source src={audiobook.audio.url} type={audiobook.audio.contentType} />
        <track default kind="captions" label="Narration" src={audiobook.captions.url} />
      </audio>
    </>
  );
}

function RouteErrorComponent({ error }: ErrorComponentProps): React.JSX.Element {
  const navigate = useNavigate();

  if (error instanceof ApiError && error.code === "audiobook-not-found") {
    return (
      <div>
        <h1>Audiobook not found.</h1>
      </div>
    );
  }

  return (
    <ErrorMessage title="The audiobook could not be loaded.">
      <DSButton
        type="button"
        variant="contained"
        onClick={() => navigate({ to: ".", reloadDocument: true })}
      >
        Try again
      </DSButton>
    </ErrorMessage>
  );
}

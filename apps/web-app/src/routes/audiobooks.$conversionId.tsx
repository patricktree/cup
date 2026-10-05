import { Capacitor } from "@capacitor/core";
import { css } from "@linaria/core";
import {
  useSuspenseQuery,
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { QueryBoundary } from "#src/app/components/query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import { ProgressivePlayer, type PreparedAudiobook } from "#src/app/player/progressive-player.js";
import {
  refreshPlaybackAuthorization,
  getResourceAccountSession,
} from "#src/data-fetching/account-session.js";
import { useAccountSession } from "#src/data-fetching/account.js";
import { getLocalPlaybackPosition, useRetryPreparation } from "#src/data-fetching/reader.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import { NativePlayer } from "#src/platform/native-player.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";

export const Route = createFileRoute("/audiobooks/$conversionId")({ component: AudiobookBoundary });

function AudiobookBoundary() {
  return (
    <QueryBoundary pending={<ReaderSkeleton />} errorComponent={ReaderQueryError}>
      <AudiobookPage />
    </QueryBoundary>
  );
}

function ReaderQueryError({ reset }: ErrorComponentProps) {
  const queryBoundary = useQueryErrorResetBoundary();
  return (
    <ErrorMessage title="The article could not be loaded.">
      <DSButton
        onClick={() => {
          queryBoundary.reset();
          reset();
        }}
      >
        Try again
      </DSButton>
    </ErrorMessage>
  );
}
function AudiobookPage(): React.JSX.Element {
  const { conversionId } = Route.useParams();
  const session = useAccountSession();
  const query = useSuspenseQuery(createAudiobookQuery(conversionId));
  const retry = useRetryPreparation(conversionId, useQueryClient());

  if (query.isError)
    return (
      <ErrorMessage title="The article could not be loaded.">
        <DSButton onClick={() => query.refetch()}>Try again</DSButton>
      </ErrorMessage>
    );
  if (!query.data || query.data.status === "pending") return <ReaderSkeleton />;
  if (query.data.status === "failed")
    return (
      <ErrorMessage title="The article could not be prepared.">
        <p>{retry.error?.message ?? query.data.explanation}</p>
        <DSButton
          disabled={retry.isPending || !query.data.canGenerate}
          onClick={() => retry.mutate()}
        >
          Retry
        </DSButton>
      </ErrorMessage>
    );
  return (
    <PreparedReader
      key={`${conversionId}:${session?.user.id ?? "anonymous"}`}
      conversionId={conversionId}
      audiobook={query.data}
    />
  );
}

function PreparedReader({
  conversionId,
  audiobook,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
}) {
  const session = useAccountSession();
  const [player] = React.useState(() =>
    Capacitor.isNativePlatform()
      ? new NativePlayer(
          conversionId,
          audiobook,
          session ? audiobook.playbackPosition : getLocalPlaybackPosition(conversionId),
          Boolean(session),
        )
      : ProgressivePlayer.forConversion(
          conversionId,
          audiobook,
          session ? audiobook.playbackPosition : getLocalPlaybackPosition(conversionId),
          session?.user.id ?? null,
        ),
  );
  const state = React.useSyncExternalStore(player.subscribe, player.getSnapshot);
  React.useEffect(
    function listenForSessionStop() {
      window.addEventListener(STOP_PLAYBACK_EVENT_NAME, player.pause);
      return () => window.removeEventListener(STOP_PLAYBACK_EVENT_NAME, player.pause);
    },
    [player],
  );
  const audioElement = React.useRef<HTMLAudioElement>(null);
  React.useEffect(
    function attachAudio() {
      player.attach(audioElement.current);
      return () => {
        player.pause();
        player.attach(null);
      };
    },
    [player],
  );
  const documentElement = React.useRef<HTMLElement>(null);
  const [authorizationError, setAuthorizationError] = React.useState<string | null>(null);
  const units = audiobook.narrationDocument.synchronizationUnits;

  React.useEffect(
    function highlightCurrentPassage() {
      const document = documentElement.current;
      if (!document) return;
      for (const previous of document.querySelectorAll('[aria-current="true"]'))
        previous.removeAttribute("aria-current");
      document
        .querySelector(`[id="${units[state.sequence]!.id}"]`)
        ?.setAttribute("aria-current", "true");
    },
    [state.sequence, units],
  );

  React.useEffect(function authorizeInitialMedia() {
    void refreshPlaybackAuthorization().catch((error: unknown) =>
      setAuthorizationError(
        error instanceof Error ? error.message : "Playback authorization failed.",
      ),
    );
  }, []);
  React.useEffect(
    function registerMediaSession() {
      if (Capacitor.isNativePlatform() || !navigator.mediaSession) return undefined;
      navigator.mediaSession.metadata = new MediaMetadata({ title: audiobook.title });
      navigator.mediaSession.setActionHandler("play", player.play);
      navigator.mediaSession.setActionHandler("pause", player.pause);
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        player.seek(player.getSnapshot().sequence + 1),
      );
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        player.seek(player.getSnapshot().sequence - 1),
      );
      return () => {
        for (const action of ["play", "pause", "nexttrack", "previoustrack"] as const)
          navigator.mediaSession.setActionHandler(action, null);
        player.pause();
      };
    },
    [player, audiobook.title],
  );

  async function play() {
    try {
      await refreshPlaybackAuthorization(await getResourceAccountSession());
      setAuthorizationError(null);
      player.play();
    } catch (error) {
      setAuthorizationError(
        error instanceof Error ? error.message : "Playback authorization could not be refreshed.",
      );
    }
  }

  return (
    <>
      <p>
        <a href={audiobook.originalUrl}>Open original source</a>
      </p>
      <div className={controlsClass}>
        <DSButton onClick={() => (state.isPlaying ? player.pause() : void play())}>
          {state.isPlaying ? "Pause" : "Play"}
        </DSButton>
        <label>
          Start at passage{" "}
          <select
            value={state.sequence}
            onChange={(event) => player.seek(Number(event.target.value))}
          >
            {units.map((unit, sequence) => (
              <option key={unit.id} value={sequence}>
                {sequence + 1}. {unit.narrationText.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
        <output>
          {state.isBuffering
            ? "Preparing audio…"
            : `Passage ${state.sequence + 1} of ${units.length}`}
        </output>
      </div>
      {state.error || authorizationError ? (
        <div role="alert">
          <p>{state.error ?? authorizationError}</p>
          <DSButton
            onClick={() => {
              setAuthorizationError(null);
              player.retry();
            }}
          >
            Retry passage
          </DSButton>
        </div>
      ) : null}
      <audio
        ref={audioElement}
        preload="auto"
        crossOrigin={session ? "use-credentials" : "anonymous"}
        onPause={() => {
          if (player instanceof ProgressivePlayer) player.onPause();
        }}
        onEnded={() => {
          if (player instanceof ProgressivePlayer) player.onEnded();
        }}
        onTimeUpdate={() => {
          if (player instanceof ProgressivePlayer) player.onTimeUpdate();
        }}
        onError={() => {
          if (player instanceof ProgressivePlayer) player.onMediaError();
        }}
        aria-label={`Narration of ${audiobook.title}`}
      >
        <track
          kind="captions"
          srcLang="und"
          label="Narration"
          src={captionSource(
            units[state.sequence]!.narrationText,
            state.durationMilliseconds ??
              Math.max(1000, units[state.sequence]!.narrationText.length * 80),
          )}
        />
      </audio>
      <article
        ref={documentElement}
        className={documentClass}
        dangerouslySetInnerHTML={{ __html: audiobook.narrationDocument.html }}
      />
    </>
  );
}

function captionSource(text: string, durationMilliseconds: number) {
  const end = new Date(Math.ceil(durationMilliseconds)).toISOString().slice(11, 23);
  return (
    "data:text/vtt;charset=utf-8," +
    encodeURIComponent(
      `WEBVTT\n\n00:00:00.000 --> ${end}\n${text.replaceAll("-->", "→").replaceAll(/\s+/g, " ")}\n`,
    )
  );
}

function ReaderSkeleton() {
  return (
    <section aria-busy="true" aria-label="Preparing article">
      <output>Preparing article…</output>
      <div aria-hidden="true" className={skeletonClass}>
        <div />
        <p />
        <p />
        <p />
        <p />
      </div>
      <DSButton disabled>Play</DSButton>
    </section>
  );
}
const controlsClass = css`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  padding: 16px 0;
  background: var(--color-bg);
  select {
    max-width: min(70vw, 420px);
  }
`;
const documentClass = css`
  max-width: 70ch;
  line-height: 1.7;
  [id] {
    scroll-margin-top: 100px;
  }
  [aria-current="true"] {
    outline: 2px solid currentcolor;
    outline-offset: 4px;
    background: hsl(var(--color-black-hsl) / 8%);
  }
`;
const skeletonClass = css`
  max-width: 70ch;
  div,
  p {
    background: hsl(var(--color-black-hsl) / 12%);
    border-radius: 6px;
  }
  div {
    width: 65%;
    height: 40px;
    margin-bottom: 32px;
  }
  p {
    height: 96px;
    margin-bottom: 24px;
  }
`;

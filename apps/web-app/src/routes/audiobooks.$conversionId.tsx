import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import {
  useSuspenseQuery,
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, Pause, Play } from "lucide-react";
import React from "react";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { QueryBoundary } from "#src/app/components/query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import type { PreparedAudiobook } from "#src/app/player/progressive-player.js";
import { composeClassnames } from "#src/app/utils.ts";
import {
  refreshPlaybackAuthorization,
  getResourceAccountSession,
} from "#src/auth/account-session.js";
import { useAccountSession } from "#src/auth/hooks.js";
import { getLocalPlaybackPosition, useRetryPreparation } from "#src/data-fetching/reader.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import { createPlayer, registerPlayerMediaSession } from "#src/platform/player.js";
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

  if (query.isError) {
    return (
      <ErrorMessage title="The article could not be loaded.">
        <DSButton onClick={() => query.refetch()}>Try again</DSButton>
      </ErrorMessage>
    );
  }

  if (query.data.status === "pending") {
    return <ReaderSkeleton />;
  }

  if (query.data.status === "failed") {
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
  }

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
    createPlayer(
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
  const narrationDocumentElementRef = React.useRef<HTMLDivElement>(null);
  const [authorizationError, setAuthorizationError] = React.useState<string | null>(null);
  const units = audiobook.narrationDocument.synchronizationUnits;

  React.useEffect(
    function highlightCurrentSegment() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      for (const previous of narrationDocumentElement.querySelectorAll('[aria-current="true"]')) {
        previous.removeAttribute("aria-current");
      }

      narrationDocumentElement
        .querySelector(`[id="${units[state.currentUnitIndex]!.id}"]`)
        ?.setAttribute("aria-current", "true");
    },
    [state.currentUnitIndex, units],
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
      return registerPlayerMediaSession(player, audiobook.title);
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

  const playFromSegment = React.useEffectEvent((unitIndex: number) => {
    player.seek(unitIndex);
    void play();
  });

  React.useEffect(
    function addSegmentPlaybackButtons() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const buttons = units.map((unit, unitIndex) => {
        const segment = narrationDocumentElement.querySelector(`[id="${unit.id}"]`);
        check.assert(segment);

        const button = document.createElement("button");
        button.type = "button";
        button.dataset["segmentControl"] = "";
        button.setAttribute("aria-label", `Play segment ${unitIndex + 1}`);
        button.addEventListener("click", () => playFromSegment(unitIndex));
        segment.append(button);
        return button;
      });

      return () => {
        for (const button of buttons) button.remove();
      };
    },
    [units],
  );

  return (
    <>
      <div
        className={css`
          display: inline-flex;
          gap: var(--spacing-base);
          align-items: center;
          margin-block-end: calc(1*var(--spacing-base));

          font-size: var(--font-size-display);
        `}
      >
        <Link to="/" aria-label="Back to home">
          <ArrowLeft size="1em" />
        </Link>
      </div>

      <div
        ref={narrationDocumentElementRef}
        className={composeClassnames(
          css`
            & > article {
              padding-block-end: var(--player-controls-height);
            }

            & > article > * {
              margin-block-end: calc(2 * var(--spacing-base));
            }

            [id]:has(> [data-segment-control]) {
              /* "anchor" for the absolutely-positioned play-segment buttons */
              position: relative;
            }

            [data-segment-control] {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
              padding: 0;
              cursor: pointer;
              background: transparent;
              border: 0;
              border-radius: 0;
            }

            [aria-current="true"] {
              font-weight: var(--font-weight-inter-figma-medium);
            }
          `,
        )}
        dangerouslySetInnerHTML={{ __html: audiobook.narrationDocument.html }}
      />

      <div
        className={css`
          position: fixed;
          right: 0;
          bottom: 0;
          left: 0;

          display: flex;
          flex-direction: column;
          gap: calc(3*var(--spacing-base));
          height: var(--player-controls-height);
          padding-block: calc(4*var(--spacing-base));
          padding-inline: var(--app-padding-inline);

          background-color: var(--color-bg);
        `}
      >
        <hr
          className={css`
            border: 0;
            border-top: 1.5px solid var(--color-fg-emphasized-xs);
          `}
        />
        <div
          className={css`
            display: flex;
            justify-content: center;
          `}
        >
          <DSButton
            variant="text"
            aria-label={state.isPlaying ? "Pause" : "Play"}
            onClick={() => (state.isPlaying ? player.pause() : void play())}
          >
            {state.isPlaying ? <Pause size={48} /> : <Play size={48} />}
          </DSButton>
        </div>
      </div>

      {state.error || authorizationError ? (
        /* TODO: implement some general error handling like toasts/snackbars and put it there */
        <div
          role="alert"
          className={css`
            padding-block-end: var(--player-controls-height);
          `}
        >
          <p>{state.error ?? authorizationError}</p>
          <DSButton
            onClick={() => {
              setAuthorizationError(null);
              player.retry();
            }}
          >
            Retry segment
          </DSButton>
        </div>
      ) : null}

      <audio
        ref={audioElement}
        preload="auto"
        crossOrigin="use-credentials"
        onPause={player.onPause}
        onEnded={player.onEnded}
        onTimeUpdate={player.onTimeUpdate}
        onError={player.onMediaError}
        aria-label={`Narration of ${audiobook.title}`}
      >
        <track
          kind="captions"
          srcLang="und"
          label="Narration"
          src={captionSource(
            units[state.currentUnitIndex]!.narrationText,
            state.durationMilliseconds ??
              Math.max(1000, units[state.currentUnitIndex]!.narrationText.length * 80),
          )}
        />
      </audio>
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
      <div
        aria-hidden="true"
        className={css`
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
        `}
      >
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

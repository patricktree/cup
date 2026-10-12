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
import type { PlayableAudiobook, PreparedAudiobook } from "#src/app/player/audiobook-player.js";
import { composeClassnames } from "#src/app/utils.ts";
import { refreshPlaybackAuthorization } from "#src/auth/account-session.js";
import { useAccountSession } from "#src/auth/hooks.js";
import { getLocalPlaybackPosition, useRetryConversion } from "#src/data-fetching/reader.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import { createPlayer, registerPlayerMediaSession, type Player } from "#src/platform/player.js";
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
  const retry = useRetryConversion(conversionId, useQueryClient());

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

/** Shows the narration document; playback starts once every segment has audio or a final failure. */
function PreparedReader({
  conversionId,
  audiobook,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
}) {
  const retry = useRetryConversion(conversionId, useQueryClient());
  const [shouldPlayWithoutFailedSegments, setShouldPlayWithoutFailedSegments] =
    React.useState(false);
  const failedUnitIndexes = React.useMemo(
    () =>
      audiobook.segments
        .filter((segment) => segment.status === "failed")
        .map((segment) => segment.sequence),
    [audiobook.segments],
  );
  const retryButton = (
    <DSButton disabled={retry.isPending || !audiobook.canGenerate} onClick={() => retry.mutate()}>
      Retry
    </DSButton>
  );
  // A refused retry of failed segments changes nothing in the audiobook, so it is reported here.
  const retryOutcomeNotice = retry.error ? (
    <ReaderNotice>
      <p>{retry.error.message}</p>
    </ReaderNotice>
  ) : retry.data?.result === "insufficient-duration" && audiobook.status === "ready" ? (
    <ReaderNotice>
      <p>
        Not enough audio duration to retry. The missing audio needs about{" "}
        {formatDuration(retry.data.requiredMilliseconds)}, and{" "}
        {formatDuration(retry.data.availableMilliseconds)} is available.
      </p>
    </ReaderNotice>
  ) : null;

  const hasAudio = audiobook.segments.some((segment) => segment.status === "ready");

  if (
    audiobook.status === "ready" &&
    hasAudio &&
    (failedUnitIndexes.length === 0 || shouldPlayWithoutFailedSegments)
  ) {
    return (
      <PlayableReader
        conversionId={conversionId}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        notice={
          failedUnitIndexes.length === 0 ? null : (
            <>
              {retryOutcomeNotice}
              <ReaderNotice>
                <p>
                  {formatSegmentCount(failedUnitIndexes.length)} without audio{" "}
                  {failedUnitIndexes.length === 1 ? "is" : "are"} skipped during playback.
                </p>
                {retryButton}
              </ReaderNotice>
            </>
          )
        }
      />
    );
  }

  return (
    <>
      <BackLink />

      {retryOutcomeNotice}

      {audiobook.status === "insufficient-duration" ? (
        <ReaderNotice>
          {audiobook.availableMilliseconds >= audiobook.requiredMilliseconds ? (
            // Duration was freed since generation was refused; nothing starts until Retry.
            <p>Audio has not been generated for this article yet.</p>
          ) : (
            <p>
              Not enough audio duration for this article. It needs about{" "}
              {formatDuration(audiobook.requiredMilliseconds)}, and{" "}
              {formatDuration(audiobook.availableMilliseconds)} is available.
            </p>
          )}
          {retryButton}
        </ReaderNotice>
      ) : null}

      {audiobook.status === "ready" ? (
        <ReaderNotice>
          <p>
            {hasAudio
              ? `Audio could not be generated for ${formatSegmentCount(failedUnitIndexes.length)}, marked in the text.`
              : "Audio could not be generated for this article."}
          </p>
          {retryButton}
          {hasAudio ? (
            <DSButton onClick={() => setShouldPlayWithoutFailedSegments(true)}>
              Play without {failedUnitIndexes.length === 1 ? "it" : "them"}
            </DSButton>
          ) : null}
        </ReaderNotice>
      ) : null}

      <NarrationDocument audiobook={audiobook} failedUnitIndexes={failedUnitIndexes} />

      <PlayerControlsBar>
        {audiobook.status === "synthesizing" ? (
          <output>
            Generating audio…{" "}
            {audiobook.segments.filter((segment) => segment.status === "ready").length} of{" "}
            {formatSegmentCount(audiobook.segments.length)} ready
          </output>
        ) : null}
        <div className={playButtonRowClassName}>
          <DSButton variant="text" aria-label="Play" disabled>
            <Play size={48} />
          </DSButton>
        </div>
      </PlayerControlsBar>
    </>
  );
}

function PlayableReader({
  conversionId,
  audiobook,
  failedUnitIndexes,
  notice,
}: {
  conversionId: string;
  audiobook: PlayableAudiobook;
  failedUnitIndexes: readonly number[];
  notice: React.ReactNode;
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
  React.useEffect(
    function openPlayer() {
      player.open();
      return () => {
        player.pause();
        player.close();
      };
    },
    [player],
  );
  const [authorizationError, setAuthorizationError] = React.useState<string | null>(null);

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

  function play() {
    // Start within the user gesture; browsers refuse audio that starts after awaiting.
    player.play();
    void refreshPlaybackAuthorization()
      .then(() => setAuthorizationError(null))
      .catch((error: unknown) => {
        player.pause();
        setAuthorizationError(
          error instanceof Error ? error.message : "Playback authorization could not be refreshed.",
        );
      });
  }

  return (
    <>
      <BackLink />

      {notice}

      <NarrationDocument
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        currentUnitIndex={state.currentUnitIndex}
        onSelectUnit={(unitIndex) => {
          player.seekToUnit(unitIndex);
          play();
        }}
      />

      <PlayerControlsBar>
        <PlaybackProgress player={player} title={audiobook.title} />
        <div className={playButtonRowClassName}>
          <DSButton
            variant="text"
            aria-label={state.isPlaying ? "Pause" : "Play"}
            onClick={() => (state.isPlaying ? player.pause() : play())}
          >
            {state.isPlaying ? <Pause size={48} /> : <Play size={48} />}
          </DSButton>
        </div>
      </PlayerControlsBar>

      {state.error || authorizationError ? (
        /* TODO: implement some general error handling like toasts/snackbars and put it there */
        <div
          role="alert"
          className={css`
            padding-block-end: var(--player-controls-height);
          `}
        >
          <p>{state.error ?? authorizationError}</p>
        </div>
      ) : null}
    </>
  );
}

/** Position and length on the whole-audiobook timeline, with seeking. */
function PlaybackProgress({ player, title }: { player: Player; title: string }) {
  const { positionMilliseconds, durationMilliseconds } = React.useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
  );

  return (
    <div
      className={css`
        display: flex;
        gap: var(--spacing-base);
        align-items: center;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: var(--color-fg-emphasized-sm);

        input {
          flex: 1;
          min-width: 0;
          accent-color: var(--color-primary);
        }
      `}
    >
      <span>{formatTimelinePosition(positionMilliseconds)}</span>
      <input
        type="range"
        aria-label={`Position in ${title}`}
        aria-valuetext={`${formatDuration(positionMilliseconds)} of ${formatDuration(durationMilliseconds)}`}
        min={0}
        max={durationMilliseconds}
        step={1_000}
        value={Math.min(positionMilliseconds, durationMilliseconds)}
        onChange={(event) => player.seekTo(event.currentTarget.valueAsNumber)}
      />
      <span>{formatTimelinePosition(durationMilliseconds)}</span>
    </div>
  );
}

function NarrationDocument({
  audiobook,
  failedUnitIndexes,
  currentUnitIndex,
  onSelectUnit,
}: {
  audiobook: PreparedAudiobook;
  failedUnitIndexes: readonly number[];
  currentUnitIndex?: number;
  onSelectUnit?: (unitIndex: number) => void;
}) {
  const narrationDocumentElementRef = React.useRef<HTMLDivElement>(null);
  const units = audiobook.narrationDocument.synchronizationUnits;
  const currentUnitId = currentUnitIndex === undefined ? undefined : units[currentUnitIndex]?.id;
  const isSelectable = onSelectUnit !== undefined;

  React.useEffect(
    function highlightCurrentSegment() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      for (const previous of narrationDocumentElement.querySelectorAll('[aria-current="true"]')) {
        previous.removeAttribute("aria-current");
      }

      narrationDocumentElement
        .querySelector(`[id="${currentUnitId ?? ""}"]`)
        ?.setAttribute("aria-current", "true");
    },
    [currentUnitId],
  );

  React.useEffect(
    function markSegmentsWithoutAudio() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const marked = failedUnitIndexes.flatMap((unitIndex) => {
        const unit = units[unitIndex];
        const segment = unit && narrationDocumentElement.querySelector(`[id="${unit.id}"]`);
        if (!segment) return [];

        segment.setAttribute("data-synthesis-failed", "");
        segment.setAttribute("title", "Audio could not be generated for this segment.");
        return [segment];
      });

      return () => {
        for (const segment of marked) {
          segment.removeAttribute("data-synthesis-failed");
          segment.removeAttribute("title");
        }
      };
    },
    [failedUnitIndexes, units],
  );

  const selectUnit = React.useEffectEvent((unitIndex: number) => onSelectUnit?.(unitIndex));

  React.useEffect(
    function addSegmentPlaybackButtons() {
      if (!isSelectable) return undefined;

      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const buttons = units.flatMap((unit, unitIndex) => {
        // A segment without audio has nothing to start; playback skips it.
        if (failedUnitIndexes.includes(unitIndex)) return [];

        const segment = narrationDocumentElement.querySelector(`[id="${unit.id}"]`);
        check.assert(segment);

        const button = document.createElement("button");
        button.type = "button";
        button.dataset["segmentControl"] = "";
        button.setAttribute("aria-label", `Play segment ${unitIndex + 1}`);
        button.addEventListener("click", () => selectUnit(unitIndex));
        segment.append(button);
        return [button];
      });

      return () => {
        for (const button of buttons) button.remove();
      };
    },
    [units, failedUnitIndexes, isSelectable],
  );

  return (
    <div
      ref={narrationDocumentElementRef}
      className={composeClassnames(css`
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

        [data-synthesis-failed] {
          padding-inline-start: var(--spacing-base);
          color: var(--color-fg-emphasized-sm);
          border-inline-start: 3px solid var(--color-error);
        }
      `)}
      dangerouslySetInnerHTML={{ __html: audiobook.narrationDocument.html }}
    />
  );
}

function BackLink() {
  return (
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
  );
}

function ReaderNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={css`
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
        align-items: center;
        padding: calc(1.5 * var(--spacing-base));
        margin-block-end: calc(2 * var(--spacing-base));

        font-size: var(--font-size-sm);
        border: 1px solid var(--color-fg-emphasized-xs);
        border-radius: var(--border-radius-sm);

        p {
          flex: 1 1 100%;
        }
      `}
    >
      {children}
    </div>
  );
}

function PlayerControlsBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={css`
        position: fixed;
        right: 0;
        bottom: 0;
        left: 0;

        display: flex;
        flex-direction: column;
        gap: calc(2*var(--spacing-base));
        justify-content: center;
        height: var(--player-controls-height);
        padding-block: calc(2*var(--spacing-base));
        padding-inline: var(--app-padding-inline);

        background-color: var(--color-bg);
        border-top: 1.5px solid var(--color-fg-emphasized-xs);

        output {
          font-size: var(--font-size-sm);
          color: var(--color-fg-emphasized-sm);
          text-align: center;
        }
      `}
    >
      {children}
    </div>
  );
}

const playButtonRowClassName = css`
  display: flex;
  justify-content: center;
`;

function formatSegmentCount(count: number) {
  return `${count} ${count === 1 ? "segment" : "segments"}`;
}

/** Formats a duration in minutes and seconds, for example "12 min 5 s". */
function formatDuration(milliseconds: number) {
  const totalSeconds = Math.round(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds} s`;
}

/** Formats a timeline position as a clock, for example "1:02:05" or "12:05". */
function formatTimelinePosition(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return hours === 0
    ? `${minutes}:${seconds}`
    : `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
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

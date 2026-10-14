import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import {
  useSuspenseQuery,
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, Play } from "lucide-react";
import React from "react";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { QueryBoundary } from "#src/app/components/query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import type { PreparedAudiobook } from "#src/app/player/audiobook-player.js";
import { formatDuration } from "#src/app/player/playback-format.js";
import {
  usePlayerHost,
  usePlayerHostSnapshot,
  usePlayerState,
} from "#src/app/player/player-host-provider.js";
import type { LoadRequest } from "#src/app/player/player-host.js";
import { composeClassnames } from "#src/app/utils.ts";
import { useAccountAuthState, useAccountSession } from "#src/auth/hooks.js";
import {
  createAudiobookQuery,
  getLocalPlaybackPosition,
  useRetryConversion,
} from "#src/data-fetching/reader.js";
import type { Player } from "#src/platform/player.js";

export const Route = createFileRoute("/_shell/audiobooks/$conversionId")({
  component: AudiobookBoundary,
});

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

/**
 * Shows the narration document. Its audio plays in the shell's player: opening the page loads the
 * audiobook when nothing else is loaded, and Play or a segment tap replaces another loaded one.
 */
function PreparedReader({
  conversionId,
  audiobook,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
}) {
  const host = usePlayerHost();
  const { loaded } = usePlayerHostSnapshot();
  const session = useAccountSession();
  const isRestoringAccount = useAccountAuthState().status === "loading";
  const narrationDocumentRef = React.useRef<HTMLDivElement>(null);
  const [shouldPlayWithoutFailedSegments, setShouldPlayWithoutFailedSegments] =
    React.useState(false);
  const failedUnitIndexes = React.useMemo(
    () =>
      audiobook.segments
        .filter((segment) => segment.status === "failed")
        .map((segment) => segment.sequence),
    [audiobook.segments],
  );

  const hasAudio = audiobook.segments.some((segment) => segment.status === "ready");
  const isPlayable = audiobook.status === "ready" && hasAudio;
  const isLoaded = loaded?.conversionId === conversionId;
  const hasPlaybackConsent =
    failedUnitIndexes.length === 0 ||
    (isLoaded ? loaded.hasPlaybackConsent : shouldPlayWithoutFailedSegments);
  const canPlay = isPlayable && hasPlaybackConsent;

  function createLoadRequest(): LoadRequest {
    check.assert(audiobook.status === "ready", "Only a ready audiobook can be loaded.");
    return {
      conversionId,
      audiobook,
      position: session ? audiobook.playbackPosition : getLocalPlaybackPosition(conversionId),
      subject: session?.user.id ?? null,
      hasPlaybackConsent,
    };
  }

  function playWithoutFailedSegments() {
    if (isLoaded) host.consentToSkippingSegmentsWithoutAudio();
    else setShouldPlayWithoutFailedSegments(true);
  }

  function playFromUnit(unitIndex: number) {
    if (isLoaded) host.playFromUnit(unitIndex);
    else host.loadAndPlay(createLoadRequest(), unitIndex);
  }

  return (
    <>
      {/* Loading never starts playback, so it needs no consent to skip segments without audio. */}
      {/* Waits for the account, whose listening position and media authorization it needs. */}
      {loaded === null && isPlayable && !isRestoringAccount ? (
        <LoadIntoEmptyPlayer createRequest={createLoadRequest} />
      ) : null}

      <div
        className={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-block-end: var(--spacing-base);
        `}
      >
        <BackLink />
        {/* The player below the page has the controls of the loaded audiobook. */}
        {isLoaded ? null : (
          <DSButton
            variant="text"
            aria-label="Play"
            disabled={!canPlay}
            onClick={() => host.loadAndPlay(createLoadRequest())}
          >
            <Play size={48} />
          </DSButton>
        )}
      </div>

      <ReaderNotices
        conversionId={conversionId}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        hasAudio={hasAudio}
        canPlay={canPlay}
        onPlayWithoutFailedSegments={playWithoutFailedSegments}
      />

      <NarrationDocument
        ref={narrationDocumentRef}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        onSelectUnit={canPlay ? playFromUnit : undefined}
      />
      {isLoaded ? (
        <CurrentSegmentHighlight
          player={loaded.player}
          units={audiobook.narrationDocument.synchronizationUnits}
          narrationDocumentRef={narrationDocumentRef}
        />
      ) : null}
    </>
  );
}

/** Explains why audio is missing or skipped, and offers to retry its synthesis. */
function ReaderNotices({
  conversionId,
  audiobook,
  failedUnitIndexes,
  hasAudio,
  canPlay,
  onPlayWithoutFailedSegments,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
  failedUnitIndexes: readonly number[];
  hasAudio: boolean;
  canPlay: boolean;
  onPlayWithoutFailedSegments: () => void;
}) {
  const retry = useRetryConversion(conversionId, useQueryClient());
  const hasFailedSegments = audiobook.status === "ready" && failedUnitIndexes.length > 0;

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

  return (
    <>
      {retryOutcomeNotice}

      {audiobook.status === "synthesizing" ? (
        <ReaderNotice>
          <output>
            Generating audio…{" "}
            {audiobook.segments.filter((segment) => segment.status === "ready").length} of{" "}
            {formatSegmentCount(audiobook.segments.length)} ready
          </output>
        </ReaderNotice>
      ) : null}

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

      {hasFailedSegments && canPlay ? (
        <ReaderNotice>
          <p>
            {formatSegmentCount(failedUnitIndexes.length)} without audio{" "}
            {failedUnitIndexes.length === 1 ? "is" : "are"} skipped during playback.
          </p>
          {retryButton}
        </ReaderNotice>
      ) : null}

      {hasFailedSegments && !canPlay ? (
        <ReaderNotice>
          <p>
            {hasAudio
              ? `Audio could not be generated for ${formatSegmentCount(failedUnitIndexes.length)}, marked in the text.`
              : "Audio could not be generated for this article."}
          </p>
          {retryButton}
          {hasAudio ? (
            <DSButton onClick={onPlayWithoutFailedSegments}>
              Play without {failedUnitIndexes.length === 1 ? "it" : "them"}
            </DSButton>
          ) : null}
        </ReaderNotice>
      ) : null}
    </>
  );
}

/** Loads the audiobook when it mounts; rendered only while the player is empty. */
function LoadIntoEmptyPlayer({ createRequest }: { createRequest: () => LoadRequest }) {
  const host = usePlayerHost();
  const load = React.useEffectEvent(() => host.load(createRequest()));

  React.useEffect(function loadOnMount() {
    load();
  }, []);

  return null;
}

/** Marks the segment being played; rendered only while this page's audiobook is loaded. */
function CurrentSegmentHighlight({
  player,
  units,
  narrationDocumentRef,
}: {
  player: Player;
  units: PreparedAudiobook["narrationDocument"]["synchronizationUnits"];
  narrationDocumentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const currentUnitIndex = usePlayerState(player, (state) => state.currentUnitIndex);
  const currentUnitId = units[currentUnitIndex]?.id;

  React.useEffect(
    function highlightCurrentSegment() {
      const narrationDocumentElement = narrationDocumentRef.current;
      check.assert(narrationDocumentElement);

      const segment = narrationDocumentElement.querySelector(`[id="${currentUnitId ?? ""}"]`);
      segment?.setAttribute("aria-current", "true");
      return () => segment?.removeAttribute("aria-current");
    },
    [currentUnitId, narrationDocumentRef],
  );

  return null;
}

function NarrationDocument({
  ref: narrationDocumentElementRef,
  audiobook,
  failedUnitIndexes,
  onSelectUnit,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  audiobook: PreparedAudiobook;
  failedUnitIndexes: readonly number[];
  onSelectUnit?: ((unitIndex: number) => void) | undefined;
}) {
  const units = audiobook.narrationDocument.synchronizationUnits;
  const isSelectable = onSelectUnit !== undefined;

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
    [failedUnitIndexes, units, narrationDocumentElementRef],
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
    [units, failedUnitIndexes, isSelectable, narrationDocumentElementRef],
  );

  return (
    <div
      ref={narrationDocumentElementRef}
      className={composeClassnames(css`
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
  const session = useAccountSession();

  return (
    <div
      className={css`
        display: inline-flex;
        gap: var(--spacing-base);
        align-items: center;

        font-size: var(--font-size-display);
      `}
    >
      {/* Only accounts have a conversion history; trial listeners return to the start. */}
      <Link
        to={session ? "/history" : "/"}
        aria-label={session ? "Back to history" : "Back to home"}
      >
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

function formatSegmentCount(count: number) {
  return `${count} ${count === 1 ? "segment" : "segments"}`;
}

function ReaderSkeleton() {
  return (
    <section aria-busy="true" aria-label="Preparing article">
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
    </section>
  );
}

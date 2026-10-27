import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { ShellContent } from "#src/app/components/main.tsx";
import { QueryBoundary, QueryErrorScreen } from "#src/app/components/query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import { DSIconButton, iconButtonStyles } from "#src/app/design-system/icon-button.js";
import { BackChevronIcon, PlayIcon } from "#src/app/design-system/icons.js";
import { formatDuration } from "#src/app/player/playback-format.js";
import type { PreparedAudiobook } from "#src/app/player/playback-session.js";
import {
  usePlayerState,
  useShownAudiobook,
  useShownConversion,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";
import { composeClassnames } from "#src/app/utils.ts";
import { useAccountSession } from "#src/auth/hooks.js";
import { createAudiobookQuery, useRetryConversion } from "#src/data-fetching/reader.js";

export const Route = createFileRoute("/_shell/audiobooks/$conversionId")({
  component: AudiobookBoundary,
});

function AudiobookBoundary() {
  // Outside the boundary, so the page counts as shown while it loads, fails, or is still preparing.
  useShownConversion(Route.useParams().conversionId);

  return (
    <ShellContent
      headerContent={<BackLink />}
      mainContent={
        <QueryBoundary pending={<ReaderSkeleton />} errorComponent={ReaderQueryError}>
          <AudiobookPage />
        </QueryBoundary>
      }
    ></ShellContent>
  );
}

function ReaderQueryError(props: ErrorComponentProps) {
  return <QueryErrorScreen {...props} fallbackTitle="The article could not be loaded." />;
}

function AudiobookPage(): React.JSX.Element {
  const { conversionId } = Route.useParams();
  const session = useAccountSession();
  const query = useSuspenseQuery(createAudiobookQuery(conversionId));
  const retry = useRetryConversion(conversionId, useQueryClient());

  if (query.data.status === "pending") {
    return <ReaderSkeleton />;
  }

  if (query.data.status === "failed") {
    return (
      <ErrorMessage title="The article could not be prepared.">
        <p>{query.data.explanation}</p>
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
 * Shows the narration document. Its audio plays in the shell's player, whose host loads the
 * audiobook once it has a narration track; only then can Play or a segment tap start it.
 */
function PreparedReader({
  conversionId,
  audiobook,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
}) {
  const playback = useShownAudiobook(conversionId, audiobook);
  const { loaded, canPlay } = playback;
  const narrationDocumentRef = React.useRef<HTMLDivElement>(null);
  const failedUnitIndexes = React.useMemo(
    () =>
      audiobook.segments
        .filter((segment) => segment.status === "failed")
        .map((segment) => segment.sequence),
    [audiobook.segments],
  );
  const hasAudio = audiobook.segments.some((segment) => segment.status === "ready");

  return (
    <>
      {/* The player below the page has the controls of the loaded audiobook. */}
      {loaded ? null : (
        <div
          className={css`
            display: flex;
            align-items: center;
            margin-block-end: var(--spacing-base);
          `}
        >
          <DSIconButton
            label="Play"
            icon={<PlayIcon />}
            disabled={!canPlay}
            onClick={playback.play}
          />
        </div>
      )}

      <ReaderNotices
        conversionId={conversionId}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        hasAudio={hasAudio}
      />

      <NarrationDocument
        ref={narrationDocumentRef}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        onSelectUnit={canPlay ? playback.playFromUnit : undefined}
      />
      {loaded ? (
        <CurrentSegmentHighlight
          loaded={loaded}
          units={audiobook.narrationDocument.synchronizationUnits}
          narrationDocumentRef={narrationDocumentRef}
        />
      ) : null}
    </>
  );
}

/** Explains why audio is missing, and offers to retry its synthesis. */
function ReaderNotices({
  conversionId,
  audiobook,
  failedUnitIndexes,
  hasAudio,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
  failedUnitIndexes: readonly number[];
  hasAudio: boolean;
}) {
  const retry = useRetryConversion(conversionId, useQueryClient());
  const hasFailedSegments = audiobook.status === "ready" && failedUnitIndexes.length > 0;

  const retryButton = (
    <DSButton disabled={retry.isPending || !audiobook.canGenerate} onClick={() => retry.mutate()}>
      Retry
    </DSButton>
  );

  // A retry refused for lack of duration changes nothing in the audiobook, so it is reported here.
  const retryOutcomeNotice =
    retry.data?.result === "insufficient-duration" && audiobook.status === "ready" ? (
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

      {/* No narration track exists until every segment has audio, so playback waits for Retry. */}
      {hasFailedSegments ? (
        <ReaderNotice>
          <p>
            {hasAudio
              ? `Audio could not be generated for ${formatSegmentCount(failedUnitIndexes.length)}, marked in the text.`
              : "Audio could not be generated for this article."}
          </p>
          {retryButton}
        </ReaderNotice>
      ) : null}
    </>
  );
}

/** Marks the segment being played; rendered only while this page's audiobook is loaded. */
function CurrentSegmentHighlight({
  loaded,
  units,
  narrationDocumentRef,
}: {
  loaded: LoadedAudiobook;
  units: PreparedAudiobook["narrationDocument"]["synchronizationUnits"];
  narrationDocumentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const currentUnitIndex = usePlayerState(loaded.player, (state) => state.currentUnitIndex);
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
        if (!segment) {
          return [];
        }

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
      if (!isSelectable) {
        return undefined;
      }

      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      // Units are selectable only with a narration track, which has audio for every unit.
      const buttons = units.map((unit, unitIndex) => {
        const segment = narrationDocumentElement.querySelector(`[id="${unit.id}"]`);
        check.assert(segment);

        const button = document.createElement("button");
        button.type = "button";
        button.dataset["segmentControl"] = "";
        button.setAttribute("aria-label", `Play segment ${unitIndex + 1}`);
        button.addEventListener("click", () => selectUnit(unitIndex));
        segment.append(button);
        return button;
      });

      return () => {
        for (const button of buttons) {
          button.remove();
        }
      };
    },
    [units, isSelectable, narrationDocumentElementRef],
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
      `}
    >
      {/* Only accounts have Recents; trial listeners return to the start. */}
      <Link
        to={session ? "/recent" : "/"}
        aria-label={session ? "Back to Recents" : "Back to home"}
        className={iconButtonStyles}
      >
        <BackChevronIcon />
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
            background: rgb(var(--color-ink-rgb) / 12%);
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

import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import type { Audiobook } from "@cup/listener-api.routes";

import { DetailTopBar } from "#src/app/components/detail-top-bar.js";
import type { DetailBackTarget } from "#src/app/components/detail-top-bar.js";
import { ErrorScreen } from "#src/app/components/error-message.js";
import { fadeFooterClearance } from "#src/app/components/fade-footer.js";
import { ShellContent } from "#src/app/components/main.tsx";
import { PLAYER_SHEET_HEIGHTS, PlayerSheet } from "#src/app/components/player-sheet.js";
import { TrackSkeleton } from "#src/app/components/track-skeleton.js";
import { DSButton } from "#src/app/design-system/button.js";
import { DSCoverImage } from "#src/app/design-system/cover-image.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { formatDuration } from "#src/app/player/playback-format.js";
import type { PreparedAudiobook } from "#src/app/player/playback-session.js";
import {
  usePlayerHost,
  usePlayerState,
  useShownAudiobook,
  useShownConversion,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";
import { toPreparationPhaseLabel } from "#src/app/preparation-phase-label.js";
import { toSourceHost } from "#src/app/source-host.js";
import { useAnnounceStatus } from "#src/app/status-announcer.js";
import { useRetryRoute } from "#src/app/use-retry-route.js";
import { composeClassnames } from "#src/app/utils.ts";
import { useAccountSession } from "#src/auth/hooks.js";
import { useIsAccountConversion } from "#src/data-fetching/account-history.js";
import {
  createAudiobookQuery,
  useDeleteConversion,
  useRetryConversion,
} from "#src/data-fetching/reader.js";
import { describeError } from "#src/errors.js";

// The audiobook request waits for any session itself (`requestApi("optional")`), so the detail view
// needs no `beforeLoad`.
export const Route = createFileRoute("/_shell/audiobooks/$conversionId")({
  component: AudiobookRoute,
  loader: async ({ context, params }) => {
    await context.queryClient.query({
      ...createAudiobookQuery(params.conversionId),
      staleTime: "static",
    });
  },
  pendingComponent: () => (
    <DetailLayout topBar={<PlainTopBar />} statusLine={toPreparationPhaseLabel(undefined)}>
      <TrackSkeleton label="Loading track" isLoadingState />
    </DetailLayout>
  ),
  errorComponent: ReaderQueryError,
});

type RetryMutation = ReturnType<typeof useRetryConversion>;

function AudiobookRoute() {
  const { conversionId } = Route.useParams();

  // Another audiobook starts with a fresh retry outcome and its title in view.
  return <AudiobookPage key={conversionId} conversionId={conversionId} />;
}

/**
 * Every detail view has the player sheet, disabled until the shown audiobook can play. The page
 * counts as shown while it loads, fails, or is still preparing.
 */
function DetailLayout({
  topBar,
  statusLine = "",
  children,
}: {
  topBar: React.ReactNode;
  /** The status line above the scrubber: the preparation phase or the synthesis progress. */
  statusLine?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  useShownConversion(Route.useParams().conversionId);

  return (
    <>
      <ShellContent
        headerContent={topBar}
        mainContent={<div {...interTypefaceScope}>{children}</div>}
        mainPaddingBlockEnd={fadeFooterClearance(PLAYER_SHEET_HEIGHTS)}
      />
      <PlayerSheet statusLine={statusLine} />
    </>
  );
}

/** The top bar before the audiobook has loaded: Back only. */
function PlainTopBar() {
  return <DetailTopBar backTo={useBackTarget()} compactTitle={undefined} menu={undefined} />;
}

/** Only accounts have Recents; trial listeners return to the start. */
function useBackTarget(): DetailBackTarget {
  return useAccountSession() ? "/recent" : "/";
}

function ReaderQueryError({ error }: ErrorComponentProps) {
  const retry = useRetryRoute();

  return (
    <DetailLayout topBar={<PlainTopBar />}>
      <ErrorScreen error={error} fallbackTitle="The track could not be loaded." onRetry={retry} />
    </DetailLayout>
  );
}

function AudiobookPage({ conversionId }: { conversionId: string }): React.JSX.Element {
  const session = useAccountSession();
  const backTo = useBackTarget();
  const queryClient = useQueryClient();
  const deletion = useTrackDeletion(conversionId);
  // Trial conversions cannot be deleted, even by a signed-in listener who can open one.
  const isDeletable = useIsAccountConversion(session?.user.id, conversionId);
  const audiobookQuery = createAudiobookQuery(conversionId);
  const { data: audiobook, dataUpdatedAt: audiobookReceivedAt } = useSuspenseQuery(
    // A poll during or after the deletion would find the track gone and report a failure.
    deletion.isPollingStopped ? { ...audiobookQuery, refetchInterval: false } : audiobookQuery,
  );
  // The top bar's "…" menu and the page's Retry buttons share one mutation, so a refused retry is
  // reported in the notices wherever it was started.
  const retry = useRetryConversion(conversionId, queryClient);
  const [isTitleScrolledAway, setIsTitleScrolledAway] = React.useState(false);

  const topBar = (
    <>
      <DetailTopBar
        backTo={backTo}
        compactTitle={
          "title" in audiobook
            ? {
                title: audiobook.title,
                host: toSourceHost(audiobook.originalUrl),
                isShown: isTitleScrolledAway,
              }
            : undefined
        }
        menu={{
          originalUrl: audiobook.originalUrl,
          retry: offersRetry(audiobook)
            ? { isPending: retry.isPending, start: () => retry.mutate() }
            : undefined,
          deletion: isDeletable ? { start: deletion.openDialog } : undefined,
        }}
      />
      {/* Rendered into a portal, so its place here only ties it to the page's state. */}
      <DeleteTrackDialog deletion={deletion} />
    </>
  );

  if (audiobook.status === "pending") {
    return (
      <DetailLayout
        topBar={topBar}
        statusLine={toPreparationPhaseLabel(audiobook.preparationPhase)}
      >
        <TrackSkeleton label="Preparing track" isLoadingState={false} />
      </DetailLayout>
    );
  }

  if (audiobook.status === "failed") {
    return (
      <DetailLayout topBar={topBar}>
        <section
          className={css`
            display: grid;
            gap: var(--spacing-gutter);
            justify-items: start;
          `}
        >
          <h1 className={textStyles.h2}>{toSourceHost(audiobook.originalUrl)}</h1>
          <h2 className={textStyles.h5}>This track could not be prepared.</h2>
          <p
            className={composeClassnames(
              textStyles.paragraph,
              css`
                color: var(--color-ink-60);
              `,
            )}
          >
            {audiobook.explanation}
          </p>
          <DSButton
            disabled={retry.isPending || !audiobook.canGenerate}
            onClick={() => retry.mutate()}
          >
            Retry
          </DSButton>
        </section>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      topBar={topBar}
      statusLine={
        audiobook.status === "synthesizing"
          ? `Generating audio, ${audiobook.segments.filter((segment) => segment.status === "ready").length} of ${formatSegmentCount(audiobook.segments.length)} ready`
          : ""
      }
    >
      <PreparedReader
        key={session?.user.id ?? "anonymous"}
        conversionId={conversionId}
        audiobook={audiobook}
        audiobookReceivedAt={audiobookReceivedAt}
        retry={retry}
        onTitleScrolledAwayChange={setIsTitleScrolledAway}
      />
    </DetailLayout>
  );
}

type TrackDeletion = ReturnType<typeof useTrackDeletion>;

/** The delete dialog's state and the deletion it confirms, for the signed-in listener's track. */
function useTrackDeletion(conversionId: string) {
  const session = useAccountSession();
  const host = usePlayerHost();
  const navigate = useNavigate();
  const announce = useAnnounceStatus();
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const mutation = useDeleteConversion({
    subject: session?.user.id,
    conversionId,
    onDeleted: async () => {
      // Replaces the detail entry, so Back cannot return to the deleted track.
      await navigate({ to: "/recent", replace: true });
      // Once the dialog is gone, which hides the rest of the page from screen readers while open.
      announce("Track deleted.");
    },
  });

  return {
    isDialogOpen,
    isPending: mutation.isPending,
    error: mutation.error,
    isPollingStopped: mutation.isPending || mutation.isSuccess,
    openDialog: () => setIsDialogOpen(true),
    closeDialog: () => {
      // Escape cannot abandon a deletion that runs.
      if (mutation.isPending) {
        return;
      }
      setIsDialogOpen(false);
      mutation.reset();
    },
    confirm: () => {
      // Before the request, so no part of the app plays the track while it is deleted.
      host.release(conversionId);
      mutation.mutate();
    },
  };
}

/** Confirms the deletion of the track; Cancel has the focus, as the safe choice. */
function DeleteTrackDialog({ deletion }: { deletion: TrackDeletion }): React.JSX.Element {
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const error = deletion.error
    ? describeError(deletion.error, "The track could not be deleted.")
    : undefined;

  return (
    <DSDialog
      role="alertdialog"
      open={deletion.isDialogOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          deletion.closeDialog();
        }
      }}
      initialFocus={cancelButtonRef}
      finalFocus={true}
      title={<>Delete track?</>}
      description={
        <>
          The track will be deleted permanently. The audio duration it used is not returned to your
          allowance.
        </>
      }
      cancelButtonText={<>Cancel</>}
      cancelButtonDisabled={deletion.isPending}
      cancelButtonRef={cancelButtonRef}
      buttonGroupChildren={
        <DSButton variant="contained" disabled={deletion.isPending} onClick={deletion.confirm}>
          {deletion.isPending ? "Deleting…" : "Delete"}
        </DSButton>
      }
      errorMessage={error && [error.title, error.detail].filter(Boolean).join(" ")}
    />
  );
}

/**
 * Shows the narration document. Its audio plays in the shell's player, which the player sheet
 * controls; once the audiobook has a narration track, a segment tap plays from that segment.
 */
function PreparedReader({
  conversionId,
  audiobook,
  audiobookReceivedAt,
  retry,
  onTitleScrolledAwayChange,
}: {
  conversionId: string;
  audiobook: PreparedAudiobook;
  /** When the audiobook's response arrived, which can lie long before this page showed it. */
  audiobookReceivedAt: number;
  retry: RetryMutation;
  onTitleScrolledAwayChange: (isScrolledAway: boolean) => void;
}) {
  const playback = useShownAudiobook(conversionId, audiobook, audiobookReceivedAt);
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
      {audiobook.coverImage ? (
        <DSCoverImage
          src={audiobook.coverImage.url}
          alt={audiobook.coverImage.alternativeText ?? ""}
          className={css`
            margin-block-end: calc(2 * var(--spacing-gutter));
          `}
        />
      ) : null}

      <ReaderNotices
        audiobook={audiobook}
        retry={retry}
        failedUnitIndexes={failedUnitIndexes}
        hasAudio={hasAudio}
      />

      <NarrationDocument
        ref={narrationDocumentRef}
        audiobook={audiobook}
        failedUnitIndexes={failedUnitIndexes}
        onSelectUnit={canPlay ? playback.playFromUnit : undefined}
        onTitleScrolledAwayChange={onTitleScrolledAwayChange}
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
  audiobook,
  retry,
  failedUnitIndexes,
  hasAudio,
}: {
  audiobook: PreparedAudiobook;
  retry: RetryMutation;
  failedUnitIndexes: readonly number[];
  hasAudio: boolean;
}) {
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

      {audiobook.status === "insufficient-duration" ? (
        <ReaderNotice>
          {audiobook.availableMilliseconds >= audiobook.requiredMilliseconds ? (
            // Duration was freed since generation was refused; nothing starts until Retry.
            <p>Audio has not been generated for this track yet.</p>
          ) : (
            <p>
              Not enough audio duration for this track. It needs about{" "}
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
              : "Audio could not be generated for this track."}
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
  onTitleScrolledAwayChange,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  audiobook: PreparedAudiobook;
  failedUnitIndexes: readonly number[];
  onSelectUnit?: ((unitIndex: number) => void) | undefined;
  onTitleScrolledAwayChange: (isScrolledAway: boolean) => void;
}) {
  const units = audiobook.narrationDocument.synchronizationUnits;
  const isSelectable = onSelectUnit !== undefined;
  const sourceHost = toSourceHost(audiobook.originalUrl);

  React.useEffect(
    function insertSourceHostBelowTitle() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const title = findTitle(narrationDocumentElement, units);
      // A source subtitle shares an <hgroup> with the title, and the host goes below both.
      const titleParent = title.parentElement;
      const titleGroup = titleParent?.tagName === "HGROUP" ? titleParent : title;
      const host = document.createElement("p");
      host.dataset["sourceHost"] = "";
      host.className = textStyles.tagline;
      host.textContent = sourceHost;
      titleGroup.after(host);

      return () => host.remove();
    },
    // A changed document is rendered anew, which drops the host.
    [sourceHost, units, narrationDocumentElementRef],
  );

  React.useLayoutEffect(
    function applyHeadingTextStyles() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const title = findTitle(narrationDocumentElement, units);
      // The source subtitle is drawn in the subheading text style.
      const subheadings = narrationDocumentElement.querySelectorAll(
        "h2, h3, h4, h5, h6, hgroup > h1 + p",
      );
      title.classList.add(textStyles.h2);
      for (const subheading of subheadings) {
        subheading.classList.add(textStyles.h4);
      }

      return () => {
        title.classList.remove(textStyles.h2);
        for (const subheading of subheadings) {
          subheading.classList.remove(textStyles.h4);
        }
      };
    },
    // A changed document is rendered anew, which drops the classes.
    [units, narrationDocumentElementRef],
  );

  const reportTitleScrolledAway = React.useEffectEvent((isScrolledAway: boolean) =>
    onTitleScrolledAwayChange(isScrolledAway),
  );

  React.useEffect(
    function observeTitleVisibility() {
      const narrationDocumentElement = narrationDocumentElementRef.current;
      check.assert(narrationDocumentElement);

      const title = findTitle(narrationDocumentElement, units);
      // The document scrolls, so the root is the screen without the sticky header on top of it:
      // only a title under or above the header is scrolled away. A large cover on a short screen
      // can start it below the visible part, so the root reaches far below the screen and the title
      // counts as intersecting there.
      const headerHeight =
        document.querySelector<HTMLElement>("[data-shell-header]")?.offsetHeight ?? 0;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry) {
            reportTitleScrolledAway(!entry.isIntersecting);
          }
        },
        {
          rootMargin: `-${headerHeight}px 0px ${TITLE_OBSERVER_BOTTOM_MARGIN_PIXELS}px 0px`,
        },
      );
      observer.observe(title);

      return () => {
        observer.disconnect();
        reportTitleScrolledAway(false);
      };
    },
    [units, narrationDocumentElementRef],
  );

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
      className={composeClassnames(
        textStyles.paragraph,
        css`
          color: var(--color-ink-60);

          & > article > * {
            /* one blank line between blocks, as drawn */
            margin-block-end: var(--line-height-paragraph);
          }

          /* the title and the host inserted below it open the page as drawn */
          /* the title and headings take the h2 and h4 text styles from applyHeadingTextStyles */
          & > article > h1,
          & > article > hgroup,
          & > article > hgroup > h1 {
            margin-block-end: var(--spacing-gutter);
            color: var(--color-ink);
          }

          /* the source subtitle sits closer to the title than the host does, as drawn */
          & > article > hgroup > h1 {
            margin-block-end: var(--spacing-base);
          }

          /* the source subtitle, which only ever follows the title inside the <hgroup> */
          & > article > hgroup > h1 + p {
            color: var(--color-ink-60);
          }

          & > article > [data-source-host] {
            color: var(--color-ink-40);
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
            border-radius: inherit;
          }

          [aria-current="true"] {
            color: var(--color-ink);
            background-color: var(--color-ink-8);

            /*
              The highlight extends 12 px past the text on every side without moving it; the spread
              grows the 12 px radius to the drawn 24 px.
            */
            border-radius: var(--spacing-gutter);
            box-shadow: 0 0 0 var(--spacing-gutter) var(--color-ink-8);
          }

          [data-synthesis-failed] {
            padding-inline-start: var(--spacing-base);
            border-inline-start: 3px solid var(--color-error);
          }
        `,
      )}
      dangerouslySetInnerHTML={{ __html: audiobook.narrationDocument.html }}
    />
  );
}

/** Far more than any screen, so a title below the visible part of the page never counts as gone. */
const TITLE_OBSERVER_BOTTOM_MARGIN_PIXELS = 100_000;

/** Every narration document opens with its title as its first unit, which is narrated too. */
function findTitle(
  narrationDocumentElement: HTMLElement,
  units: PreparedAudiobook["narrationDocument"]["synchronizationUnits"],
): Element {
  const title = narrationDocumentElement.querySelector(`[id="${units[0]?.id ?? ""}"]`);
  check.assert(title, "The narration document has no title.");
  return title;
}

/** Notices that explain missing audio, in the reader's flow above the text. */
function ReaderNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={composeClassnames(
        textStyles.h5,
        css`
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-gutter);
          align-items: center;
          padding: var(--spacing-gutter) calc(2 * var(--spacing-gutter));
          margin-block-end: calc(2 * var(--spacing-gutter));

          /* the h5 size and line height at the regular weight; notices are undrawn */
          font-weight: 400;

          background-color: var(--color-surface);
          border: 1px solid var(--color-ink-4);
          border-radius: var(--border-radius-lg);

          p {
            flex: 1 1 100%;
          }
        `,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Retry starts nothing while the conversion runs, and has nothing to restart once every segment has
 * audio.
 */
function offersRetry(audiobook: Audiobook): boolean {
  if (!audiobook.canGenerate) {
    return false;
  }
  switch (audiobook.status) {
    case "pending":
    case "synthesizing": {
      return false;
    }
    case "failed":
    case "insufficient-duration": {
      return true;
    }
    case "ready": {
      return audiobook.segments.some((segment) => segment.status === "failed");
    }
    default: {
      return check.assertIsUnreachable(audiobook);
    }
  }
}

function formatSegmentCount(count: number) {
  return `${count} ${count === 1 ? "segment" : "segments"}`;
}

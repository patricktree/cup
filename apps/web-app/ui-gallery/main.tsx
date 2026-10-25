import { RequestHandler } from "msw";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { worker } from "#ui-gallery/mocks.js";

import { AppStyles } from "#src/app/app-styles.js";
import type { Story, StoryComponent } from "#src/ui-gallery/story.js";

type MountParams = {
  props?: Record<string, unknown>;
  story: string;
};

type StoryGroup = {
  storyNames: string[];
  storyPath: string;
};

const THUMBNAIL_VIEWPORT = { height: 844, width: 390 };
const GRID_THUMBNAIL_SCALE = 0.6;
const STRIP_THUMBNAIL_SCALE = 0.2;
// stories need the gallery's origin for its mock service worker and for browser storage
const STORY_FRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts";

const storyModules = import.meta.glob("../src/**/*.story.{tsx,jsx}");
const rootElement = requireRootElement();

const parameters = new URLSearchParams(window.location.search);
const mockingReady = parameters.has("canvas")
  ? worker.start({
      serviceWorker: { url: "/ui-gallery/mockServiceWorker.js" },
      onUnhandledFrame: "bypass",
      quiet: true,
    })
  : Promise.resolve();

let root: Root | undefined;
// Tests that block service workers mount stories on the index, because the canvas starts the mock
// service worker. The index renders only after loading every story module, which can finish after
// a story is mounted, so a mounted story replaces the index and keeps it from rendering.
let galleryRoot: Root | undefined;
let isStoryRequested = false;

async function mount({ props = {}, story }: MountParams): Promise<void> {
  isStoryRequested = true;
  await mockingReady;
  const definition = await resolveStory(story);
  if (definition === undefined) {
    throw new TypeError(`Unknown component story: ${story}`);
  }

  worker.resetHandlers(...(definition.handlers ?? []));
  await definition.beforeMount?.();
  const StoryComponent = definition.component;
  galleryRoot?.unmount();
  galleryRoot = undefined;
  const currentRoot = (root ??= createRoot(rootElement));
  flushSync(() => {
    currentRoot.render(
      <React.StrictMode>
        <AppStyles />
        <StoryComponent {...props} />
      </React.StrictMode>,
    );
  });
  await definition.play?.({ canvasElement: rootElement });
}

async function unmount(): Promise<void> {
  root?.unmount();
  root = undefined;
  worker.resetHandlers();
}

Object.assign(window, { mount, unmount });
if (parameters.has("canvas")) {
  if (parameters.has("thumbnail")) {
    keepFocusFromScrolling();
  }

  const story = parameters.get("story");
  if (story !== null) {
    await mount({ story });
  }
} else {
  await showGallery();
}

async function resolveStory(storyId: string): Promise<Story | undefined> {
  const separatorIndex = storyId.lastIndexOf("/");
  if (separatorIndex < 1) {
    return undefined;
  }

  const storyPath = storyId.slice(0, separatorIndex);
  const exportName = storyId.slice(separatorIndex + 1);
  const storyFile = Object.keys(storyModules).find((filePath) => {
    const fileStoryId = readStoryPath(filePath);
    return fileStoryId === storyPath || fileStoryId.endsWith(`/${storyPath}`);
  });
  const loadStoryModule = storyFile === undefined ? undefined : storyModules[storyFile];
  if (loadStoryModule === undefined) {
    return undefined;
  }

  const storyModule: unknown = await loadStoryModule();
  if (!isUnknownRecord(storyModule)) {
    return undefined;
  }

  const storyExport = storyModule[exportName];
  return readStory(storyExport);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoryComponent(value: unknown): value is StoryComponent {
  return typeof value === "function";
}

function requireRootElement(): HTMLElement {
  const element = document.querySelector("#root");
  if (!(element instanceof HTMLElement)) {
    throw new TypeError("The component gallery requires an HTML element with id 'root'");
  }

  return element;
}

async function showGallery(): Promise<void> {
  const storyGroups = await collectStoryGroups();
  const requestedSelection = readStorySelection();
  if (isStoryRequested) {
    return;
  }

  document.body.style.margin = "0";
  galleryRoot = createRoot(rootElement);
  galleryRoot.render(
    requestedSelection === undefined ? (
      <StoryGrid storyGroups={storyGroups} />
    ) : (
      <StoryView initialSelection={requestedSelection} storyGroups={storyGroups} />
    ),
  );
}

async function collectStoryGroups(): Promise<StoryGroup[]> {
  const storyGroups: StoryGroup[] = [];
  for (const [filePath, loadModule] of Object.entries(storyModules)) {
    const module: unknown = await loadModule();
    if (!isUnknownRecord(module)) {
      continue;
    }

    const storyNames = Object.entries(module)
      .filter(([, value]) => readStory(value) !== undefined)
      .map(([name]) => name)
      .sort();
    if (storyNames.length > 0) {
      storyGroups.push({ storyPath: readStoryPath(filePath), storyNames });
    }
  }

  return storyGroups.sort((a, b) => a.storyPath.localeCompare(b.storyPath));
}

function readStoryPath(filePath: string): string {
  return filePath.replace(/^(\.\.\/)+src\//, "").replace(/\.story\.\w+$/, "");
}

/**
 * A story that focuses an element, such as one opening a dialog, would otherwise scroll the
 * thumbnail grid of `StoryGrid` to its frame.
 */
function keepFocusFromScrolling(): void {
  const prototype: { focus: (this: HTMLElement, options?: FocusOptions) => void } =
    HTMLElement.prototype;
  const focus = prototype.focus;
  prototype.focus = function focusWithoutScrolling(options) {
    focus.call(this, { ...options, preventScroll: true });
  };
}

function createGalleryUrl(searchParameters: Record<string, string>, hash = ""): string {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams(searchParameters).toString();
  url.hash = hash;
  return url.href;
}

function StoryGrid({ storyGroups }: { storyGroups: StoryGroup[] }): React.ReactNode {
  // `StoryView` links back to the grid with the story it shows as the URL fragment
  const [originStoryId] = React.useState(() => decodeURIComponent(window.location.hash.slice(1)));

  // The browser cannot scroll to the fragment itself, because the grid renders after the page load.
  React.useEffect(
    function revealOriginStory() {
      // `StoryThumbnail` uses the story ID as its element ID
      document.getElementById(originStoryId)?.scrollIntoView({ block: "center" });
    },
    [originStoryId],
  );

  return (
    <main
      style={{
        background: "#f4f4f5",
        boxSizing: "border-box",
        font: "14px system-ui",
        minHeight: "100dvh",
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>ui-gallery</h1>
      {storyGroups.map(({ storyPath, storyNames }) => (
        <section key={storyPath}>
          <h2 style={{ fontSize: 14, margin: "24px 0 12px" }}>{storyPath}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {storyNames.map((storyName) => (
              <StoryThumbnail
                isCurrent={`${storyPath}/${storyName}` === originStoryId}
                key={storyName}
                scale={GRID_THUMBNAIL_SCALE}
                storyId={`${storyPath}/${storyName}`}
                storyName={storyName}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

type StoryThumbnailProps = {
  isCurrent?: boolean;
  /** Replaces the navigation of an unmodified click, so that the gallery stays mounted. */
  onSelect?: () => void;
  scale: number;
  storyId: string;
  storyName: string;
};

function StoryThumbnail({
  isCurrent = false,
  onSelect,
  scale,
  storyId,
  storyName,
}: StoryThumbnailProps): React.ReactNode {
  return (
    <a
      aria-current={isCurrent ? "page" : undefined}
      href={createGalleryUrl({ story: storyId })}
      id={storyId}
      onClick={(event) => {
        const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (onSelect === undefined || isModifiedClick) {
          return;
        }

        event.preventDefault();
        onSelect();
      }}
      style={{
        color: "inherit",
        flex: "none",
        fontWeight: isCurrent ? 600 : undefined,
        textDecoration: "none",
        width: THUMBNAIL_VIEWPORT.width * scale,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 6,
          height: THUMBNAIL_VIEWPORT.height * scale,
          outline: isCurrent ? "2px solid #2563eb" : "1px solid #ddd",
          overflow: "hidden",
        }}
      >
        <iframe
          // inert so that a click reaches the surrounding link instead of the story
          inert
          loading="lazy"
          sandbox={STORY_FRAME_SANDBOX}
          src={createGalleryUrl({ canvas: "1", story: storyId, thumbnail: "1" })}
          style={{
            border: 0,
            height: THUMBNAIL_VIEWPORT.height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            width: THUMBNAIL_VIEWPORT.width,
          }}
          title={`${storyName} thumbnail`}
        />
      </div>
      <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>{storyName}</div>
    </a>
  );
}

type StorySelection = {
  isStripVisible: boolean;
  storyId: string;
};

function readStorySelection(): StorySelection | undefined {
  const searchParameters = new URLSearchParams(window.location.search);
  const storyId = searchParameters.get("story");
  if (storyId === null) {
    return undefined;
  }

  return { isStripVisible: searchParameters.get("thumbnails") !== "hidden", storyId };
}

function createStoryUrl({ isStripVisible, storyId }: StorySelection): string {
  return createGalleryUrl({ story: storyId, ...(isStripVisible ? {} : { thumbnails: "hidden" }) });
}

type StoryViewProps = {
  initialSelection: StorySelection;
  storyGroups: StoryGroup[];
};

function StoryView({ initialSelection, storyGroups }: StoryViewProps): React.ReactNode {
  const [selection, setSelection] = React.useState(initialSelection);
  const { isStripVisible, storyId } = selection;
  const [resetCount, setResetCount] = React.useState(0);

  React.useEffect(function followHistoryNavigation() {
    function readSelectionFromUrl(): void {
      const nextSelection = readStorySelection();
      if (nextSelection !== undefined) {
        setSelection(nextSelection);
      }
    }

    window.addEventListener("popstate", readSelectionFromUrl);
    return () => window.removeEventListener("popstate", readSelectionFromUrl);
  }, []);

  const stripRef = React.useRef<HTMLElement>(null);
  React.useEffect(function revealCurrentThumbnail() {
    stripRef.current
      // `StoryThumbnail` marks the current story with `aria-current`
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function selectStory(nextStoryId: string): void {
    const nextSelection = { ...selection, storyId: nextStoryId };
    window.history.pushState(null, "", createStoryUrl(nextSelection));
    setSelection(nextSelection);
  }

  function toggleStrip(): void {
    const nextSelection = { ...selection, isStripVisible: !isStripVisible };
    window.history.replaceState(null, "", createStoryUrl(nextSelection));
    setSelection(nextSelection);
  }

  const storyPath = storyId.slice(0, storyId.lastIndexOf("/"));
  const siblingStoryNames =
    storyGroups.find((storyGroup) => storyGroup.storyPath === storyPath)?.storyNames ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        font: "14px system-ui",
        height: "100dvh",
      }}
    >
      <header style={{ background: "#fff", borderBottom: "1px solid #ddd" }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            padding: "12px 16px",
          }}
        >
          <a href={createGalleryUrl({}, storyId)}>← All stories</a>
          <strong style={{ overflowWrap: "anywhere" }}>{storyId}</strong>
          <button
            onClick={() => setResetCount((count) => count + 1)}
            style={{ font: "inherit", padding: 8 }}
            type="button"
          >
            Reset story
          </button>
          <button
            aria-expanded={isStripVisible}
            onClick={toggleStrip}
            style={{ font: "inherit", padding: 8 }}
            type="button"
          >
            {isStripVisible ? "Hide thumbnails" : "Show thumbnails"}
          </button>
        </div>
        <nav
          aria-label={`Stories of ${storyPath}`}
          ref={stripRef}
          style={{
            // hidden instead of unmounted, so that showing the strip again does not reload its frames
            display: isStripVisible ? "flex" : "none",
            fontSize: 11,
            gap: 12,
            overflowX: "auto",
            // room for the outline of the thumbnails, which the scroll container would clip
            padding: "2px 16px 12px",
          }}
        >
          {siblingStoryNames.map((storyName) => {
            const siblingStoryId = `${storyPath}/${storyName}`;
            return (
              <StoryThumbnail
                isCurrent={siblingStoryId === storyId}
                key={storyName}
                onSelect={() => selectStory(siblingStoryId)}
                scale={STRIP_THUMBNAIL_SCALE}
                storyId={siblingStoryId}
                storyName={storyName}
              />
            );
          })}
        </nav>
      </header>
      <iframe
        // Remounting the frame reloads the story from scratch. Changing `src` on a mounted frame
        // would instead add a history entry, so that going back navigates the frame only.
        key={`${storyId}#${resetCount}`}
        sandbox={STORY_FRAME_SANDBOX}
        src={createGalleryUrl({ canvas: "1", story: storyId })}
        style={{ background: "#fff", border: 0, flex: 1, minHeight: 0, width: "100%" }}
        title="Story preview"
      />
    </div>
  );
}

function readStory(value: unknown): Story | undefined {
  if (isStoryComponent(value)) {
    return { component: value };
  }
  if (!isUnknownRecord(value) || !isStoryComponent(value["component"])) {
    return undefined;
  }
  const handlers = value["handlers"];
  const beforeMount = value["beforeMount"];
  const play = value["play"];
  if (beforeMount !== undefined && !isStoryBeforeMount(beforeMount)) {
    throw new TypeError("Story beforeMount must be a function");
  }
  if (play !== undefined && !isStoryPlay(play)) {
    throw new TypeError("Story play must be a function");
  }
  if (
    handlers !== undefined &&
    (!Array.isArray(handlers) ||
      !handlers.every((handler): handler is RequestHandler => handler instanceof RequestHandler))
  ) {
    throw new TypeError("Story handlers must be an array of MSW request handlers");
  }
  return {
    component: value["component"],
    ...(handlers === undefined ? {} : { handlers }),
    ...(beforeMount === undefined ? {} : { beforeMount }),
    ...(play === undefined ? {} : { play }),
  };
}

function isStoryPlay(value: unknown): value is NonNullable<Story["play"]> {
  return typeof value === "function";
}

function isStoryBeforeMount(value: unknown): value is NonNullable<Story["beforeMount"]> {
  return typeof value === "function";
}

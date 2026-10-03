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

async function mount({ props = {}, story }: MountParams): Promise<void> {
  await mockingReady;
  const definition = await resolveStory(story);
  if (definition === undefined) {
    throw new TypeError(`Unknown component story: ${story}`);
  }

  worker.resetHandlers(...(definition.handlers ?? []));
  const StoryComponent = definition.component;
  const currentRoot = (root ??= createRoot(rootElement));
  flushSync(() => {
    currentRoot.render(
      <React.StrictMode>
        <AppStyles />
        <StoryComponent {...props} />
      </React.StrictMode>,
    );
  });
}

async function unmount(): Promise<void> {
  root?.unmount();
  root = undefined;
  worker.resetHandlers();
}

Object.assign(window, { mount, unmount });
if (parameters.has("canvas")) {
  const story = parameters.get("story");
  if (story !== null) await mount({ story });
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
    const fileStoryId = filePath.replace(/^(\.\.\/)+src\//, "").replace(/\.story\.\w+$/, "");
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
  const storyIds: string[] = [];
  for (const [filePath, loadModule] of Object.entries(storyModules)) {
    const module: unknown = await loadModule();
    if (!isUnknownRecord(module)) continue;
    const prefix = filePath.replace(/^(\.\.\/)+src\//, "").replace(/\.story\.\w+$/, "");
    for (const [name, value] of Object.entries(module)) {
      if (readStory(value) !== undefined) storyIds.push(prefix + "/" + name);
    }
  }
  storyIds.sort();

  const toolbar = document.createElement("header");
  toolbar.style.cssText =
    "display:flex;gap:16px;align-items:center;padding:12px 16px;font:14px system-ui;background:#fff;border-bottom:1px solid #ddd;flex-wrap:wrap";
  const label = document.createElement("label");
  label.style.cssText = "min-width:0;max-width:100%";
  label.textContent = "ui-gallery — Story ";
  const select = document.createElement("select");
  select.style.cssText = "box-sizing:border-box;font:inherit;max-width:100%;padding:8px";
  for (const id of storyIds) select.add(new Option(id, id));
  label.append(select);
  const reload = document.createElement("button");
  reload.textContent = "Reset story";
  reload.style.cssText = "font:inherit;padding:8px";
  toolbar.append(label, reload);
  const frame = document.createElement("iframe");
  frame.title = "Story preview";
  frame.style.cssText = "border:0;width:100%;flex:1;min-height:0;background:#fff";
  rootElement.style.cssText = "display:flex;flex-direction:column;height:100dvh";
  document.body.style.margin = "0";
  rootElement.append(toolbar, frame);

  function renderSelection(): void {
    const url = new URL(window.location.href);
    url.searchParams.set("canvas", "1");
    url.searchParams.set("story", select.value);
    frame.src = url.href;
  }
  function readSelection(): void {
    const requested = new URLSearchParams(window.location.search).get("story");
    select.value =
      requested !== null && storyIds.includes(requested) ? requested : (storyIds[0] ?? "");
    if (select.value) renderSelection();
  }
  select.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("story", select.value);
    window.history.pushState(null, "", url);
    renderSelection();
  });
  reload.addEventListener("click", renderSelection);
  window.addEventListener("popstate", readSelection);
  readSelection();
}

function readStory(value: unknown): Story | undefined {
  if (isStoryComponent(value)) return { component: value };
  if (!isUnknownRecord(value) || !isStoryComponent(value["component"])) return undefined;
  const handlers = value["handlers"];
  if (handlers === undefined) return { component: value["component"] };
  if (
    !Array.isArray(handlers) ||
    !handlers.every((handler): handler is RequestHandler => handler instanceof RequestHandler)
  ) {
    throw new TypeError("Story handlers must be an array of MSW request handlers");
  }
  return { component: value["component"], handlers };
}

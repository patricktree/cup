/*
 * PROTOTYPE, throwaway: answers "what does a listener see between tapping and the next screen on a
 * first visit" for the wayfinder ticket https://github.com/patricktree/cup/issues/148.
 *
 * Four variants of the pending signal on the previous screen, switchable with `?signal=` (and the
 * panel's ‹ › or the arrow keys), plus the router's pending timings, the network delay and the
 * cold-start behavior, all as URL search params. Any change reloads the page, which is a true cold
 * start. Lives only on the branch `prototype/first-visit-pending`.
 */
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";
import React from "react";
import { createPortal } from "react-dom";

export const SIGNALS = {
  none: "A · Nothing: the previous screen just stays",
  bar: "B · Top progress bar",
  tapped: "C · The tapped control shows a spinner",
  dim: "D · The previous screen dims",
} as const;
type Signal = keyof typeof SIGNALS;

const COLD_STARTS = {
  blank: "Blank until pendingMs, then skeleton",
  skeleton: "App skeleton at once (default pending)",
} as const;
type ColdStart = keyof typeof COLD_STARTS;

const OPTIONS = {
  delayMs: [0, 100, 300, 600, 1000, 2000, 4000],
  pendingMs: [150, 300, 500, 800, 1000, 1500, 2000],
  pendingMinMs: [0, 200, 300, 500, 800],
  signalDelayMs: [0, 100, 200, 400],
};

type Settings = {
  signal: Signal;
  delayMs: number;
  pendingMs: number;
  pendingMinMs: number;
  signalDelayMs: number;
  coldStart: ColdStart;
  preload: "intent" | "off";
  start: string;
};

const DEFAULTS: Settings = {
  signal: "bar",
  delayMs: 1000,
  pendingMs: 500,
  pendingMinMs: 300,
  signalDelayMs: 100,
  coldStart: "blank",
  preload: "off",
  start: "/recent",
};

export const prototypeSettings: Settings = readSettings();

function readSettings(): Settings {
  const params = new URLSearchParams(window.location.search);
  const number = (key: keyof typeof OPTIONS) => {
    const value = Number(params.get(key));
    return params.has(key) && Number.isFinite(value) ? value : DEFAULTS[key];
  };
  const signal = params.get("signal");
  const coldStart = params.get("coldStart");
  return {
    signal: signal !== null && signal in SIGNALS ? (signal as Signal) : DEFAULTS.signal,
    delayMs: number("delayMs"),
    pendingMs: number("pendingMs"),
    pendingMinMs: number("pendingMinMs"),
    signalDelayMs: number("signalDelayMs"),
    coldStart:
      coldStart !== null && coldStart in COLD_STARTS ? (coldStart as ColdStart) : DEFAULTS.coldStart,
    preload: params.get("preload") === "intent" ? "intent" : "off",
    start: params.get("start") ?? DEFAULTS.start,
  };
}

/** Writes the settings into the URL and reloads: a cold start with the new settings. */
function applyAndColdStart(next: Partial<Settings>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ ...prototypeSettings, ...next })) {
    url.searchParams.set(key, String(value));
  }
  window.location.replace(url.href);
}

/** Router options the prototype controls. */
export function prototypeRouterOptions() {
  return {
    // "Skeleton at once" shows the pending component without delay until the first load resolves.
    defaultPendingMs: prototypeSettings.coldStart === "skeleton" ? 1 : prototypeSettings.pendingMs,
    defaultPendingMinMs: prototypeSettings.pendingMinMs,
    defaultPreload: (prototypeSettings.preload === "intent" ? "intent" : false) as "intent" | false,
    // The root and the shell have no pending component of their own, so on a cold start the router
    // finds none until auth in Recents' beforeLoad settles. A default one covers them.
    ...(prototypeSettings.coldStart === "skeleton" && { defaultPendingComponent: AppColdStartPending }),
  };
}

// ---- navigation timing log ----

type LogEntry = {
  to: string;
  heldMs: number;
  skeletonMs: number | undefined;
  totalMs: number;
};
let log: LogEntry[] = [];
const logListeners = new Set<() => void>();
let current: { to: string; startedAt: number; skeletonAt?: number } | undefined;

/** Pending components call this, so the log can tell how long the skeleton showed. */
export function useMarkSkeletonShown() {
  React.useEffect(() => {
    if (current && current.skeletonAt === undefined) {
      current.skeletonAt = performance.now();
    }
  }, []);
}

const instrumentedRouters = new WeakSet<AnyRouter>();
function instrumentRouter(router: AnyRouter) {
  if (instrumentedRouters.has(router)) {
    return;
  }
  instrumentedRouters.add(router);
  current = { to: `${prototypeSettings.start} (cold start)`, startedAt: 0 };
  router.subscribe("onBeforeNavigate", (event) => {
    current = { to: event.toLocation.pathname.replace(/^\/app/, ""), startedAt: performance.now() };
  });
  router.subscribe("onResolved", () => {
    if (!current) {
      return;
    }
    const end = performance.now();
    const shownAt = current.skeletonAt ?? end;
    log = [
      {
        to: current.to,
        heldMs: Math.round(shownAt - current.startedAt),
        skeletonMs: current.skeletonAt === undefined ? undefined : Math.round(end - current.skeletonAt),
        totalMs: Math.round(end - current.startedAt),
      },
      ...log,
    ].slice(0, 6);
    current = undefined;
    // After the cold start, later first visits use the chosen pendingMs.
    router.options.defaultPendingMs = prototypeSettings.pendingMs;
    for (const listener of logListeners) {
      listener();
    }
  });
}

function useLog() {
  return React.useSyncExternalStore(
    (listener) => {
      logListeners.add(listener);
      return () => logListeners.delete(listener);
    },
    () => log,
  );
}

// ---- the pending signal, rendered in the shell ----

let lastTapped: Element | null = null;
document.addEventListener(
  "pointerdown",
  (event) => {
    lastTapped = event.target instanceof Element ? event.target.closest("a, button") : null;
  },
  true,
);

export function PendingSignal(): React.ReactNode {
  const router = useRouter();
  instrumentRouter(router);
  const isPending = useRouterState({ select: (state) => state.status === "pending" });
  const [isShown, setIsShown] = React.useState(false);

  React.useEffect(() => {
    if (!isPending) {
      setIsShown(false);
      return;
    }
    const timer = setTimeout(() => setIsShown(true), prototypeSettings.signalDelayMs);
    return () => clearTimeout(timer);
  }, [isPending]);

  React.useEffect(() => {
    if (!isShown) {
      return;
    }
    const { signal } = prototypeSettings;
    const root = document.querySelector("#root");
    const tapped = lastTapped;
    if (signal === "tapped") {
      tapped?.setAttribute("data-prototype-pending", "");
    }
    if (signal === "dim") {
      root?.setAttribute("data-prototype-dim", "");
    }
    return () => {
      tapped?.removeAttribute("data-prototype-pending");
      root?.removeAttribute("data-prototype-dim");
    };
  }, [isShown]);

  return (
    <>
      <style>{SIGNAL_CSS}</style>
      {isShown && prototypeSettings.signal === "bar" && <div className="prototype-bar" />}
    </>
  );
}

const SIGNAL_CSS = `
.prototype-bar {
  position: fixed; inset: 0 0 auto 0; z-index: 1000; height: 3px; overflow: hidden;
  background: color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.prototype-bar::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 40%;
  background: var(--color-ink);
  animation: prototype-bar 1s ease-in-out infinite;
}
@keyframes prototype-bar { from { transform: translateX(-100%); } to { transform: translateX(250%); } }

[data-prototype-pending] { position: relative; }
[data-prototype-pending] > * { opacity: 0.45; transition: opacity 150ms; }
[data-prototype-pending]::after {
  content: ""; position: absolute; inset-block-start: 50%; inset-inline-start: 50%;
  width: 22px; height: 22px; margin: -11px 0 0 -11px; box-sizing: border-box;
  border: 2.5px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
  border-top-color: var(--color-ink); border-radius: 50%;
  animation: prototype-spin 700ms linear infinite;
}
@keyframes prototype-spin { to { transform: rotate(360deg); } }

#root { transition: opacity 200ms; }
#root[data-prototype-dim] { opacity: 0.5; pointer-events: none; }
`;

/** A generic skeleton for routes without their own, shown on a cold start before a route's own. */
export function AppColdStartPending(): React.ReactNode {
  useMarkSkeletonShown();
  const block = (height: number, width = "100%"): React.CSSProperties => ({
    height,
    width,
    background: "var(--color-placeholder)",
    borderRadius: 12,
  });
  return (
    <div style={{ display: "grid", gap: 16, alignContent: "start", minHeight: "100dvh", padding: "24px 12px", background: "var(--color-surface)" }}>
      <div style={block(32, "40%")} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={block(220)} />
        <div style={block(180)} />
        <div style={block(160)} />
        <div style={block(220)} />
      </div>
    </div>
  );
}

// ---- the control panel ----

export function PrototypePanel(): React.ReactNode {
  const [isOpen, setIsOpen] = React.useState(false);
  const entries = useLog();
  const settings = prototypeSettings;
  const signalKeys = Object.keys(SIGNALS) as Signal[];
  const cycleSignal = (step: number) => {
    const index = signalKeys.indexOf(settings.signal);
    applyAndColdStart({
      signal: signalKeys[(index + step + signalKeys.length) % signalKeys.length] ?? "none",
    });
  };

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      if (event.key === "ArrowLeft") cycleSignal(-1);
      if (event.key === "ArrowRight") cycleSignal(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const select = (key: keyof typeof OPTIONS, label: string) => (
    <label style={rowStyle}>
      <span>{label}</span>
      <select
        value={settings[key]}
        onChange={(event) => applyAndColdStart({ [key]: Number(event.target.value) })}
      >
        {OPTIONS[key].map((value) => (
          <option key={value} value={value}>
            {value} ms
          </option>
        ))}
      </select>
    </label>
  );

  if (!isOpen) {
    return createPortal(
      <button type="button" style={chipStyle} onClick={() => setIsOpen(true)} aria-label="Open prototype panel">
        {settings.signal === "none" ? "A" : settings.signal === "bar" ? "B" : settings.signal === "tapped" ? "C" : "D"}
        {entries[0] && (
          <small style={{ display: "block", opacity: 0.75 }}>
            {entries[0].skeletonMs === undefined ? "" : "skel "}
            {entries[0].totalMs}
          </small>
        )}
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" style={buttonStyle} onClick={() => cycleSignal(-1)} aria-label="Previous signal">
          ‹
        </button>
        <strong style={{ flex: 1 }}>{SIGNALS[settings.signal]}</strong>
        <button type="button" style={buttonStyle} onClick={() => cycleSignal(1)} aria-label="Next signal">
          ›
        </button>
        <button type="button" style={buttonStyle} onClick={() => setIsOpen(false)}>
          Close
        </button>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {select("delayMs", "Network delay per API request")}
          {select("pendingMs", "pendingMs (hold before skeleton)")}
          {select("pendingMinMs", "pendingMinMs (skeleton at least)")}
          {select("signalDelayMs", "Signal appears after")}
          <label style={rowStyle}>
            <span>Cold start</span>
            <select
              value={settings.coldStart}
              onChange={(event) => applyAndColdStart({ coldStart: event.target.value as ColdStart })}
            >
              {Object.entries(COLD_STARTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={rowStyle}>
            <span>Preload on intent (hover / touchstart)</span>
            <select
              value={settings.preload}
              onChange={(event) => applyAndColdStart({ preload: event.target.value as Settings["preload"] })}
            >
              <option value="off">off (worst case)</option>
              <option value="intent">intent</option>
            </select>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span>Cold start at:</span>
            {COLD_START_PATHS.map(([path, label]) => (
              <button key={path} type="button" style={buttonStyle} onClick={() => applyAndColdStart({ start: path })}>
                {label}
              </button>
            ))}
          </div>
          <div>
            <strong>Last navigations</strong> (held = previous screen kept, skel = skeleton shown)
            {entries.map((entry, index) => (
              <LogLine key={index} entry={entry} />
            ))}
          </div>
          <small style={{ opacity: 0.7 }}>
            First visit: tap a card, the avatar, or Back after a deep link. Revisit: go back and tap
            the same card again. Every change here reloads the page (a cold start). The chip on the
            left shows the variant and the last navigation's total time.
          </small>
      </div>
    </div>,
    document.body,
  );
}

export const COLD_START_PATHS = [
  ["/recent", "Recents"],
  ["/audiobooks/00000000-0000-4000-8000-000000000001", "Detail (deep link)"],
  ["/recent/account", "Account dialog"],
] as const;

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 11, opacity: 0.85 }}>
      {entry.to}: held {entry.heldMs} ms
      {entry.skeletonMs === undefined ? ", no skeleton" : `, skel ${entry.skeletonMs} ms`}, total{" "}
      {entry.totalMs} ms
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  insetBlockStart: "20%",
  insetInline: 8,
  zIndex: 2000,
  maxWidth: 420,
  marginInline: "auto",
  padding: 8,
  font: "12px system-ui",
  color: "#fff",
  background: "rgb(20 20 30 / 0.92)",
  borderRadius: 12,
  boxShadow: "0 4px 16px rgb(0 0 0 / 0.3)",
  // keeps the panel out of the dim variant, which dims #root
  pointerEvents: "auto",
};
const chipStyle: React.CSSProperties = {
  position: "fixed",
  insetBlockStart: "40%",
  insetInlineStart: 0,
  zIndex: 2000,
  padding: "8px 6px",
  font: "600 13px system-ui",
  color: "#fff",
  background: "rgb(20 20 30 / 0.8)",
  border: 0,
  borderRadius: "0 10px 10px 0",
};
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
const buttonStyle: React.CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "rgb(255 255 255 / 0.12)",
  border: 0,
  borderRadius: 8,
  padding: "6px 10px",
};

import { css } from "@linaria/core";
import { delay, http, HttpResponse } from "msw";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { DSCoverImage } from "#src/app/design-system/cover-image.js";
import { DSIconButton } from "#src/app/design-system/icon-button.js";
import {
  AvatarRingIcon,
  BackChevronIcon,
  MoreIcon,
  PauseIcon,
  PauseMiniIcon,
  PlayIcon,
  SkipBack15Icon,
  SkipForward15Icon,
  TabAddIcon,
  TabRecentIcon,
} from "#src/app/design-system/icons.js";
import { DSInput } from "#src/app/design-system/input.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";
import type { Story } from "#src/ui-gallery/story.js";

export function Components(): React.ReactNode {
  const [clickCount, setClickCount] = React.useState(0);

  return (
    <main>
      <h1>Design system</h1>

      <h2>Buttons</h2>
      <div className={composeClassnames(componentsGrid)}>
        {(["outlined", "contained", "text"] as const).map((variant) => (
          <section
            key={variant}
            aria-label={`${variant} buttons`}
            className={composeClassnames(
              componentsGrid,
              css`
                justify-items: center;
              `,
            )}
          >
            <h3
              className={css`
                justify-self: start;
              `}
            >
              {variant}
            </h3>
            <DSButton variant={variant} onClick={() => setClickCount((count) => count + 1)}>
              Record click
            </DSButton>
            <DSButton variant={variant} disabled>
              Disabled
            </DSButton>
            <DSButton variant={variant} isPending>
              Working
            </DSButton>
          </section>
        ))}
      </div>
      <output>Clicks: {clickCount}</output>

      <h2>Inputs</h2>
      <div
        className={composeClassnames(
          componentsGrid,
          css`
            justify-items: start;
          `,
        )}
      >
        <DSInput label="Text" placeholder="Enter text" />
        <DSInput label="Email" type="email" placeholder="you@example.com" />
        <DSInput label="Password" type="password" placeholder="Enter a password" />
        <DSInput label="URL" type="url" placeholder="https://example.com" />
        <DSInput label="Required" required placeholder="Required text" />
        <DSInput label="Disabled" disabled value="Disabled input" />
        <DSInput label="Invalid" errorMessage="Please enter a valid value." />
        <DSInput label="Hidden label" hideLabel placeholder="Hidden label" />
      </div>
    </main>
  );
}

const componentsGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: calc(3 * var(--spacing-base));
  align-items: start;
`;

const COLOR_TOKENS = [
  "--color-ink",
  "--color-ink-60",
  "--color-ink-40",
  "--color-ink-24",
  "--color-ink-8",
  "--color-ink-4",
  "--color-page",
  "--color-surface",
  "--color-placeholder",
  "--color-error",
];

const TEXT_STYLES = [
  ["H1", textStyles.h1],
  ["H2", textStyles.h2],
  ["H3", textStyles.h3],
  ["H4", textStyles.h4],
  ["H5", textStyles.h5],
  ["Paragraph", textStyles.paragraph],
  ["Tagline", textStyles.tagline],
  ["Label", textStyles.label],
  ["Callout", textStyles.callout],
] as const;

const ICONS = [
  ["avatar-ring", AvatarRingIcon],
  ["tab-recent", TabRecentIcon],
  ["tab-add", TabAddIcon],
  ["back-chevron", BackChevronIcon],
  ["more", MoreIcon],
  ["pause-mini", PauseMiniIcon],
  ["skip-back-15", SkipBack15Icon],
  ["skip-forward-15", SkipForward15Icon],
  ["pause", PauseIcon],
  ["play", PlayIcon],
] as const;

const COVER_PATH = "/__story/covers";

export function Colors(): React.ReactNode {
  return (
    <main {...interTypefaceScope} className={page}>
      <h1 className={textStyles.h1}>Colors</h1>
      <ul className={grid}>
        {COLOR_TOKENS.map((token) => (
          <li key={token} className={swatch}>
            <span
              className={css`
                justify-self: stretch;
                height: 48px;
                border: 1px solid var(--color-ink-8);
                border-radius: var(--border-radius-lg);
              `}
              style={{ backgroundColor: `var(${token})` }}
            />
            <span className={textStyles.label}>{token}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function TextStyles(): React.ReactNode {
  return (
    <main {...interTypefaceScope} className={page}>
      <h1 className={textStyles.h1}>Text styles</h1>
      {TEXT_STYLES.map(([name, className]) => (
        <p key={name} className={className}>
          {name}: Just listen to the long read you saved for later.
        </p>
      ))}
    </main>
  );
}

export function Icons(): React.ReactNode {
  return (
    <main {...interTypefaceScope} className={page}>
      <h1 className={textStyles.h1}>Icons</h1>
      <ul className={grid}>
        {ICONS.map(([name, Icon]) => (
          <li key={name} className={swatch}>
            <Icon />
            <span className={textStyles.label}>{name}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function IconButtons(): React.ReactNode {
  return (
    <main {...interTypefaceScope} className={page}>
      <h1 className={textStyles.h1}>Icon buttons</h1>
      {([false, true] as const).map((isDisabled) => (
        <section
          key={String(isDisabled)}
          aria-label={isDisabled ? "Disabled" : "Enabled"}
          className={css`
            display: flex;
            flex-wrap: wrap;
            gap: var(--spacing-gutter);
            align-items: center;
          `}
        >
          <DSIconButton label="Back" icon={<BackChevronIcon />} disabled={isDisabled} />
          <DSIconButton label="More" icon={<MoreIcon />} disabled={isDisabled} />
          <DSIconButton label="Back 15 seconds" icon={<SkipBack15Icon />} disabled={isDisabled} />
          <DSIconButton label="Play" icon={<PlayIcon />} disabled={isDisabled} />
          <DSIconButton label="Pause" icon={<PauseIcon />} disabled={isDisabled} />
          <DSIconButton
            label="Forward 15 seconds"
            icon={<SkipForward15Icon />}
            disabled={isDisabled}
          />
        </section>
      ))}
    </main>
  );
}

export const CoverImages = {
  component: () => (
    <main {...interTypefaceScope} className={page}>
      <h1 className={textStyles.h1}>Cover images</h1>
      <div
        className={css`
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 183px));
          gap: var(--spacing-gutter);
          align-items: start;
        `}
      >
        <DSCoverImage src={`${COVER_PATH}/first.svg`} alt="Loaded cover" />
        <DSCoverImage src={`${COVER_PATH}/never.svg`} alt="Loading cover" />
        <DSCoverImage
          src={`${COVER_PATH}/first.svg`}
          alt="Circular cover"
          shape="circle"
          className={css`
            width: 41px;
          `}
        />
      </div>
    </main>
  ),
  handlers: [
    coverHandler("first", "#5b7f95"),
    http.get(`${COVER_PATH}/never.svg`, async () => {
      await delay("infinite");
    }),
  ],
} satisfies Story;

/** The second cover loads only once "Finish loading" is pressed. */
let secondCoverGate = createGate();

export const CoverImageSwap = {
  component: function CoverImageSwap() {
    const [cover, setCover] = React.useState("first");

    return (
      <main {...interTypefaceScope} className={page}>
        <div
          className={css`
            width: 183px;
          `}
        >
          <DSCoverImage src={`${COVER_PATH}/${cover}.svg`} alt={`${cover} cover`} />
        </div>
        <button type="button" onClick={() => setCover("second")}>
          Show second cover
        </button>
        <button type="button" onClick={() => secondCoverGate.open()}>
          Finish loading
        </button>
      </main>
    );
  },
  beforeMount: async () => {
    secondCoverGate = createGate();
  },
  handlers: [
    coverHandler("first", "#5b7f95"),
    http.get(`${COVER_PATH}/second.svg`, async () => {
      await secondCoverGate.promise;
      return coverResponse("#c4733d");
    }),
  ],
} satisfies Story;

function coverHandler(name: string, color: string) {
  return http.get(`${COVER_PATH}/${name}.svg`, () => coverResponse(color));
}

/** A flat-colored cover wider than 5:3, so the crop shows. */
function coverResponse(color: string) {
  return new HttpResponse(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${color}"/><circle cx="200" cy="100" r="60" fill="#fff"/></svg>`,
    { headers: { "Content-Type": "image/svg+xml" } },
  );
}

const page = css`
  display: grid;
  gap: calc(2 * var(--spacing-gutter));
  padding: var(--spacing-gutter);
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--spacing-gutter);
  padding: 0;
  list-style: none;
`;

const swatch = css`
  display: grid;
  gap: var(--spacing-base);
  justify-items: start;
`;

/** A promise that settles once `open` is called. */
function createGate() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, open: () => resolvePromise?.() };
}

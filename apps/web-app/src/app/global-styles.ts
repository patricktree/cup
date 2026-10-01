/** Cross-browser baseline styles applied before application styles. */
export const cssReset = css`
  @layer reset {
    /* based on https://www.joshwcomeau.com/css/custom-css-reset/ */

    /* 1. Use a more-intuitive box-sizing model */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    /* 2. Remove default margin */
    *:not(dialog) {
      margin: 0;
    }

    /* 3. Enable keyword animations */
    @media (prefers-reduced-motion: no-preference) {
      html {
        interpolate-size: allow-keywords;
      }
    }

    body {
      /* 4. Increase line-height */
      line-height: 1.5;
      /* 5. Improve text rendering */
      -webkit-font-smoothing: antialiased;
    }

    /* 6. Improve media defaults */
    img,
    picture,
    video,
    canvas,
    svg {
      display: block;
      max-width: 100%;
    }

    /* 7. Inherit fonts for form controls */
    input,
    button,
    textarea,
    select {
      font: inherit;
    }

    /* 8. Avoid text overflows */
    p,
    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      overflow-wrap: break-word;
    }

    /* 9. Improve line wrapping */
    p {
      text-wrap: pretty;
    }
    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      text-wrap: balance;
    }

    /*
      10. Create a root stacking context
      (also for https://base-ui.com/react/overview/quick-start#portals)
    */
    #root,
    #__next {
      isolation: isolate;
    }
  }
`;

/** Global design tokens and base document styles. */
export const cssBase = css`
  @layer base {
    :root {
      /* https://base-ui.com/react/overview/quick-start#ios-26-safari */
      position: relative;

      font-family: var(--font-family-1);
      font-size: ${16 / 16}rem;
      color: var(--color-fg);
      background-color: var(--color-bg);
      --font-family-1: "Inter Variable", sans-serif;
      --font-family-2: "Space Mono", monospace;

      /* design tokens */
      --color-white: #f2f2f2;
      --color-black-hsl: 0 0% 12%;
      --color-black: hsl(var(--color-black-hsl));
      --color-fg: var(--color-black);
      --color-bg: var(--color-white);
      --color-input-bg: #fff;
      --color-surface-translucent: rgb(255 255 255 / 24%);
      --color-error: #b42318;
      --color-primary-hsl: var(--color-black-hsl);
      --color-primary: hsl(var(--color-primary-hsl));
      --color-fg-emphasized-sm: hsl(var(--color-black-hsl) / 65%);
      --color-fg-emphasized-xs: hsl(var(--color-black-hsl) / 45%);

      --font-size-sm: 14px;
      --font-size-md: 16px;
      --font-size-lg: 18px;
      --font-size-display: 36px;
      --font-weight-inter-figma-medium: 500;
      --line-height-display: 55px;

      --spacing-base: 8px;
      --app-padding-block: var(--spacing-base);
      --app-padding-inline: calc(2 * var(--spacing-base));
      --app-max-width: 800px;

      --border-radius-sm: 4px;
      --border-radius-lg: 24px;
    }

    ::selection {
      color: var(--color-bg);
      background: var(--color-fg);
    }

    a {
      color: inherit;
      text-underline-offset: 0.2em;
    }

    html,
    body,
    #root {
      height: 100%;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      font-family: var(--font-family-1);
    }
    span,
    input {
      font-family: var(--font-family-2);
    }
  }
`;

/**
 * Returns a template string through a `css` tag that triggers CSS syntax highlighting in the VS
 * Code extension
 * [`styled-components.vscode-styled-components`](https://marketplace.visualstudio.com/items?itemName=styled-components.vscode-styled-components).
 *
 * @param strings - The static segments of the tagged template.
 * @param args - The interpolated string or number values.
 * @returns The concatenated CSS source.
 */
function css(strings: TemplateStringsArray, ...args: Array<string | number>): string {
  let result = strings[0] ?? "";
  for (const [index, argument] of args.entries()) {
    result += `${argument}${strings[index + 1]}`;
  }
  return result;
}

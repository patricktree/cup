import { css } from "@linaria/core";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { DSInput } from "#src/app/design-system/input.js";

export function Components(): React.ReactNode {
  const [clickCount, setClickCount] = React.useState(0);

  return (
    <main>
      <h1>Design system</h1>
      <h2>Buttons</h2>
      <div className={grid}>
        {(["outlined", "contained", "text"] as const).map((variant) => (
          <section key={variant} aria-label={`${variant} buttons`} className={grid}>
            <h3>{variant}</h3>
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
      <div className={grid}>
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

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: calc(3 * var(--spacing-base));
  align-items: start;
`;

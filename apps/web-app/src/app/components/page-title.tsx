import React from "react";

/**
 * Names the screen in the document title while it is mounted. React hoists the `<title>` into the
 * document head, in front of every title already there, so the screen mounted last names the page:
 * a dialog over Recents takes over the title while it is open, and Recents' title returns when it
 * closes. Without one, such as on the start page, the static title in `index.html` applies.
 */
export function PageTitle({ name }: { name: string }): React.JSX.Element {
  return <title>{`${name} · Cup`}</title>;
}

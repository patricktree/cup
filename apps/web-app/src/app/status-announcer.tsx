import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import React from "react";

import { visuallyHidden } from "#src/app/utils.js";

type Announce = (message: string) => void;

const StatusAnnouncerContext = React.createContext<Announce | null>(null);

/**
 * Renders the shell's one polite live region, for outcomes that have no place on screen, such as a
 * deletion that left the page it started on. The region exists before any message, because screen
 * readers often skip a region inserted together with its text.
 */
export function StatusAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState("");

  return (
    <StatusAnnouncerContext value={setMessage}>
      {children}
      <output className={visuallyHidden}>{message}</output>
    </StatusAnnouncerContext>
  );
}

export function useAnnounceStatus(): Announce {
  const announce = React.use(StatusAnnouncerContext);
  check.assert(announce, "useAnnounceStatus must be used below StatusAnnouncerProvider.");
  return announce;
}

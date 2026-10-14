import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import { ConversionShell } from "#src/app/components/conversion-shell.jsx";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  return (
    <ConversionShell>
      <StartConversionForm mode="account" />
    </ConversionShell>
  );
}

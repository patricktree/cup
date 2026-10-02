import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import { ConversionEntryPage } from "#src/app/components/conversion-entry-page.js";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  return (
    <ConversionEntryPage>
      <StartConversionForm mode="account" />
    </ConversionEntryPage>
  );
}

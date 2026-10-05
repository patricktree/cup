import { launch, type BrowserWorker } from "@cloudflare/playwright";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { selectNarrationContent } from "@cup/narration-content-selection";
import { prepareSourceMaterial } from "@cup/prepare-source-material";

import {
  runPrepareAudiobookWorkflow,
  type ConversionParams,
} from "#src/run-prepare-audiobook-workflow.ts";
import { parseSourcePageCookies } from "#src/source-page-cookies.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

type ProductionWorkflowEnvironment = AudiobookWorkflowEnvironment & {
  BROWSER: BrowserWorker;
  SOURCE_PAGE_COOKIES_JSON?: string;
};

/** Prepares the narration document from a source URL with production providers. */
export class PrepareAudiobookWorkflow extends WorkflowEntrypoint<
  ProductionWorkflowEnvironment,
  ConversionParams
> {
  override run(event: WorkflowEvent<ConversionParams>, step: WorkflowStep) {
    const cookies = parseSourcePageCookies(this.env.SOURCE_PAGE_COOKIES_JSON);

    return runPrepareAudiobookWorkflow({
      env: this.env,
      event: { ...event, payload: event.payload },
      step,
      services: {
        prepareSourceMaterial: async (sourceUrl) => {
          const browser = await launch(this.env.BROWSER);

          try {
            return await prepareSourceMaterial({ browser, cookies, url: sourceUrl });
          } finally {
            await browser.close();
          }
        },
        selectNarrationContent,
      },
    });
  }
}

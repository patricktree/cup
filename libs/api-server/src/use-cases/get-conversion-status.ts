import { loadAudiobook, type Audiobook, type AudiobookReference } from "@cup/audiobook-production";
import { createConversionArtifactPrefix } from "@cup/conversion-contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { ConversionConflictError } from "#src/errors.ts";

type WorkflowInstance = Awaited<
  ReturnType<ApiServerEnvironment["CREATE_AUDIOBOOK_FROM_URL_WORKFLOW"]["get"]>
>;
type WorkflowInstanceStatus = Awaited<ReturnType<WorkflowInstance["status"]>>;
type StatusEnvironment = Pick<
  ApiServerEnvironment,
  "CREATE_AUDIOBOOK_FROM_URL_WORKFLOW" | "AUDIO_BUCKET"
>;

/** Application-level pending, ready, or failed state of a conversion. */
export type ConversionStatus =
  | { status: "pending" }
  | { status: "ready"; audiobook: Audiobook }
  | { status: "failed"; error: WorkflowInstanceStatus["error"] };

/** Translates the durable workflow state into the public conversion status. */
export async function getConversionStatus(
  env: StatusEnvironment,
  conversionId: string,
): Promise<ConversionStatus> {
  const workflowInstance = await env.CREATE_AUDIOBOOK_FROM_URL_WORKFLOW.get(conversionId);
  const workflowStatus = await workflowInstance.status();

  if (workflowStatus.status === "complete") {
    const audiobookReference = parseAudiobookReference(workflowStatus.output, conversionId);

    if (audiobookReference === undefined) {
      throw new ConversionConflictError("This conversion does not have a valid stored audiobook.");
    }

    try {
      const audiobook = await loadAudiobook({
        bucket: env.AUDIO_BUCKET,
        audiobookReference,
      });

      return { status: "ready", audiobook };
    } catch (error) {
      throw new ConversionConflictError("This conversion does not have a valid stored audiobook.", {
        cause: error,
      });
    }
  }

  if (workflowStatus.status === "errored" || workflowStatus.status === "terminated") {
    return { status: "failed", error: workflowStatus.error };
  }

  return { status: "pending" };
}

function parseAudiobookReference(
  output: unknown,
  conversionId: string,
): AudiobookReference | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }

  if (
    !("contentType" in output) ||
    output.contentType !== "application/json" ||
    !("key" in output) ||
    output.key !== `${createConversionArtifactPrefix(conversionId)}audiobook.json` ||
    !("byteLength" in output) ||
    typeof output.byteLength !== "number" ||
    !Number.isSafeInteger(output.byteLength) ||
    output.byteLength <= 0 ||
    !("etag" in output) ||
    typeof output.etag !== "string" ||
    output.etag.length === 0
  ) {
    return undefined;
  }

  return {
    key: output.key,
    contentType: output.contentType,
    byteLength: output.byteLength,
    etag: output.etag,
  };
}

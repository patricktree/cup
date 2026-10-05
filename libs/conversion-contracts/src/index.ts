import { z } from "zod";

export const conversionFailureCategories = [
  "workflow-start",
  "source-preparation",
  "content-selection",
  "content-limit",
  "narration-synthesis",
  "audiobook-assembly",
  "workflow-platform",
  "internal",
] as const;
export const conversionFailureCategorySchema = z.enum(conversionFailureCategories);
export type ConversionFailureCategory = z.infer<typeof conversionFailureCategorySchema>;

export const ConversionPhase = {
  CONVERSION_START: "conversion-start",
  SOURCE_MATERIAL_PREPARATION: "source-material-preparation",
  NARRATION_CONTENT_SELECTION: "narration-content-selection",
  NARRATION_DOCUMENT_CREATION: "narration-document-creation",
  AUDIO_SEGMENT_PRODUCTION: "audio-segment-production",
  AUDIOBOOK_ASSEMBLY: "audiobook-assembly",
  AUDIOBOOK_STORAGE: "audiobook-storage",
  FINALIZATION: "finalization",
} as const;
export const conversionPhaseSchema = z.enum(ConversionPhase);
export type ConversionPhase = z.infer<typeof conversionPhaseSchema>;
export const conversionPhaseOrder = [
  ConversionPhase.CONVERSION_START,
  ConversionPhase.SOURCE_MATERIAL_PREPARATION,
  ConversionPhase.NARRATION_CONTENT_SELECTION,
  ConversionPhase.NARRATION_DOCUMENT_CREATION,
  ConversionPhase.AUDIO_SEGMENT_PRODUCTION,
  ConversionPhase.AUDIOBOOK_ASSEMBLY,
  ConversionPhase.AUDIOBOOK_STORAGE,
  ConversionPhase.FINALIZATION,
] as const satisfies ReadonlyArray<ConversionPhase>;

export const durationBalanceSchema = z
  .object({
    availableMilliseconds: z.number().int().min(0),
    reservedMilliseconds: z.number().int().min(0),
    spentMilliseconds: z.number().int().min(0),
  })
  .strict();
export type DurationBalance = z.infer<typeof durationBalanceSchema>;

export const conversionOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trial"), grantId: z.uuidv4() }).strict(),
  z.object({ kind: z.literal("account"), accountId: z.uuidv4() }).strict(),
]);
export type ConversionOwner = z.infer<typeof conversionOwnerSchema>;

export const playbackPositionSchema = z
  .object({
    synchronizationUnitId: z.string().min(1).max(128),
    offsetMilliseconds: z.number().finite().nonnegative().max(3_600_000),
  })
  .strict();
export type PlaybackPosition = z.infer<typeof playbackPositionSchema>;

export const segmentWorkflowParamsSchema = z
  .object({
    v: z.literal(3),
    conversionId: z.uuidv4(),
    owner: conversionOwnerSchema,
    executionEpoch: z.number().int().positive().safe(),
    sequence: z.number().int().min(0).max(199),
  })
  .strict();
export type SegmentWorkflowParams = z.infer<typeof segmentWorkflowParamsSchema>;

export type SynthesisWorkflowDispatcher = {
  create(input: { id: string; params: SegmentWorkflowParams }): Promise<unknown>;
  get(id: string): Promise<{
    status(): Promise<{ status: string; error?: { message: string } }>;
    restart(): Promise<void>;
  }>;
};

/** Called under the owner's concurrency gate so explicit retries cannot restart each other. */
export async function dispatchSegmentWorkflow(
  workflow: SynthesisWorkflowDispatcher,
  params: SegmentWorkflowParams,
  retry: boolean,
) {
  const id = `segment-${params.conversionId}-${params.sequence}`;
  try {
    await workflow.create({ id, params });
    return { status: "queued" };
  } catch {
    // Creation can succeed before its response is lost. Resolve through the stable identity.
    const instance = await workflow.get(id);
    const result = await instance.status();
    if (retry && (result.status === "errored" || result.status === "terminated")) {
      await instance.restart();
      return { status: "queued" };
    }
    return result;
  }
}

export type AudiobookReference = {
  key: string;
  contentType: "application/json";
  byteLength: number;
  etag: string;
};

export type ConversionMeasurements = {
  narrationTextCharacters: number;
  narrationChunks: number;
};

export {
  createAccountArtifactPrefix,
  createConversionArtifactPrefix,
  getAccountConversionIdFromArtifactPrefix,
} from "#src/artifact-prefix.ts";

export {
  sourceUrlSchema,
  conversionParamsSchema,
  type ConversionParams,
  type TrialWorkflowParams,
} from "#src/preparation-workflow-params.ts";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";

import {
  audiobookSchema,
  retryConversionResponseSchema,
  segmentParamsSchema,
  playbackPositionSchema,
  authConfigResponseSchema,
  accountSnapshotSchema,
  accountHistorySchema,
  accountStartResponseSchema,
  deletionChallengeSchema,
  accountConfirmationSchema,
  browserMutationHeadersSchema,
  conversionParamsSchema,
  errorResponseSchema,
  exchangeCredentialRequestSchema,
  conversionDetailSchema,
  grantParamsSchema,
  grantSnapshotSchema,
  startConversionHeadersSchema,
  startConversionRequestSchema,
  startConversionResponseSchema,
} from "#src/contracts.ts";

type ErrorResponseDefinition = {
  content?: { "application/json": { schema: typeof errorResponseSchema } };
  description: string;
};

const errorResponse = (description: string): ErrorResponseDefinition => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});
const binarySchema = z.string().openapi({ type: "string", format: "binary" });
const routeBrowserMutationHeadersSchema = browserMutationHeadersSchema.omit({
  "content-type": true,
});
const routeStartConversionHeadersSchema = startConversionHeadersSchema.omit({
  "content-type": true,
});

const authConfigRoute = createRoute({
  method: "get",
  path: "/api/auth/config",
  responses: {
    500: errorResponse("Unavailable."),
    200: {
      description: "Public sign-in configuration.",
      content: {
        "application/json": {
          schema: authConfigResponseSchema,
        },
      },
    },
  },
});

const getAccountRoute = createRoute({
  method: "get",
  path: "/api/account",
  responses: {
    200: {
      content: { "application/json": { schema: accountSnapshotSchema } },
      description: "Account and allowance.",
    },
    401: errorResponse("Sign in required."),
    403: errorResponse("Account blocked."),
    429: errorResponse("Rate limited."),
    503: errorResponse("Account setup unavailable."),
  },
});

const lifecycleResponses = {
  400: errorResponse("Invalid confirmation."),
  401: errorResponse("Sign in required."),
  403: errorResponse("Access blocked."),
  409: errorResponse("Confirmation unavailable."),
  429: errorResponse("Rate limited."),
  500: errorResponse("Operational error."),
  503: errorResponse("Account setup unavailable."),
};
const deletionChallengeRoute = createRoute({
  method: "post",
  path: "/api/account/deletion/challenge",
  request: {
    headers: routeBrowserMutationHeadersSchema,
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    ...lifecycleResponses,
    200: {
      description: "Fresh authentication challenge.",
      content: {
        "application/json": {
          schema: deletionChallengeSchema,
        },
      },
    },
  },
});
const scheduleDeletionRoute = createRoute({
  method: "post",
  path: "/api/account/deletion",
  request: {
    headers: routeBrowserMutationHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: accountConfirmationSchema } },
    },
  },
  responses: {
    ...lifecycleResponses,
    200: {
      description: "Deletion scheduled.",
      content: {
        "application/json": {
          schema: z.object({
            state: z.literal("deletion_scheduled"),
            recoveryDeadlineMs: z.number().optional(),
          }),
        },
      },
    },
  },
});
const restoreAccountRoute = createRoute({
  method: "post",
  path: "/api/account/deletion/restore",
  request: {
    headers: routeBrowserMutationHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: accountConfirmationSchema } },
    },
  },
  responses: {
    ...lifecycleResponses,
    200: {
      description: "Account restored.",
      content: { "application/json": { schema: accountSnapshotSchema } },
    },
  },
});
const historyRoute = createRoute({
  method: "get",
  path: "/api/account/conversions",
  request: {
    query: z.object({
      cursor: z
        .string()
        .regex(/^\d+:[0-9a-f-]{36}$/)
        .optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: accountHistorySchema,
        },
      },
      description: "Private account history.",
    },
    401: errorResponse("Sign in required."),
    403: errorResponse("Account blocked."),
    503: errorResponse("Unavailable."),
  },
});
const filesSessionRoute = createRoute({
  method: "post",
  path: "/api/files/session",
  request: {
    headers: routeBrowserMutationHeadersSchema,
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    204: { description: "Media cookie issued." },
    401: errorResponse("Sign in required."),
    403: errorResponse("Account blocked."),
    503: errorResponse("Unavailable."),
  },
});
const clearFilesSessionRoute = createRoute({
  method: "delete",
  path: "/api/files/session",
  request: { headers: routeBrowserMutationHeadersSchema },
  responses: {
    204: { description: "Media cookie removed." },
    403: errorResponse("Origin blocked."),
  },
});

const startAccountConversionRoute = createRoute({
  method: "post",
  path: "/api/account/conversions",
  request: {
    headers: routeStartConversionHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: startConversionRequestSchema } },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: accountStartResponseSchema } },
      description: "Account conversion accepted.",
    },
    200: {
      content: { "application/json": { schema: accountStartResponseSchema } },
      description: "Account conversion replayed.",
    },
    401: errorResponse("Sign in required."),
    403: errorResponse("Account blocked."),
    409: errorResponse("Credits unavailable or request conflict."),
    503: errorResponse("Account unavailable."),
  },
});

const exchangeSessionRoute = createRoute({
  method: "post",
  path: "/api/grants/{grantId}/sessions",
  request: {
    params: grantParamsSchema,
    headers: routeBrowserMutationHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: exchangeCredentialRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: grantSnapshotSchema } },
      description: "Grant session created.",
    },
    400: errorResponse("Invalid request."),
    401: errorResponse("Invalid credential."),
    403: errorResponse("Grant revoked."),
    500: errorResponse("Operational error."),
    503: errorResponse("Dependency unavailable."),
  },
});

const getGrantRoute = createRoute({
  method: "get",
  path: "/api/grants/{grantId}",
  request: { params: grantParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: grantSnapshotSchema } },
      description: "Authoritative grant snapshot.",
    },
    401: errorResponse("Grant session required or invalid."),
    500: errorResponse("Operational error."),
  },
});

const getConversionRoute = createRoute({
  method: "get",
  path: "/api/conversions/{conversionId}",
  request: { params: conversionParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: conversionDetailSchema } },
      description: "conversion.",
    },
    401: errorResponse("Grant session required or invalid."),
    404: errorResponse("Conversion not found."),
    500: errorResponse("Operational error."),
  },
});

const startTrialConversionRoute = createRoute({
  method: "post",
  path: "/api/grants/{grantId}/conversions",
  request: {
    params: grantParamsSchema,
    headers: routeStartConversionHeadersSchema,
    body: {
      required: true,
      content: { "application/json": { schema: startConversionRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: startConversionResponseSchema } },
      description: "Conversion replayed.",
    },
    202: {
      content: { "application/json": { schema: startConversionResponseSchema } },
      description: "Conversion accepted.",
    },
    400: errorResponse("Invalid request."),
    401: errorResponse("Grant session required or invalid."),
    403: errorResponse("Grant blocks starts."),
    409: errorResponse("Grant state or idempotency conflict."),
    429: errorResponse("Start rate limit exceeded."),
    500: errorResponse("Operational error."),
  },
});

const audiobookRoute = createRoute({
  method: "get",
  path: "/api/audiobooks/{conversionId}",
  request: { params: conversionParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: audiobookSchema } },
      description: "Unlisted audiobook.",
    },
    404: errorResponse("Audiobook not found."),
    500: errorResponse("Operational error."),
  },
});

const retryConversionRoute = createRoute({
  method: "post",
  path: "/api/audiobooks/{conversionId}/retry",
  request: {
    params: conversionParamsSchema,
    headers: routeBrowserMutationHeadersSchema,
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: retryConversionResponseSchema } },
      description: "Preparation restarted, or the outcome of requesting the missing segments.",
    },
    401: errorResponse("Authorization required."),
    403: errorResponse("Blocked."),
    404: errorResponse("Not found."),
    500: errorResponse("Unavailable."),
  },
});
const savePositionRoute = createRoute({
  method: "put",
  path: "/api/audiobooks/{conversionId}/position",
  request: {
    params: conversionParamsSchema,
    headers: routeBrowserMutationHeadersSchema,
    body: { required: true, content: { "application/json": { schema: playbackPositionSchema } } },
  },
  responses: {
    204: { description: "Position saved with last write wins." },
    401: errorResponse("Sign in required."),
    404: errorResponse("Not found."),
    400: errorResponse("Invalid unit."),
    500: errorResponse("Unavailable."),
  },
});
const audioRoute = createRoute({
  method: "get",
  path: "/api/files/audiobooks/{conversionId}/segments/{sequence}/audio.mp3",
  request: { params: segmentParamsSchema },
  responses: {
    200: { content: { "audio/mpeg": { schema: binarySchema } }, description: "Unit audio." },
    206: { content: { "audio/mpeg": { schema: binarySchema } }, description: "Unit byte range." },
    304: { description: "Not modified." },
    404: errorResponse("Unit unavailable."),
    416: errorResponse("Invalid range."),
  },
});
const audioHeadRoute = createRoute({ ...audioRoute, method: "head" });
const coverImageRoute = createRoute({
  method: "get",
  path: "/api/files/audiobooks/{conversionId}/cover-image",
  request: { params: conversionParamsSchema },
  responses: {
    200: {
      content: {
        "image/jpeg": { schema: binarySchema },
        "image/png": { schema: binarySchema },
        "image/webp": { schema: binarySchema },
        "image/avif": { schema: binarySchema },
        "image/gif": { schema: binarySchema },
      },
      description: "Cover image.",
    },
    304: { description: "Not modified." },
    404: errorResponse("Cover image unavailable."),
  },
});
const coverImageHeadRoute = createRoute({ ...coverImageRoute, method: "head" });

type ListenerApiEnvironment<Bindings extends object> = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
type ListenerApiRouteHandler<Route, Bindings extends object> = Route extends Parameters<
  typeof createRoute
>[0]
  ? (
      ...args: Parameters<
        RouteHandler<Route & { getRoutingPath(): string }, ListenerApiEnvironment<Bindings>>
      >
    ) => Response | Promise<Response>
  : never;
export type ListenerApiHandlers<Bindings extends object> = {
  deletionChallenge: ListenerApiRouteHandler<typeof deletionChallengeRoute, Bindings>;
  scheduleDeletion: ListenerApiRouteHandler<typeof scheduleDeletionRoute, Bindings>;
  restoreAccount: ListenerApiRouteHandler<typeof restoreAccountRoute, Bindings>;
  authConfig: ListenerApiRouteHandler<typeof authConfigRoute, Bindings>;
  getHistory: ListenerApiRouteHandler<typeof historyRoute, Bindings>;
  filesSession: ListenerApiRouteHandler<typeof filesSessionRoute, Bindings>;
  clearFilesSession: ListenerApiRouteHandler<typeof clearFilesSessionRoute, Bindings>;
  getAccount: ListenerApiRouteHandler<typeof getAccountRoute, Bindings>;
  startAccountConversion: ListenerApiRouteHandler<typeof startAccountConversionRoute, Bindings>;
  exchangeSession: ListenerApiRouteHandler<typeof exchangeSessionRoute, Bindings>;
  getGrant: ListenerApiRouteHandler<typeof getGrantRoute, Bindings>;
  getConversion: ListenerApiRouteHandler<typeof getConversionRoute, Bindings>;
  startTrialConversion: ListenerApiRouteHandler<typeof startTrialConversionRoute, Bindings>;
  getAudiobook: ListenerApiRouteHandler<typeof audiobookRoute, Bindings>;
  retryConversion: ListenerApiRouteHandler<typeof retryConversionRoute, Bindings>;
  savePosition: ListenerApiRouteHandler<typeof savePositionRoute, Bindings>;
  getAudio: ListenerApiRouteHandler<typeof audioRoute, Bindings>;
  headAudio: ListenerApiRouteHandler<typeof audioHeadRoute, Bindings>;
  getCoverImage: ListenerApiRouteHandler<typeof coverImageRoute, Bindings>;
  headCoverImage: ListenerApiRouteHandler<typeof coverImageHeadRoute, Bindings>;
};

/** Creates the typed HTTP interface used by the web application. */
export function createListenerApi<Bindings extends object>(
  handlers: ListenerApiHandlers<Bindings>,
) {
  return new OpenAPIHono<ListenerApiEnvironment<Bindings>>({ defaultHook })
    .openapi(deletionChallengeRoute, handlers.deletionChallenge)
    .openapi(scheduleDeletionRoute, handlers.scheduleDeletion)
    .openapi(restoreAccountRoute, handlers.restoreAccount)
    .openapi(authConfigRoute, handlers.authConfig)
    .openapi(historyRoute, handlers.getHistory)
    .openapi(filesSessionRoute, handlers.filesSession)
    .openapi(clearFilesSessionRoute, handlers.clearFilesSession)
    .openapi(getAccountRoute, handlers.getAccount)
    .openapi(startAccountConversionRoute, handlers.startAccountConversion)
    .openapi(exchangeSessionRoute, handlers.exchangeSession)
    .openapi(getGrantRoute, handlers.getGrant)
    .openapi(getConversionRoute, handlers.getConversion)
    .openapi(startTrialConversionRoute, handlers.startTrialConversion)
    .openapi(audiobookRoute, handlers.getAudiobook)
    .openapi(retryConversionRoute, handlers.retryConversion)
    .openapi(savePositionRoute, handlers.savePosition)
    .openapi(audioRoute, handlers.getAudio)
    .openapi(audioHeadRoute, handlers.headAudio)
    .openapi(coverImageRoute, handlers.getCoverImage)
    .openapi(coverImageHeadRoute, handlers.headCoverImage);
}

const unavailable = (): never => {
  throw new Error("Contract application cannot handle requests.");
};

/** Creates a handler-less application used only by local OpenAPI generation. */
export function createListenerContractApp() {
  return createListenerApi({
    deletionChallenge: unavailable,
    scheduleDeletion: unavailable,
    restoreAccount: unavailable,
    authConfig: unavailable,
    getHistory: unavailable,
    filesSession: unavailable,
    clearFilesSession: unavailable,
    getAccount: unavailable,
    startAccountConversion: unavailable,
    exchangeSession: unavailable,
    getGrant: unavailable,
    getConversion: unavailable,
    startTrialConversion: unavailable,
    getAudiobook: unavailable,
    getAudio: unavailable,
    headAudio: unavailable,
    getCoverImage: unavailable,
    headCoverImage: unavailable,
    retryConversion: unavailable,
    savePosition: unavailable,
  });
}

function defaultHook(
  result: { success: boolean; error?: { issues: Array<{ message: string }> } },
  context: {
    get(name: "requestId"): string;
    json(value: unknown, status: 400): Response;
  },
) {
  return result.success
    ? undefined
    : context.json(
        {
          error: {
            code: "invalid-input",
            message: result.error?.issues[0]?.message ?? "Request validation failed.",
            requestId: context.get("requestId"),
          },
        },
        400,
      );
}

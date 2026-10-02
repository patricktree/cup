import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";

import {
  audiobookSchema,
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
const mediaSessionRoute = createRoute({
  method: "post",
  path: "/api/media/session",
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
const clearMediaRoute = createRoute({
  method: "delete",
  path: "/api/media/session",
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

const audioRoute = createRoute({
  method: "get",
  path: "/api/audiobooks/{conversionId}/audio.mp3",
  request: { params: conversionParamsSchema },
  responses: {
    200: { content: { "audio/mpeg": { schema: binarySchema } }, description: "Complete MP3." },
    206: { content: { "audio/mpeg": { schema: binarySchema } }, description: "MP3 byte range." },
    304: { description: "Not modified." },
    404: errorResponse("Audiobook not found."),
    416: errorResponse("Invalid range."),
  },
});

const audioHeadRoute = createRoute({
  method: "head",
  path: "/api/audiobooks/{conversionId}/audio.mp3",
  request: { params: conversionParamsSchema },
  responses: {
    200: { description: "MP3 headers." },
    304: { description: "Not modified." },
    404: errorResponse("Audiobook not found."),
  },
});

const captionsRoute = createRoute({
  method: "get",
  path: "/api/audiobooks/{conversionId}/captions.vtt",
  request: { params: conversionParamsSchema },
  responses: {
    200: { content: { "text/vtt": { schema: z.string() } }, description: "Timed narration text." },
    404: errorResponse("Audiobook not found."),
  },
});

const epubRoute = createRoute({
  method: "get",
  path: "/api/audiobooks/{conversionId}/book.epub",
  request: { params: conversionParamsSchema },
  responses: {
    200: {
      content: { "application/epub+zip": { schema: binarySchema } },
      description: "Complete EPUB.",
    },
    304: { description: "Not modified." },
    404: errorResponse("Audiobook not found."),
  },
});

const epubHeadRoute = createRoute({
  method: "head",
  path: "/api/audiobooks/{conversionId}/book.epub",
  request: { params: conversionParamsSchema },
  responses: {
    200: { description: "EPUB headers." },
    304: { description: "Not modified." },
    404: errorResponse("Audiobook not found."),
  },
});

type WebAppApiEnvironment<Bindings extends object> = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
type WebAppApiRouteHandler<Route, Bindings extends object> = Route extends Parameters<
  typeof createRoute
>[0]
  ? (
      ...args: Parameters<
        RouteHandler<Route & { getRoutingPath(): string }, WebAppApiEnvironment<Bindings>>
      >
    ) => Response | Promise<Response>
  : never;
export type WebAppApiHandlers<Bindings extends object> = {
  deletionChallenge: WebAppApiRouteHandler<typeof deletionChallengeRoute, Bindings>;
  scheduleDeletion: WebAppApiRouteHandler<typeof scheduleDeletionRoute, Bindings>;
  restoreAccount: WebAppApiRouteHandler<typeof restoreAccountRoute, Bindings>;
  authConfig: WebAppApiRouteHandler<typeof authConfigRoute, Bindings>;
  getHistory: WebAppApiRouteHandler<typeof historyRoute, Bindings>;
  mediaSession: WebAppApiRouteHandler<typeof mediaSessionRoute, Bindings>;
  clearMedia: WebAppApiRouteHandler<typeof clearMediaRoute, Bindings>;
  getAccount: WebAppApiRouteHandler<typeof getAccountRoute, Bindings>;
  startAccountConversion: WebAppApiRouteHandler<typeof startAccountConversionRoute, Bindings>;
  exchangeSession: WebAppApiRouteHandler<typeof exchangeSessionRoute, Bindings>;
  getGrant: WebAppApiRouteHandler<typeof getGrantRoute, Bindings>;
  getConversion: WebAppApiRouteHandler<typeof getConversionRoute, Bindings>;
  startTrialConversion: WebAppApiRouteHandler<typeof startTrialConversionRoute, Bindings>;
  getAudiobook: WebAppApiRouteHandler<typeof audiobookRoute, Bindings>;
  getAudio: WebAppApiRouteHandler<typeof audioRoute, Bindings>;
  headAudio: WebAppApiRouteHandler<typeof audioHeadRoute, Bindings>;
  getCaptions: WebAppApiRouteHandler<typeof captionsRoute, Bindings>;
  getEpub: WebAppApiRouteHandler<typeof epubRoute, Bindings>;
  headEpub: WebAppApiRouteHandler<typeof epubHeadRoute, Bindings>;
};

/** Creates the typed HTTP interface used by the web application. */
export function createWebAppApi<Bindings extends object>(handlers: WebAppApiHandlers<Bindings>) {
  return new OpenAPIHono<WebAppApiEnvironment<Bindings>>({ defaultHook })
    .openapi(deletionChallengeRoute, handlers.deletionChallenge)
    .openapi(scheduleDeletionRoute, handlers.scheduleDeletion)
    .openapi(restoreAccountRoute, handlers.restoreAccount)
    .openapi(authConfigRoute, handlers.authConfig)
    .openapi(historyRoute, handlers.getHistory)
    .openapi(mediaSessionRoute, handlers.mediaSession)
    .openapi(clearMediaRoute, handlers.clearMedia)
    .openapi(getAccountRoute, handlers.getAccount)
    .openapi(startAccountConversionRoute, handlers.startAccountConversion)
    .openapi(exchangeSessionRoute, handlers.exchangeSession)
    .openapi(getGrantRoute, handlers.getGrant)
    .openapi(getConversionRoute, handlers.getConversion)
    .openapi(startTrialConversionRoute, handlers.startTrialConversion)
    .openapi(audiobookRoute, handlers.getAudiobook)
    .openapi(audioRoute, handlers.getAudio)
    .openapi(audioHeadRoute, handlers.headAudio)
    .openapi(captionsRoute, handlers.getCaptions)
    .openapi(epubRoute, handlers.getEpub)
    .openapi(epubHeadRoute, handlers.headEpub);
}

const unavailable = (): never => {
  throw new Error("Contract application cannot handle requests.");
};

/** Creates a handler-less application used only by local OpenAPI generation. */
export function createWebAppContractApp() {
  return createWebAppApi({
    deletionChallenge: unavailable,
    scheduleDeletion: unavailable,
    restoreAccount: unavailable,
    authConfig: unavailable,
    getHistory: unavailable,
    mediaSession: unavailable,
    clearMedia: unavailable,
    getAccount: unavailable,
    startAccountConversion: unavailable,
    exchangeSession: unavailable,
    getGrant: unavailable,
    getConversion: unavailable,
    startTrialConversion: unavailable,
    getAudiobook: unavailable,
    getAudio: unavailable,
    headAudio: unavailable,
    getCaptions: unavailable,
    getEpub: unavailable,
    headEpub: unavailable,
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

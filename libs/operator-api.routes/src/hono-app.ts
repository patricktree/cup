import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";

import {
  accountParamsSchema,
  conversionParamsSchema,
  deleteConversionResponseSchema,
  adjustAccountAllowanceRequestSchema,
  adjustAccountAllowanceResponseSchema,
  inspectAccountResponseSchema,
  listAccountDeletionsResponseSchema,
  listAccountsQuerySchema,
  listAccountsResponseSchema,
  setGrantAllowanceRequestSchema,
  createGrantRequestSchema,
  createGrantResponseSchema,
  errorResponseSchema,
  grantParamsSchema,
  invalidateSessionsRequestSchema,
  invalidateSessionsResponseSchema,
  listGrantsQuerySchema,
  listGrantsResponseSchema,
  migrationReportSchema,
  operatorInspectResponseSchema,
  revokeGrantResponseSchema,
} from "#src/contracts.ts";

type ErrorResponseDefinition = {
  content?: { "application/json": { schema: typeof errorResponseSchema } };
  description: string;
};

const errorResponse = (description: string): ErrorResponseDefinition => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

const createGrantRoute = createRoute({
  method: "post",
  path: "/api/operator/grants",
  request: {
    body: { required: true, content: { "application/json": { schema: createGrantRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: createGrantResponseSchema } },
      description: "Previously issued grant.",
    },
    201: {
      content: { "application/json": { schema: createGrantResponseSchema } },
      description: "Grant issued.",
    },
    400: errorResponse("Invalid request."),
    409: errorResponse("Provisioning conflict."),
    500: errorResponse("Operational error."),
  },
});

const listGrantsRoute = createRoute({
  method: "get",
  path: "/api/operator/grants",
  request: { query: listGrantsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listGrantsResponseSchema } },
      description: "Projected Registry listing.",
    },
    400: errorResponse("Invalid cursor or filter."),
    500: errorResponse("Operational error."),
  },
});

const inspectGrantRoute = createRoute({
  method: "get",
  path: "/api/operator/grants/{grantId}",
  request: { params: grantParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: operatorInspectResponseSchema } },
      description: "Authoritative grant inspection.",
    },
    400: errorResponse("Invalid request."),
    404: errorResponse("Grant not found."),
    500: errorResponse("Operational error."),
  },
});

const setGrantAllowanceRoute = createRoute({
  method: "put",
  path: "/api/operator/grants/{grantId}/allowance",
  request: {
    params: grantParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: setGrantAllowanceRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: revokeGrantResponseSchema } },
      description: "Conversion allowance updated.",
    },
    400: errorResponse("Invalid request."),
    404: errorResponse("Grant not found."),
    409: errorResponse("Allowance is below reserved and spent duration."),
    500: errorResponse("Operational error."),
  },
});

const revokeGrantRoute = createRoute({
  method: "post",
  path: "/api/operator/grants/{grantId}/revocation",
  request: {
    params: grantParamsSchema,
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: revokeGrantResponseSchema } },
      description: "Grant revoked.",
    },
    400: errorResponse("Invalid request."),
    404: errorResponse("Grant not found."),
    500: errorResponse("Operational error."),
  },
});

const invalidateSessionsRoute = createRoute({
  method: "post",
  path: "/api/operator/grants/{grantId}/session-invalidations",
  request: {
    params: grantParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: invalidateSessionsRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: invalidateSessionsResponseSchema } },
      description: "Sessions invalidated.",
    },
    400: errorResponse("Invalid request."),
    404: errorResponse("Grant not found."),
    500: errorResponse("Operational error."),
  },
});

const migrateGrantsRoute = createRoute({
  method: "post",
  path: "/api/operator/grant-migrations",
  request: {
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: migrationReportSchema } },
      description: "Complete migration report.",
    },
    400: errorResponse("Invalid request."),
    500: errorResponse("Operational error."),
  },
});

const inspectAccountRoute = createRoute({
  method: "get",
  path: "/api/operator/accounts/{accountId}",
  request: { params: accountParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: inspectAccountResponseSchema } },
      description: "Account state, accounting, conversions, and artifact writers.",
    },
    404: errorResponse("Account unavailable."),
    500: errorResponse("Operational error."),
  },
});
const listAccountsRoute = createRoute({
  method: "get",
  path: "/api/operator/accounts",
  request: { query: listAccountsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: listAccountsResponseSchema } },
      description: "Registry identity mappings, oldest first.",
    },
    400: errorResponse("Invalid cursor or filter."),
    500: errorResponse("Operational error."),
  },
});
const adjustAccountAllowanceRoute = createRoute({
  method: "post",
  path: "/api/operator/accounts/{accountId}/allowance-adjustments",
  request: {
    params: accountParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: adjustAccountAllowanceRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: adjustAccountAllowanceResponseSchema } },
      description: "Adjustment recorded or replayed.",
    },
    400: errorResponse("Invalid request."),
    404: errorResponse("Account not found."),
    409: errorResponse("Account inactive, adjustment exceeds available duration, or conflict."),
    500: errorResponse("Operational error."),
  },
});
const listAccountDeletionsRoute = createRoute({
  method: "get",
  path: "/api/operator/accounts/deletions",
  responses: {
    200: {
      content: { "application/json": { schema: listAccountDeletionsResponseSchema } },
      description: "Account deletion attempts and retained receipts.",
    },
    503: errorResponse("Account registry unavailable."),
    500: errorResponse("Operational error."),
  },
});

const deleteConversionRoute = createRoute({
  method: "delete",
  path: "/api/operator/conversions/{conversionId}",
  request: {
    params: conversionParamsSchema,
    // Empty like the other bodyless operator mutations, because every operator mutation must carry
    // `Content-Type: application/json` (the `/api/operator/*` middleware in `@cup/api-server`).
    body: { required: true, content: { "application/json": { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: deleteConversionResponseSchema } },
      description:
        "Conversion deleted, or its deletion is already under way; cleanup continues in the background.",
    },
    400: errorResponse("Invalid request."),
    // `account-unavailable` for an account being deleted, as account inspection answers.
    404: errorResponse("Conversion not found, or its account is being deleted."),
    409: errorResponse("Conversion not owned by an account."),
    500: errorResponse("Operational error."),
  },
});

type OperatorApiEnvironment<Bindings extends object> = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
type OperatorApiRouteHandler<Route, Bindings extends object> = Route extends Parameters<
  typeof createRoute
>[0]
  ? (
      ...args: Parameters<
        RouteHandler<Route & { getRoutingPath(): string }, OperatorApiEnvironment<Bindings>>
      >
    ) => Response | Promise<Response>
  : never;
export type OperatorApiHandlers<Bindings extends object> = {
  listAccounts: OperatorApiRouteHandler<typeof listAccountsRoute, Bindings>;
  adjustAccountAllowance: OperatorApiRouteHandler<typeof adjustAccountAllowanceRoute, Bindings>;
  inspectAccount: OperatorApiRouteHandler<typeof inspectAccountRoute, Bindings>;
  listAccountDeletions: OperatorApiRouteHandler<typeof listAccountDeletionsRoute, Bindings>;
  deleteConversion: OperatorApiRouteHandler<typeof deleteConversionRoute, Bindings>;
  createGrant: OperatorApiRouteHandler<typeof createGrantRoute, Bindings>;
  listGrants: OperatorApiRouteHandler<typeof listGrantsRoute, Bindings>;
  inspectGrant: OperatorApiRouteHandler<typeof inspectGrantRoute, Bindings>;
  setGrantAllowance: OperatorApiRouteHandler<typeof setGrantAllowanceRoute, Bindings>;
  revokeGrant: OperatorApiRouteHandler<typeof revokeGrantRoute, Bindings>;
  invalidateSessions: OperatorApiRouteHandler<typeof invalidateSessionsRoute, Bindings>;
  migrateGrants: OperatorApiRouteHandler<typeof migrateGrantsRoute, Bindings>;
};

/** Creates the typed HTTP interface used by operators. */
export function createOperatorApi<Bindings extends object>(
  handlers: OperatorApiHandlers<Bindings>,
) {
  return new OpenAPIHono<OperatorApiEnvironment<Bindings>>({ defaultHook })
    .openapi(listAccountsRoute, handlers.listAccounts)
    .openapi(listAccountDeletionsRoute, handlers.listAccountDeletions)
    .openapi(adjustAccountAllowanceRoute, handlers.adjustAccountAllowance)
    .openapi(inspectAccountRoute, handlers.inspectAccount, (result, context) => {
      if (!result.success) {
        return context.json(
          {
            error: {
              code: "account-unavailable",
              message: "Account unavailable.",
              requestId: context.get("requestId"),
            },
          },
          404,
        );
      }
      return undefined;
    })
    .openapi(deleteConversionRoute, handlers.deleteConversion)
    .openapi(createGrantRoute, handlers.createGrant)
    .openapi(listGrantsRoute, handlers.listGrants)
    .openapi(inspectGrantRoute, handlers.inspectGrant)
    .openapi(setGrantAllowanceRoute, handlers.setGrantAllowance)
    .openapi(revokeGrantRoute, handlers.revokeGrant)
    .openapi(invalidateSessionsRoute, handlers.invalidateSessions)
    .openapi(migrateGrantsRoute, handlers.migrateGrants);
}

const unavailable = (): never => {
  throw new Error("Contract application cannot handle requests.");
};

/** Creates a handler-less application used only by local OpenAPI generation. */
function createOperatorContractApp() {
  return createOperatorApi({
    listAccounts: unavailable,
    adjustAccountAllowance: unavailable,
    inspectAccount: unavailable,
    listAccountDeletions: unavailable,
    deleteConversion: unavailable,
    createGrant: unavailable,
    listGrants: unavailable,
    inspectGrant: unavailable,
    setGrantAllowance: unavailable,
    revokeGrant: unavailable,
    invalidateSessions: unavailable,
    migrateGrants: unavailable,
  });
}

type OpenApiDocument = ReturnType<
  ReturnType<typeof createOperatorContractApp>["getOpenAPIDocument"]
>;

/** Generates the operator API's OpenAPI document, which the snapshot test compares. */
export function createOperatorOpenApiDocument(): OpenApiDocument {
  return createOperatorContractApp().getOpenAPIDocument({
    openapi: "3.0.0",
    info: { title: "create-audiobook-from-url operator API", version: "1.0.0" },
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

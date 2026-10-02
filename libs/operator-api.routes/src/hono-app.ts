import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";

import {
  accountParamsSchema,
  inspectAccountResponseSchema,
  listAccountDeletionsResponseSchema,
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
  inspectAccount: OperatorApiRouteHandler<typeof inspectAccountRoute, Bindings>;
  listAccountDeletions: OperatorApiRouteHandler<typeof listAccountDeletionsRoute, Bindings>;
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
    .openapi(listAccountDeletionsRoute, handlers.listAccountDeletions)
    .openapi(inspectAccountRoute, handlers.inspectAccount, (result, context) => {
      if (!result.success)
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
      return undefined;
    })
    .openapi(createGrantRoute, handlers.createGrant)
    .openapi(listGrantsRoute, handlers.listGrants)
    .openapi(inspectGrantRoute, handlers.inspectGrant)
    .openapi(setGrantAllowanceRoute, handlers.setGrantAllowance)
    .openapi(revokeGrantRoute, handlers.revokeGrant)
    .openapi(invalidateSessionsRoute, handlers.invalidateSessions)
    .openapi(migrateGrantsRoute, handlers.migrateGrants);
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

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NONCE, secureHeaders } from "hono/secure-headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Temporal } from "temporal-polyfill";

import {
  clearGrantSessionCookie,
  createGrantSessionCookie,
  createRootCredential,
  getGrantSessionCookie,
  type ConversionGrantDurableObject,
  type ConversionGrantRegistryDurableObject,
} from "@cup/conversion-grants";
import { createOperatorApi, type OperatorApiHandlers } from "@cup/operator-api.routes";
import {
  audiobookSchema,
  createWebAppApi,
  type ErrorResponse,
  type WebAppApiHandlers,
} from "@cup/web-app-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { routeApplicationDomain } from "#src/domain-routing.ts";
import { isDevelopmentOperatorRequest } from "#src/operator-access.ts";
import {
  loadReadyAudiobookFromEnvironment,
  serveAudio,
  serveCaptions,
  serveEpub,
} from "#src/serve-audiobook.ts";
import { createConversionGrant } from "#src/use-cases/create-conversion-grant.ts";
import { getGrantConversion } from "#src/use-cases/get-grant-conversion.ts";
import { startAudiobookConversion } from "#src/use-cases/start-audiobook-conversion.ts";
import { applyWebAppCspNonce } from "#src/web-app-csp.ts";

type GrantStub = DurableObjectStub<ConversionGrantDurableObject>;
type RegistryStub = DurableObjectStub<ConversionGrantRegistryDurableObject>;
const accessKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
type ApiServerDependencies = {
  validateOperatorAccess(request: Request, env: ApiServerEnvironment): Promise<boolean>;
};
const productionDependencies: ApiServerDependencies = {
  validateOperatorAccess: async (request, env) =>
    isDevelopmentOperatorRequest(request) ||
    (await validateAccessAssertion(
      request.headers.get("Cf-Access-Jwt-Assertion") ?? undefined,
      env,
    )),
};

const webAppApiHandlers: WebAppApiHandlers<ApiServerEnvironment> = {
  async exchangeSession(context) {
    const validation = validateSessionMutationRequest(context.req.raw, context.get("requestId"));
    if (validation.result === "invalid") return validation.response;
    const { grantId } = context.req.valid("param");
    try {
      const result = await getGrantStub(context.env, grantId).exchangeCredential(
        context.req.valid("json").credential,
      );
      if (result.result === "invalid-credential")
        return jsonError(
          context.get("requestId"),
          "invalid-credential",
          "This trial link is invalid.",
          401,
        );
      if (result.result === "grant-revoked")
        return jsonError(
          context.get("requestId"),
          "grant-revoked",
          "This trial link was revoked.",
          403,
        );
      return context.json(result.snapshot, 201, {
        "Set-Cookie": createGrantSessionCookie(grantId, result.sessionToken),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not initialized"))
        return jsonError(
          context.get("requestId"),
          "invalid-credential",
          "This trial link is invalid.",
          401,
        );
      return jsonError(
        context.get("requestId"),
        "dependency-unavailable",
        "The trial link service is temporarily unavailable.",
        503,
      );
    }
  },

  async getGrant(context) {
    const { grantId } = context.req.valid("param");
    const authenticated = await authenticateGrant(
      context.env,
      grantId,
      context.req.header("Cookie"),
    );
    if (authenticated.result === "missing")
      return jsonError(
        context.get("requestId"),
        "grant-session-required",
        "A grant session is required.",
        401,
      );
    if (authenticated.result === "invalid")
      return jsonError(
        context.get("requestId"),
        "grant-session-invalid",
        "This browser no longer has access. Open the original trial link again.",
        401,
        { "Set-Cookie": clearGrantSessionCookie(grantId) },
      );
    if (authenticated.result === "operational-error")
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The grant could not be loaded.",
        500,
      );
    return context.json(authenticated.snapshot, 200, {
      "Set-Cookie": createGrantSessionCookie(grantId, authenticated.token),
    });
  },

  async getGrantConversions(context) {
    const { grantId } = context.req.valid("param");
    const authenticated = await authenticateGrant(
      context.env,
      grantId,
      context.req.header("Cookie"),
    );
    if (authenticated.result === "missing")
      return jsonError(
        context.get("requestId"),
        "grant-session-required",
        "A grant session is required.",
        401,
      );
    if (authenticated.result === "invalid")
      return jsonError(
        context.get("requestId"),
        "grant-session-invalid",
        "This browser no longer has access. Open the original trial link again.",
        401,
        { "Set-Cookie": clearGrantSessionCookie(grantId) },
      );
    if (authenticated.result === "operational-error")
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The conversions could not be loaded.",
        500,
      );
    try {
      return context.json(await getGrantStub(context.env, grantId).listConversions(), 200, {
        "Set-Cookie": createGrantSessionCookie(grantId, authenticated.token),
      });
    } catch {
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The conversions could not be loaded.",
        500,
      );
    }
  },

  async getConversion(context) {
    const { conversionId } = context.req.valid("param");
    const grantId = await getRegistryStub(context.env).findGrantIdForConversion(conversionId);
    if (grantId === undefined)
      return jsonError(
        context.get("requestId"),
        "conversion-not-found",
        "Conversion not found.",
        404,
      );
    const authenticated = await authenticateGrant(
      context.env,
      grantId,
      context.req.header("Cookie"),
    );
    if (authenticated.result === "missing")
      return jsonError(
        context.get("requestId"),
        "grant-session-required",
        "A grant session is required.",
        401,
      );
    if (authenticated.result === "invalid")
      return jsonError(
        context.get("requestId"),
        "grant-session-invalid",
        "This browser no longer has access. Open the original trial link again.",
        401,
        { "Set-Cookie": clearGrantSessionCookie(grantId) },
      );
    if (authenticated.result === "operational-error")
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The conversion could not be loaded.",
        500,
      );
    try {
      const conversion = await getGrantConversion(conversionId, getGrantStub(context.env, grantId));
      if (conversion === undefined)
        return jsonError(
          context.get("requestId"),
          "conversion-not-found",
          "Conversion not found.",
          404,
          { "Set-Cookie": createGrantSessionCookie(grantId, authenticated.token) },
        );
      return context.json(conversion, 200, {
        "Set-Cookie": createGrantSessionCookie(grantId, authenticated.token),
      });
    } catch {
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The conversion could not be loaded.",
        500,
      );
    }
  },

  async startConversion(context) {
    const validation = validateSessionMutationRequest(context.req.raw, context.get("requestId"));
    if (validation.result === "invalid") return validation.response;
    const { grantId } = context.req.valid("param");
    const authenticated = await authenticateGrant(
      context.env,
      grantId,
      context.req.header("Cookie"),
    );
    if (authenticated.result === "missing")
      return jsonError(
        context.get("requestId"),
        "grant-session-required",
        "A grant session is required.",
        401,
      );
    if (authenticated.result === "invalid")
      return jsonError(
        context.get("requestId"),
        "grant-session-invalid",
        "This browser no longer has access. Open the original trial link again.",
        401,
        { "Set-Cookie": clearGrantSessionCookie(grantId) },
      );
    if (authenticated.result === "operational-error")
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The grant could not be loaded.",
        500,
      );

    const grant = getGrantStub(context.env, grantId);
    const sourceUrl = new URL(context.req.valid("json").sourceUrl).toString();
    const result = await startAudiobookConversion(
      {
        sourceUrl,
        grantId,
        idempotencyKey: context.req.valid("header")["idempotency-key"],
      },
      {
        grant,
        registry: getRegistryStub(context.env),
        createWorkflow: async (conversionId, params) => {
          await context.env.CREATE_AUDIOBOOK_FROM_URL_WORKFLOW.create({ id: conversionId, params });
        },
      },
    );
    if (result.result === "rate-limited")
      return jsonError(
        context.get("requestId"),
        "start-rate-limited",
        "Wait briefly and try again.",
        429,
        {
          "Retry-After": result.retryAfterSeconds.toString(),
        },
      );
    if (result.result === "idempotency-conflict")
      return jsonError(
        context.get("requestId"),
        "idempotency-conflict",
        "This request key is already bound to a different source URL.",
        409,
      );
    if (result.result === "temporarily-full")
      return jsonError(
        context.get("requestId"),
        "grant-temporarily-full",
        "All conversion slots are currently reserved or spent.",
        409,
      );
    if (result.result === "exhausted")
      return jsonError(
        context.get("requestId"),
        "grant-exhausted",
        "All conversion slots have been spent.",
        409,
      );
    if (result.result === "expired")
      return jsonError(
        context.get("requestId"),
        "grant-expired",
        "This conversion grant has expired.",
        403,
      );
    if (result.result === "revoked")
      return jsonError(
        context.get("requestId"),
        "grant-revoked",
        "This conversion grant was revoked.",
        403,
      );

    return context.json(
      {
        result: result.result,
        conversion: {
          conversionId: result.conversion.conversionId,
          sourceUrl: result.conversion.sourceUrl,
          acceptedAt: toIsoString(result.conversion.acceptedAtMs),
          status: result.conversion.status,
          ...(result.conversion.status === "ready"
            ? {
                title: result.conversion.title,
                completedAt: toIsoString(result.conversion.completedAtMs),
                audiobookUrl: `/app/audiobooks/${result.conversion.conversionId}`,
              }
            : result.conversion.status === "failed"
              ? {
                  completedAt: toIsoString(result.conversion.completedAtMs),
                  failure: {
                    category: result.conversion.failureCategory,
                    explanation: result.conversion.explanation,
                  },
                }
              : {}),
        },
        slots: result.slots,
      },
      result.result === "created" ? 202 : 200,
      { "Set-Cookie": createGrantSessionCookie(grantId, authenticated.token) },
    );
  },

  async getAudiobook(context) {
    const conversionId = context.req.valid("param").conversionId;
    try {
      const audiobook = await loadReadyAudiobookFromEnvironment(context.env, conversionId);
      if (audiobook === undefined)
        return jsonError(
          context.get("requestId"),
          "audiobook-not-found",
          "Audiobook not found.",
          404,
        );
      const origin = new URL(context.req.url).origin;
      return context.json(
        audiobookSchema.parse({
          title: audiobook.title,
          originalUrl: audiobook.originalUrl,
          narrationDocument: audiobook.narrationDocument,
          synchronizationCues: audiobook.synchronizationCues,
          audio: {
            contentType: "audio/mpeg",
            url: `${origin}/api/audiobooks/${conversionId}/audio.mp3`,
          },
          captions: {
            contentType: "text/vtt",
            url: `${origin}/api/audiobooks/${conversionId}/captions.vtt`,
          },
          epub: {
            contentType: "application/epub+zip",
            url: `${origin}/api/audiobooks/${conversionId}/book.epub`,
          },
        }),
        200,
      );
    } catch {
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The audiobook could not be loaded.",
        500,
      );
    }
  },

  async getAudio(context) {
    return serveAudio(
      context.env,
      context.req.raw,
      context.req.valid("param").conversionId,
      false,
      context.get("requestId"),
    );
  },

  async headAudio(context) {
    return serveAudio(
      context.env,
      context.req.raw,
      context.req.valid("param").conversionId,
      true,
      context.get("requestId"),
    );
  },

  async getCaptions(context) {
    return serveCaptions(
      context.env,
      context.req.valid("param").conversionId,
      context.get("requestId"),
    );
  },

  async getEpub(context) {
    return serveEpub(
      context.env,
      context.req.raw,
      context.req.valid("param").conversionId,
      false,
      context.get("requestId"),
    );
  },

  async headEpub(context) {
    return serveEpub(
      context.env,
      context.req.raw,
      context.req.valid("param").conversionId,
      true,
      context.get("requestId"),
    );
  },
};

const operatorApiHandlers: OperatorApiHandlers<ApiServerEnvironment> = {
  async createGrant(context) {
    const { label, requestId } = context.req.valid("json");
    try {
      const result = await createConversionGrant(
        { label, requestId, issuedAtMs: nowMilliseconds() },
        {
          registry: getRegistryStub(context.env),
          getGrant: (grantId) => getGrantStub(context.env, grantId),
          createRootCredential,
        },
      );
      if (result.result === "already-issued")
        return context.json(
          {
            result: "already-issued",
            grantId: result.grantId,
            requestId: result.requestId,
            label: result.label,
            createdAt: toIsoString(result.createdAtMs),
            expiresAt: toIsoString(result.expiresAtMs),
            state: "open",
          },
          200,
        );
      const origin = new URL(context.req.url).origin;
      return context.json(
        {
          result: "issued",
          grantId: result.grantId,
          requestId: result.requestId,
          label: result.label,
          createdAt: toIsoString(result.createdAtMs),
          expiresAt: toIsoString(result.expiresAtMs),
          state: "open",
          trialLink: `${origin}/app/trials/${result.grantId}#credential=${result.credential}`,
        },
        201,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("different label"))
        return jsonError(
          context.get("requestId"),
          "idempotency-conflict",
          "The request ID is already bound to another label.",
          409,
        );
      // Drizzle's wrapper includes SQL parameters; log only the underlying error.
      let cause = error;
      while (cause instanceof Error && cause.cause instanceof Error) cause = cause.cause;
      console.error(
        JSON.stringify({
          event: "grant-creation-failed",
          requestId: context.get("requestId"),
          error: cause instanceof Error ? cause.message : "Unknown error",
        }),
      );
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The conversion grant could not be created.",
        500,
      );
    }
  },

  async listGrants(context) {
    try {
      const searchParameters = new URL(context.req.url).searchParams;
      if (
        ["label", "state", "limit", "cursor"].some(
          (name) => searchParameters.getAll(name).length > 1,
        )
      )
        return jsonError(
          context.get("requestId"),
          "invalid-input",
          "Query parameters cannot be repeated.",
          400,
        );
      const query = context.req.valid("query");
      return context.json(
        await getRegistryStub(context.env).listGrants({
          limit: query.limit,
          ...(query.label === undefined ? {} : { label: query.label }),
          ...(query.state === undefined ? {} : { state: query.state }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        }),
        200,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid Registry cursor")
        return jsonError(
          context.get("requestId"),
          "invalid-cursor",
          "The Registry cursor is invalid.",
          400,
        );
      return jsonError(
        context.get("requestId"),
        "operational-error",
        "The Registry could not be read.",
        500,
      );
    }
  },

  async inspectGrant(context) {
    const { grantId } = context.req.valid("param");
    const entry = await getRegistryStub(context.env).getGrant(grantId);
    if (entry === undefined)
      return jsonError(
        context.get("requestId"),
        "grant-not-found",
        "Conversion grant not found.",
        404,
      );
    const authoritative = await getGrantStub(context.env, grantId).inspectOperator();
    return context.json(
      {
        registry: {
          grantId: entry.grantId,
          requestId: entry.requestId,
          label: entry.label,
          createdAt: toIsoString(entry.createdAtMs),
          expiresAt: toIsoString(entry.expiresAtMs),
          state: deriveEntryState(entry, nowMilliseconds()),
        },
        authoritative,
        registrySnapshotDisagreement:
          entry.grantSnapshot?.reserved !== authoritative.slots.reserved ||
          entry.grantSnapshot?.spent !== authoritative.slots.spent ||
          entry.grantSnapshot?.maxSlots !==
            authoritative.slots.remaining +
              authoritative.slots.reserved +
              authoritative.slots.spent,
      },
      200,
    );
  },

  async setGrantAllowance(context) {
    const { grantId } = context.req.valid("param");
    const { maxSlots } = context.req.valid("json");
    if ((await getRegistryStub(context.env).getGrant(grantId)) === undefined)
      return jsonError(
        context.get("requestId"),
        "grant-not-found",
        "Conversion grant not found.",
        404,
      );
    const result = await getGrantStub(context.env, grantId).setMaxSlots(maxSlots);
    if (result.result === "below-used-slots")
      return jsonError(
        context.get("requestId"),
        "allowance-below-used-slots",
        "Allowance cannot be lower than reserved and spent slots.",
        409,
      );
    await getRegistryStub(context.env).applyGrantRegistrySnapshot(result.registrySnapshot);
    await getGrantStub(context.env, grantId).confirmRegistrySnapshot(
      result.registrySnapshot.revision,
    );
    return context.json({ changed: result.changed, grant: result.snapshot }, 200);
  },

  async revokeGrant(context) {
    const { grantId } = context.req.valid("param");
    if ((await getRegistryStub(context.env).getGrant(grantId)) === undefined)
      return jsonError(
        context.get("requestId"),
        "grant-not-found",
        "Conversion grant not found.",
        404,
      );
    const result = await getGrantStub(context.env, grantId).revoke();
    await getRegistryStub(context.env).applyGrantRegistrySnapshot(result.registrySnapshot);
    return context.json({ changed: result.changed, grant: result.snapshot }, 200);
  },

  async invalidateSessions(context) {
    const { grantId } = context.req.valid("param");
    if ((await getRegistryStub(context.env).getGrant(grantId)) === undefined)
      return jsonError(
        context.get("requestId"),
        "grant-not-found",
        "Conversion grant not found.",
        404,
      );
    const result = await getGrantStub(context.env, grantId).invalidateSessions();
    await getRegistryStub(context.env).applyGrantRegistrySnapshot(result.registrySnapshot);
    return context.json(
      { invalidatedAt: toIsoString(result.invalidatedAtMs), grant: result.snapshot },
      200,
    );
  },

  async migrateGrants(context) {
    const registry = getRegistryStub(context.env);
    const registryVersion = await registry.migrate();
    const reports = await Promise.all(
      (await registry.enumerateGrantIds()).map(async (grantId) => {
        try {
          return {
            grantId,
            success: true as const,
            schemaVersion: await getGrantStub(context.env, grantId).migrate(),
          };
        } catch {
          return { grantId, success: false as const, error: "Migration failed." };
        }
      }),
    );
    return context.json(
      { complete: reports.every((report) => report.success), registryVersion, grants: reports },
      200,
    );
  },
};

export type ApiServerHonoEnvironment = {
  Bindings: ApiServerEnvironment;
  Variables: { requestId: string };
};

export type { ApiServerEnvironment } from "#src/api-server-environment.ts";

/** Creates the HTTP server for the web application and operator interfaces. */
export function createApiServer(dependencies: ApiServerDependencies = productionDependencies) {
  const app = new Hono<ApiServerHonoEnvironment>();
  app.use("*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control"))
      context.header("Cache-Control", "private, no-store");
  });
  app.use("*", async (context, next) => {
    const response = routeApplicationDomain(context.req.raw);
    if (response !== undefined) return response;
    return next();
  });
  const limitApiRequestBody = bodyLimit({
    maxSize: 4_096,
    onError: (context) =>
      jsonError(
        context.get("requestId"),
        "request-too-large",
        "JSON request bodies are limited to 4 KiB.",
        413,
      ),
  });
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", NONCE],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "no-referrer",
      xFrameOptions: "DENY",
    }),
  );
  app.use("*", async (context, next) => {
    context.set("requestId", crypto.randomUUID());
    const allowedMethods = allowedMethodsForApiPath(context.req.path);
    if (allowedMethods !== undefined && !allowedMethods.includes(context.req.method))
      context.res = jsonError(
        context.get("requestId"),
        "method-not-allowed",
        "The request method is not allowed for this API route.",
        405,
        { Allow: allowedMethods.join(", ") },
      );
    else await next();
    context.header("X-Request-Id", context.get("requestId"));
    return context.res;
  });

  app.use("/api/*", async (context, next) => {
    if (context.req.method === "GET" || context.req.method === "HEAD") return next();
    return limitApiRequestBody(context, next);
  });

  app.use("/api/operator/*", async (context, next) => {
    if (!(await dependencies.validateOperatorAccess(context.req.raw, context.env)))
      return jsonError(
        context.get("requestId"),
        "operator-unauthorized",
        "Cloudflare Access authorization is required.",
        401,
      );
    if (
      context.req.method !== "GET" &&
      context.req.method !== "HEAD" &&
      context.req.header("Content-Type") !== "application/json"
    )
      return jsonError(
        context.get("requestId"),
        "unsupported-media-type",
        "Content-Type must be application/json.",
        415,
      );
    await next();
    if (context.req.method !== "GET" && context.req.method !== "HEAD")
      console.info(
        JSON.stringify({
          event: "operator-mutation",
          operatorEmail: context.env.OPERATOR_EMAIL,
          method: context.req.method,
          path: context.req.path,
          requestId: context.get("requestId"),
          status: context.res.status,
        }),
      );
    return context.res;
  });

  app.notFound(async (context) => {
    if (context.req.path === "/api" || context.req.path.startsWith("/api/"))
      return jsonError(context.get("requestId"), "not-found", "API route not found.", 404);

    if (context.req.method !== "GET" && context.req.method !== "HEAD")
      return context.text("Not Found", 404);

    const url = new URL(context.req.url);
    if (url.pathname === "/") return context.redirect(`/app/${url.search}`, 302);
    if (url.pathname === "/app") return context.redirect(`/app/${url.search}`, 308);
    if (/^\/trials\/[^/]+\/?$/.test(url.pathname)) {
      // Leave Location without a fragment so browsers inherit the original trial credential.
      return context.redirect(`/app${url.pathname}${url.search}`, 308);
    }

    // The shell is internal; other existing assets also include Vite's development modules.
    if (url.pathname === "/index.html") return context.text("Not Found", 404);

    let response = await context.env.ASSETS.fetch(context.req.raw);
    if (
      response.status === 404 &&
      url.pathname.startsWith("/app/") &&
      url.pathname !== "/app/assets" &&
      !url.pathname.startsWith("/app/assets/") &&
      !/\.[^/]*$/.test(url.pathname)
    ) {
      url.pathname = "/index.html";
      response = await context.env.ASSETS.fetch(new Request(url, context.req.raw));
    }
    if (!response.headers.get("Content-Type")?.startsWith("text/html")) return response;

    const nonce = context.get("secureHeadersNonce");
    if (nonce === undefined)
      throw new Error("Expected the secure headers middleware to set a nonce.");
    return applyWebAppCspNonce(response, nonce);
  });

  app.onError((_error, context) =>
    jsonError(
      context.get("requestId"),
      "operational-error",
      "The request could not be completed.",
      500,
    ),
  );

  return app
    .route("/", createWebAppApi(webAppApiHandlers))
    .route("/", createOperatorApi(operatorApiHandlers));
}

function getGrantStub(env: ApiServerEnvironment, grantId: string): GrantStub {
  return env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(grantId));
}

function getRegistryStub(env: ApiServerEnvironment): RegistryStub {
  return env.CONVERSION_GRANT_REGISTRY.get(env.CONVERSION_GRANT_REGISTRY.idFromName("registry"));
}

async function authenticateGrant(
  env: ApiServerEnvironment,
  grantId: string,
  cookieHeader: string | undefined,
) {
  const token = getGrantSessionCookie(cookieHeader, grantId);
  if (token === undefined || token === "") return { result: "missing" as const };
  try {
    const result = await getGrantStub(env, grantId).validateSession(token);
    return result.result === "valid"
      ? { result: "valid" as const, token, snapshot: result.snapshot }
      : { result: "invalid" as const };
  } catch {
    return { result: "operational-error" as const };
  }
}

type SessionMutationRequestValidation =
  | { result: "valid" }
  | { result: "invalid"; response: Response };

function validateSessionMutationRequest(
  request: Request,
  requestId: string,
): SessionMutationRequestValidation {
  if (request.headers.get("Content-Type") !== "application/json")
    return {
      result: "invalid",
      response: jsonError(
        requestId,
        "unsupported-media-type",
        "Content-Type must be application/json.",
        415,
      ),
    };
  if (
    (request.headers.has("Origin") &&
      request.headers.get("Origin") !== new URL(request.url).origin) ||
    // Reject browser requests from another site; native HTTP requests can omit Fetch Metadata.
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    // Require a custom header that cross-origin browser requests cannot send without a CORS preflight.
    request.headers.get("X-Create-Audiobook-From-URL-Request") !== "1"
  )
    return {
      result: "invalid",
      response: jsonError(requestId, "origin-forbidden", "The request origin is not allowed.", 403),
    };

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > 4_096)
    return {
      result: "invalid",
      response: jsonError(
        requestId,
        "request-too-large",
        "JSON request bodies are limited to 4 KiB.",
        413,
      ),
    };

  return { result: "valid" };
}

function createErrorBody(requestId: string, code: string, message: string): ErrorResponse {
  return { error: { code, message, requestId } };
}

function jsonError(
  requestId: string,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 429 | 500 | 503,
  headers?: HeadersInit,
): Response {
  return Response.json(createErrorBody(requestId, code, message), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}

function allowedMethodsForApiPath(pathname: string): string[] | undefined {
  const routes: ReadonlyArray<readonly [RegExp, string[]]> = [
    [/^\/api\/grants\/[^/]+\/sessions$/, ["POST"]],
    [/^\/api\/grants\/[^/]+$/, ["GET"]],
    [/^\/api\/grants\/[^/]+\/conversions$/, ["GET", "POST"]],
    [/^\/api\/conversions\/[^/]+$/, ["GET"]],
    [/^\/api\/audiobooks\/[^/]+$/, ["GET"]],
    [/^\/api\/audiobooks\/[^/]+\/audio$/, ["GET", "HEAD"]],
    [/^\/api\/audiobooks\/[^/]+\/epub$/, ["GET", "HEAD"]],
    [/^\/api\/operator\/grants$/, ["GET", "POST"]],
    [/^\/api\/operator\/grants\/[^/]+$/, ["GET"]],
    [/^\/api\/operator\/grants\/[^/]+\/allowance$/, ["PUT"]],
    [/^\/api\/operator\/grants\/[^/]+\/revocation$/, ["POST"]],
    [/^\/api\/operator\/grants\/[^/]+\/session-invalidations$/, ["POST"]],
    [/^\/api\/operator\/grant-migrations$/, ["POST"]],
  ];
  return routes.find(([pattern]) => pattern.test(pathname))?.[1];
}

function deriveEntryState(
  entry: Awaited<ReturnType<RegistryStub["getGrant"]>> & {},
  nowMs: number,
) {
  if (entry.phase !== "active" || entry.grantSnapshot === undefined) return "provisioning" as const;
  if (entry.grantSnapshot.revokedAtMs !== undefined) return "revoked" as const;
  if (nowMs >= entry.expiresAtMs) return "expired" as const;
  if (entry.grantSnapshot.spent >= entry.grantSnapshot.maxSlots) return "exhausted" as const;
  if (entry.grantSnapshot.spent + entry.grantSnapshot.reserved >= entry.grantSnapshot.maxSlots)
    return "temporarily-full" as const;
  return "open" as const;
}

async function validateAccessAssertion(
  assertion: string | undefined,
  env: ApiServerEnvironment,
): Promise<boolean> {
  if (
    assertion === undefined ||
    env.OPERATOR_ACCESS_ISSUER === undefined ||
    env.OPERATOR_ACCESS_AUDIENCE === undefined ||
    env.OPERATOR_EMAIL === undefined
  )
    return false;
  try {
    const { payload } = await jwtVerify(assertion, getAccessKeySet(env.OPERATOR_ACCESS_ISSUER), {
      issuer: env.OPERATOR_ACCESS_ISSUER,
      audience: env.OPERATOR_ACCESS_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "email"],
    });
    return payload["email"] === env.OPERATOR_EMAIL;
  } catch {
    return false;
  }
}

function getAccessKeySet(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const normalizedIssuer = issuer.replace(/\/$/, "");
  const existingKeySet = accessKeySets.get(normalizedIssuer);
  if (existingKeySet !== undefined) return existingKeySet;
  const keySet = createRemoteJWKSet(new URL(`${normalizedIssuer}/cdn-cgi/access/certs`));
  accessKeySets.set(normalizedIssuer, keySet);
  return keySet;
}

function nowMilliseconds(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

function toIsoString(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString();
}

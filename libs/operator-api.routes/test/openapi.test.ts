import util from "node:util";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { ERROR_CODE } from "#src/contracts.ts";
import { createOperatorOpenApiDocument } from "#src/hono-app.ts";

const HTTP_METHODS = ["get", "head", "post", "put", "patch", "delete"] as const;

/** The parts of an OpenAPI document the structural tests read. */
const openApiDocumentSchema = z.object({
  paths: z.record(
    z.string(),
    z.partialRecord(
      z.enum(HTTP_METHODS),
      z.object({
        parameters: z.array(z.object({ in: z.string(), name: z.string() })).optional(),
        requestBody: z
          .object({ required: z.boolean().optional(), content: z.record(z.string(), z.unknown()) })
          .optional(),
        responses: z.record(
          z.string(),
          z.object({
            content: z.record(z.string(), z.object({ schema: z.unknown() })).optional(),
          }),
        ),
      }),
    ),
  ),
});

/** Every operation of the document, named like `POST /api/operator/grants`. */
function listOperations() {
  const document = openApiDocumentSchema.parse(createOperatorOpenApiDocument());
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];
      return operation === undefined
        ? []
        : [{ name: `${method.toUpperCase()} ${path}`, method, operation }];
    }),
  );
}

describe("operator API OpenAPI document", () => {
  test("matches the committed snapshot", async () => {
    // Update the snapshot with `pnpm --filter '@cup/operator-api.routes' test -u`.
    await expect(
      `${JSON.stringify(createOperatorOpenApiDocument(), undefined, 2)}\n`,
    ).toMatchFileSnapshot("./__snapshots__/openapi.json");
  });

  test("every operation declares error responses, each with the shared error schema", () => {
    const operations = listOperations().map(({ name, operation }) => ({
      name,
      errorResponses: Object.entries(operation.responses)
        .filter(([status]) => Number(status) >= 400)
        .map(([status, response]) => ({ name: `${status} ${name}`, content: response.content })),
    }));
    const allErrorResponses = operations.flatMap(({ errorResponses }) => errorResponses);
    const sharedErrorSchema = allErrorResponses[0]?.content?.["application/json"]?.schema;

    expect(
      operations
        .filter(({ errorResponses }) => errorResponses.length === 0)
        .map(({ name }) => name),
    ).toStrictEqual([]);
    expect(sharedErrorSchema).toMatchObject({
      properties: {
        error: {
          properties: { code: { enum: Object.values(ERROR_CODE) } },
          required: ["code", "message", "requestId"],
        },
      },
    });
    expect(
      allErrorResponses
        .filter(
          ({ content }) =>
            Object.keys(content ?? {}).join() !== "application/json" ||
            !util.isDeepStrictEqual(content?.["application/json"]?.schema, sharedErrorSchema),
        )
        .map(({ name }) => name),
    ).toStrictEqual([]);
  });

  test("every request body is required JSON", () => {
    const operationsWithOtherBodies = listOperations().flatMap(({ name, operation }) =>
      operation.requestBody !== undefined &&
      (operation.requestBody.required !== true ||
        Object.keys(operation.requestBody.content).join() !== "application/json")
        ? [name]
        : [],
    );

    expect(operationsWithOtherBodies).toStrictEqual([]);
  });
});

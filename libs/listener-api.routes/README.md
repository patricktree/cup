# Listener API contracts

This package defines the listener API's routes, request and response schemas, and error codes. The [API definitions](../../docs/architecture/README.md#api-definitions) describe how the server and clients use them.

## OpenAPI snapshot

The [OpenAPI test](test/openapi.test.ts) generates the listener API's OpenAPI document with `createListenerOpenApiDocument`, the same function the [listener client's export script](../listener-api.client/scripts/export-openapi-json.ts) uses, and compares it with the committed [snapshot](test/__snapshots__/openapi.json). The test also checks contract-wide rules, such as the shared error schema and the `400 invalid-input` response.

After an intended contract change, update the snapshot and review its diff:

```sh
pnpm --filter '@cup/listener-api.routes' test -u
```

## Error codes

`ERROR_CODE` in the [contracts](src/contracts.ts) lists every code a listener API error response can carry, including the codes of server-wide middleware. The server's `jsonError` accepts only these codes and the operator API's codes. When you add a code, also add it to `ERROR_CODE` in the [listener client](../listener-api.client/src/rpc-error.ts); the client fails to compile until both lists match.

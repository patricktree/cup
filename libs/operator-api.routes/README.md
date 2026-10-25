# Operator API contracts

This package defines the operator API's routes, request and response schemas, and error codes. The [API definitions](../../docs/architecture/README.md#api-definitions) describe how the server and the operator CLI use them.

## OpenAPI snapshot

The [OpenAPI test](test/openapi.test.ts) generates the operator API's OpenAPI document with `createOperatorOpenApiDocument` and compares it with the committed [snapshot](test/__snapshots__/openapi.json). The document is not exported to a build output. The test also checks that every operation declares error responses with the shared error schema, that every operation with request parameters or a request body declares the `400 invalid-input` response its validation hook returns, and that request bodies are required JSON. Account inspection is exempt from the 400 check because its own hook answers an invalid account ID with `404 account-unavailable`.

After an intended contract change, update the snapshot and review its diff:

```sh
pnpm --filter '@cup/operator-api.routes' test -u
```

## Error codes

`ERROR_CODE` in the [contracts](src/contracts.ts) lists every code an operator API error response can carry, including the codes of server-wide middleware. The server's `jsonError` accepts only these codes and the listener API's codes. When you add a code, also add it to `ERROR_CODE` in the [operator client](../operator-api.client/src/rpc-error.ts); the client fails to compile until both lists match.

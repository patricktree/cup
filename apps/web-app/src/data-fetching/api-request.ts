import {
  parseOkResponse,
  type AuthenticatedRpcClient,
  type ListenerApiClient,
} from "@cup/listener-api.client";

import { createAppApiClient } from "#src/api-client.js";
import { getFreshAccountSession, getResourceAccountSession } from "#src/auth/account-session.js";
import { UserFacingError } from "#src/errors.js";

/** Every unsuccessful API response rejects with this error; see {@link requestApi}. */
export { RpcError } from "@cup/listener-api.client";

type ApiResponse = Awaited<Parameters<typeof parseOkResponse>[0]>;
type ApiResult<Response extends ApiResponse> = ReturnType<typeof parseOkResponse<Response>>;
type AccountAuth = { subject: string };

/**
 * Sends one API request with a freshly resolved account token and returns its parsed payload. Grant
 * sessions travel as cookies independently of the account authorization chosen here:
 *
 * - `"none"`: no account token.
 * - `"optional"`: the signed-in account's token if there is one, e.g. for an article that a
 *   conversion grant or an account may own.
 * - `{ subject }`: the account the request was issued for must still be signed in; otherwise the
 *   request is rejected before dispatch.
 *
 * Unsuccessful responses reject with `RpcError`; a missing or changed required account rejects with
 * a plain `Error` before the request is sent.
 */
export function requestApi<Response extends ApiResponse>(
  auth: "none",
  send: (client: ListenerApiClient) => Promise<Response>,
): ApiResult<Response>;
export function requestApi<Response extends ApiResponse>(
  auth: "optional",
  send: (client: ListenerApiClient | AuthenticatedRpcClient) => Promise<Response>,
): ApiResult<Response>;
export function requestApi<Response extends ApiResponse>(
  auth: AccountAuth,
  send: (client: AuthenticatedRpcClient) => Promise<Response>,
): ApiResult<Response>;
export async function requestApi<Response extends ApiResponse>(
  ...[auth, send]:
    | [auth: "none", send: (client: ListenerApiClient) => Promise<Response>]
    | [
        auth: "optional",
        send: (client: ListenerApiClient | AuthenticatedRpcClient) => Promise<Response>,
      ]
    | [auth: AccountAuth, send: (client: AuthenticatedRpcClient) => Promise<Response>]
): ApiResult<Response> {
  const client = createAppApiClient();
  if (auth === "none") {
    return parseOkResponse(send(client));
  }

  if (auth === "optional") {
    const session = await getResourceAccountSession();
    return parseOkResponse(
      send(session ? client.createAuthenticatedRpcClient(session.access_token) : client),
    );
  }

  const session = await getFreshAccountSession();
  if (session?.user.id !== auth.subject) {
    throw new UserFacingError({ title: "Sign in to continue." });
  }
  return parseOkResponse(send(client.createAuthenticatedRpcClient(session.access_token)));
}

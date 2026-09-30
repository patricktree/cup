import { hc } from "hono/client";

import type {
  CreateGrantRequest,
  GrantParams,
  ListGrantsQuery,
  OperatorApiApp,
  OperatorApiClient as OperatorHonoClient,
} from "@cup/operator-api.routes";

const createClient = (...args: Parameters<typeof hc>): OperatorHonoClient =>
  hc<OperatorApiApp>(...args);

/** Focused typed client for the operator RPC actions. */
export class OperatorApiClient {
  #client: ReturnType<typeof createClient>;
  #accessToken: string;

  constructor(baseUrl: string, accessToken: string) {
    this.#client = createClient(baseUrl.replace(/\/$/, ""), {});
    this.#accessToken = accessToken;
  }

  createGrant(input: CreateGrantRequest) {
    return this.#client.api.operator.grants.$post({ json: input }, this.options());
  }

  listGrants(query: ListGrantsQuery) {
    return this.#client.api.operator.grants.$get({ query }, this.options());
  }

  inspectGrant(params: GrantParams) {
    return this.#client.api.operator.grants[":grantId"].$get({ param: params }, this.options());
  }

  setGrantAllowance(params: GrantParams, allowanceMilliseconds: number) {
    return this.#client.api.operator.grants[":grantId"].allowance.$put(
      { param: params, json: { allowanceMilliseconds } },
      this.options(),
    );
  }

  revokeGrant(params: GrantParams) {
    return this.#client.api.operator.grants[":grantId"].revocation.$post(
      { param: params, json: {} },
      this.options(),
    );
  }

  invalidateSessions(params: GrantParams, reason: string) {
    return this.#client.api.operator.grants[":grantId"]["session-invalidations"].$post(
      { param: params, json: { reason } },
      this.options(),
    );
  }

  migrateGrants() {
    return this.#client.api.operator["grant-migrations"].$post({ json: {} }, this.options());
  }

  private options() {
    return { headers: { "Cf-Access-Token": this.#accessToken } };
  }
}

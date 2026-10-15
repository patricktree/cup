import type {
  AccountParams,
  AdjustAccountAllowanceRequest,
  CreateGrantRequest,
  GrantParams,
  ListAccountsQuery,
  ListGrantsQuery,
} from "@cup/operator-api.routes";

import { createHonoClient, type HonoClient } from "#src/hono-client.ts";

/** Focused typed client for the operator RPC actions. */
export class OperatorApiClient {
  #honoClient: HonoClient;
  #accessToken: string;

  constructor(baseUrl: string, accessToken: string) {
    this.#honoClient = createHonoClient(baseUrl);
    this.#accessToken = accessToken;
  }

  async createGrant(input: CreateGrantRequest) {
    return this.#honoClient.api.operator.grants.$post({ json: input }, this.#options());
  }

  async listGrants(query: ListGrantsQuery, signal?: AbortSignal) {
    return this.#honoClient.api.operator.grants.$get({ query }, this.#options(signal));
  }

  async inspectGrant(params: GrantParams, signal?: AbortSignal) {
    return this.#honoClient.api.operator.grants[":grantId"].$get(
      { param: params },
      this.#options(signal),
    );
  }

  async setGrantAllowance(params: GrantParams, allowanceMilliseconds: number) {
    return this.#honoClient.api.operator.grants[":grantId"].allowance.$put(
      { param: params, json: { allowanceMilliseconds } },
      this.#options(),
    );
  }

  async revokeGrant(params: GrantParams) {
    return this.#honoClient.api.operator.grants[":grantId"].revocation.$post(
      { param: params, json: {} },
      this.#options(),
    );
  }

  async invalidateSessions(params: GrantParams, reason: string) {
    return this.#honoClient.api.operator.grants[":grantId"]["session-invalidations"].$post(
      { param: params, json: { reason } },
      this.#options(),
    );
  }

  async migrateGrants() {
    return this.#honoClient.api.operator["grant-migrations"].$post({ json: {} }, this.#options());
  }

  async inspectAccount(params: AccountParams, signal?: AbortSignal) {
    return this.#honoClient.api.operator.accounts[":accountId"].$get(
      { param: params },
      this.#options(signal),
    );
  }

  async listAccountDeletions(signal?: AbortSignal) {
    return this.#honoClient.api.operator.accounts.deletions.$get({}, this.#options(signal));
  }

  async listAccounts(query: ListAccountsQuery, signal?: AbortSignal) {
    return this.#honoClient.api.operator.accounts.$get({ query }, this.#options(signal));
  }

  async adjustAccountAllowance(params: AccountParams, input: AdjustAccountAllowanceRequest) {
    return this.#honoClient.api.operator.accounts[":accountId"]["allowance-adjustments"].$post(
      { param: params, json: input },
      this.#options(),
    );
  }

  #options(signal?: AbortSignal) {
    return {
      headers: { "Cf-Access-Token": this.#accessToken },
      ...(signal === undefined ? {} : { init: { signal } }),
    };
  }
}

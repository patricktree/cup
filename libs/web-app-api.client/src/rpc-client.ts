import type {
  AccountConfirmationRequest,
  ConversionParams,
  ExchangeCredentialRequest,
  GrantParams,
  StartConversionRequest,
} from "@cup/web-app-api.routes";

import { createHonoClient, type HonoClient } from "#src/hono-client.ts";

/** Typed public API client; account requests use an authenticated scoped client. */
export class WebAppApiClient {
  #honoClient: HonoClient;
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
    this.#honoClient = createHonoClient(baseUrl);
  }

  createAuthenticatedRpcClient(accessToken: string): AuthenticatedRpcClient {
    return new AuthenticatedRpcClient(this.#honoClient, accessToken);
  }

  async getAuthConfig() {
    return this.#honoClient.api.auth.config.$get();
  }

  async clearMediaSession() {
    return this.#honoClient.api.media.session.$delete(
      { header: browserHeaders() },
      { init: { credentials: "include" } },
    );
  }

  async exchangeCredential(params: GrantParams, input: ExchangeCredentialRequest) {
    return this.#honoClient.api.grants[":grantId"].sessions.$post({
      param: params,
      json: input,
      header: browserHeaders(),
    });
  }

  async getGrant(params: GrantParams, signal?: AbortSignal) {
    return this.#honoClient.api.grants[":grantId"].$get(
      { param: params },
      signal === undefined ? undefined : { init: { signal } },
    );
  }

  async getConversion(params: ConversionParams, signal?: AbortSignal) {
    return this.#honoClient.api.conversions[":conversionId"].$get(
      { param: params },
      signal === undefined ? undefined : { init: { signal } },
    );
  }

  async startTrialConversion(
    params: GrantParams,
    input: StartConversionRequest,
    idempotencyKey: string,
  ) {
    return this.#honoClient.api.grants[":grantId"].conversions.$post({
      param: params,
      json: input,
      header: { ...browserHeaders(), "idempotency-key": idempotencyKey },
    });
  }

  async getAudiobook(params: ConversionParams, signal?: AbortSignal) {
    return this.#honoClient.api.audiobooks[":conversionId"].$get(
      { param: params },
      signal === undefined ? undefined : { init: { signal } },
    );
  }

  createAudiobookPageUrl(params: ConversionParams): URL {
    return new URL(`/app/audiobooks/${encodeURIComponent(params.conversionId)}`, this.#baseUrl);
  }
}

export class AuthenticatedRpcClient {
  #honoClient: HonoClient;
  #accessToken: string;

  constructor(honoClient: HonoClient, accessToken: string) {
    this.#honoClient = honoClient;
    this.#accessToken = accessToken;
  }

  async getAccount(signal?: AbortSignal) {
    return this.#honoClient.api.account.$get({}, this.#options(signal));
  }

  async getHistory(cursor?: string, signal?: AbortSignal) {
    return this.#honoClient.api.account.conversions.$get(
      { query: { cursor } },
      this.#options(signal),
    );
  }

  async startAccountConversion(input: StartConversionRequest, idempotencyKey: string) {
    return this.#honoClient.api.account.conversions.$post(
      {
        json: input,
        header: { ...browserHeaders(), "idempotency-key": idempotencyKey },
      },
      this.#options(),
    );
  }

  async createDeletionChallenge() {
    return this.#honoClient.api.account.deletion.challenge.$post(
      { json: {}, header: browserHeaders() },
      this.#options(),
    );
  }

  async scheduleDeletion(input: AccountConfirmationRequest) {
    return this.#honoClient.api.account.deletion.$post(
      { json: input, header: browserHeaders() },
      this.#options(),
    );
  }

  async restoreAccount(input: AccountConfirmationRequest) {
    return this.#honoClient.api.account.deletion.restore.$post(
      { json: input, header: browserHeaders() },
      this.#options(),
    );
  }

  async createMediaSession() {
    return this.#honoClient.api.media.session.$post(
      { json: {}, header: browserHeaders() },
      this.#options(),
    );
  }

  async getConversion(params: ConversionParams, signal?: AbortSignal) {
    return this.#honoClient.api.conversions[":conversionId"].$get(
      { param: params },
      this.#options(signal),
    );
  }

  async getAudiobook(params: ConversionParams, signal?: AbortSignal) {
    return this.#honoClient.api.audiobooks[":conversionId"].$get(
      { param: params },
      this.#options(signal),
    );
  }

  #options(signal?: AbortSignal) {
    return {
      headers: { Authorization: `Bearer ${this.#accessToken}` },
      init: { credentials: "include" as const, ...(signal === undefined ? {} : { signal }) },
    };
  }
}

function browserHeaders() {
  return {
    "x-create-audiobook-from-url-request": "1" as const,
    "content-type": "application/json" as const,
  };
}

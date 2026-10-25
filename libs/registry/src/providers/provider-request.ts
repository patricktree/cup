/** How a provider call goes out; the caller supplies it so tests can drive local stand-ins. */
export type ProviderRequest = {
  request: typeof fetch;
  /** Applies to each call. */
  timeoutMs: number;
};

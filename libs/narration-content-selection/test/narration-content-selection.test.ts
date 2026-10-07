import { expect, test } from "vitest";

import { selectNarrationContent as productionSelector } from "@cup/narration-content-selection";

import {
  createContentSelector,
  selectElementIds,
  type SelectionCompletionResponse,
  type SelectionConfig,
  type SelectionCompletion,
  type SelectionToolCall,
  type SelectionChunkRunner,
} from "#src/narration-content-selection.ts";
import { PRODUCTION_CONFIG } from "#src/production-narration-content-selection.ts";
import { SOURCE_ELEMENT_ID_ATTRIBUTE } from "#src/source-element-selection.ts";

test("returns selected narration HTML in document order without internal element IDs", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage(
      fauxToolCall("select_narration_content", { element_ids: ["2", "0", "2"] }),
      {
        stopReason: "toolUse",
      },
    ),
  );

  const result = await selectNarrationContent("<p>Zero</p><p>One</p><p>Two</p>");

  expect(result).toEqual(fauxSelectionResult("<p>Zero</p><p>Two</p>"));
});

test("preserves semantic attributes in model input and selected output", async () => {
  let input = "";
  const response = fauxAssistantMessage([], { stopReason: "toolUse" });
  const selector = createContentSelector(
    createConfiguration(response, {
      completion: async (request) => {
        input = request.userPrompt;
        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: ["0"] }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );
  const result = await selector(
    '<div id="article" class="article-body" data-section="main"><p class="body" style="color:red">Read <a href="/source" title="Source">this</a>.</p></div>',
  );
  expect(input).toContain('class="article-body"');
  expect(input).not.toContain(' id="article"');
  expect(input).toContain('data-section="main"');
  expect(input).toContain('style="color:red"');
  expect(input).toContain("Read ");
  expect(input).toContain('href="/source"');
  expect(result.selectedSourceMaterialHtml).toBe(
    '<div id="article" class="article-body" data-section="main"><p class="body" style="color:red">Read <a href="/source" title="Source">this</a>.</p></div>',
  );
});

test("collapses formatting whitespace only in model input while preserving source wording", async () => {
  let input = "";
  const selector = createContentSelector(
    createConfiguration(fauxAssistantMessage(), {
      completion: async (request) => {
        input = request.userPrompt;
        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: ["0"] }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );
  const source = '<p id="work">Test both\n    <em>cases</em>\n    carefully.<br>Next line.</p>';

  const result = await selector(source);

  expect(input).toContain(
    `<p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0">Test both <em ${SOURCE_ELEMENT_ID_ATTRIBUTE}="1">cases</em> carefully.<br ${SOURCE_ELEMENT_ID_ATTRIBUTE}="2">Next line.</p>`,
  );
  expect(result.selectedSourceMaterialHtml).toBe(source);
});

test("corrects Wikipedia IDs without losing source attributes or retry usage", async () => {
  const requests: string[] = [];
  const attempts: unknown[] = [];
  const selector = createContentSelector(
    createConfiguration(fauxAssistantMessage(), {
      completion: async (request, options) => {
        requests.push(request.userPrompt);
        attempts.push(options?.gatewayMetadata?.["selectionAttempt"]);
        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", {
            element_ids: requests.length === 1 ? ["mwBhY"] : ["0"],
          }),
          { stopReason: "toolUse", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
        );
      },
    }),
  );
  const source = '<p id="mwBhY">Sherlock Holmes <a href="#mwBig">reference</a></p>';
  const result = await selector(source, { conversionId: "wikipedia" });
  expect(requests[0]).not.toContain(' id="mwBhY"');
  expect(requests[0]).toContain('data-createaudiobookfromurl-element-id="0"');
  expect(requests[1]).toContain("mwBhY");
  expect(requests[1]).toContain('Valid element IDs for this chunk: ["0","1"]');
  expect(attempts).toEqual([1, 2]);
  expect(result.selectedSourceMaterialHtml).toBe(source);
  expect(result.usage).toMatchObject({
    requestCount: 2,
    inputTokens: 20,
    outputTokens: 4,
    totalTokens: 24,
  });
});

test("stops after one correction when the model keeps returning unknown IDs", async () => {
  let calls = 0;
  const selector = createContentSelector(
    createConfiguration(fauxAssistantMessage(), {
      completion: async () => {
        calls += 1;
        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: ["mwBhY"] }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );
  await expect(selector('<p id="mwBhY">Sherlock Holmes</p>')).rejects.toThrow(
    "unknown data-createaudiobookfromurl-element-id values: mwBhY",
  );
  expect(calls).toBe(2);
});

test("reuses completed chunk results when selection is replayed after a failure", async () => {
  const cached = new Map<number, Awaited<ReturnType<SelectionChunkRunner>>>();
  const calls: number[] = [];
  let shouldFail = true;
  const runChunk: SelectionChunkRunner = async (index, select) => {
    const previous = cached.get(index);
    if (previous) return previous;
    calls.push(index);
    if (index === 1 && shouldFail) throw new Error("Temporary provider failure");
    const result = await select();
    cached.set(index, result);
    return result;
  };
  const response = fauxAssistantMessage([], { stopReason: "toolUse" });
  const selector = createContentSelector(
    createConfiguration(response, {
      completion: async (request) =>
        fauxAssistantMessage(
          fauxToolCall("select_narration_content", {
            element_ids: [
              ...request.userPrompt.matchAll(
                new RegExp(`${SOURCE_ELEMENT_ID_ATTRIBUTE}="([^"]+)"`, "g"),
              ),
            ].map((match) => match[1]!),
          }),
          { stopReason: "toolUse" },
        ),
    }),
  );
  const source =
    "<article>" +
    Array.from({ length: 201 }, (_, index) => `<p>Paragraph ${index}</p>`).join("") +
    "</article>";
  await expect(selector(source, { runChunk })).rejects.toThrow("Temporary provider failure");
  await expect.poll(() => cached.has(0)).toBe(true);
  shouldFail = false;
  const result = await selector(source, { runChunk });
  expect(calls).toEqual([0, 1, 1]);
  expect(result.selectedSourceMaterialHtml).toBe(source);
  expect(result.chunkCount).toBe(2);
});

test("selects narration content from source material larger than one completion request", async () => {
  const maximumElementsPerCompletion = 200;
  const completionElementCounts: number[] = [];
  const completionInputs: string[] = [];
  const sourceMaterialHtml = `<article>${Array.from(
    { length: maximumElementsPerCompletion + 1 },
    (_, index) => `<p>Paragraph ${index}</p>`,
  ).join("")}</article>`;
  const response = fauxAssistantMessage([], { stopReason: "toolUse" });
  const selectNarrationContent = createContentSelector(
    createConfiguration(response, {
      completion: async (context) => {
        const elementIds = [
          ...context.userPrompt.matchAll(
            new RegExp(`${SOURCE_ELEMENT_ID_ATTRIBUTE}="([^"]+)"`, "g"),
          ),
        ].map((match) => match[1]!);

        completionInputs.push(context.userPrompt);
        completionElementCounts.push(elementIds.length);

        if (elementIds.length > maximumElementsPerCompletion) {
          throw new Error("Completion received oversized source material");
        }

        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: elementIds }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );

  await expect(selectNarrationContent(sourceMaterialHtml)).resolves.toEqual({
    ...fauxSelectionResult(sourceMaterialHtml, 2),
    chunkCount: 2,
  });
  expect(completionElementCounts).toEqual([maximumElementsPerCompletion, 1]);
  expect(completionInputs).toHaveLength(2);

  for (const completionInput of completionInputs) {
    expect(completionInput).toContain("<article>");
    expect(completionInput).not.toContain(`<article ${SOURCE_ELEMENT_ID_ATTRIBUTE}=`);
  }
});

test("splits source material by serialized size below the element limit", async () => {
  const sourceMaterialHtml = `<article><p>${"A".repeat(16_000)}</p><p>${"B".repeat(16_000)}</p></article>`;
  const response = fauxAssistantMessage([], { stopReason: "toolUse" });
  const completionElementCounts: number[] = [];
  const selectNarrationContent = createContentSelector(
    createConfiguration(response, {
      completion: async (context) => {
        const elementIds = [
          ...context.userPrompt.matchAll(
            new RegExp(`${SOURCE_ELEMENT_ID_ATTRIBUTE}="([^"]+)"`, "g"),
          ),
        ].map((match) => match[1]!);
        completionElementCounts.push(elementIds.length);

        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: elementIds }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );

  await expect(selectNarrationContent(sourceMaterialHtml)).resolves.toEqual({
    ...fauxSelectionResult(sourceMaterialHtml, 2),
    chunkCount: 2,
  });
  expect(completionElementCounts).toEqual([1, 1]);
});

test("starts the next completion as soon as a concurrency slot becomes available", async () => {
  const pendingCompletions = Array.from({ length: 6 }, () => createDeferred());
  const firstSixCompletionsStarted = createDeferred();
  const seventhCompletionStarted = createDeferred();
  let startedCompletionCount = 0;
  const sourceMaterialHtml = `<article>${Array.from(
    { length: 7 },
    (_, index) => `<p>${index}-${"A".repeat(24_000)}</p>`,
  ).join("")}</article>`;
  const selectNarrationContent = createContentSelector(
    createConfiguration(fauxAssistantMessage(), {
      completion: async (context) => {
        const completionIndex = startedCompletionCount;
        startedCompletionCount += 1;

        if (startedCompletionCount === 6) {
          firstSixCompletionsStarted.resolve();
        }

        if (startedCompletionCount === 7) {
          seventhCompletionStarted.resolve();
        }

        const elementIds = [
          ...context.userPrompt.matchAll(
            new RegExp(`${SOURCE_ELEMENT_ID_ATTRIBUTE}="([^"]+)"`, "g"),
          ),
        ].map((match) => match[1]!);

        if (completionIndex < pendingCompletions.length) {
          await pendingCompletions[completionIndex]!.promise;
        }

        return fauxAssistantMessage(
          fauxToolCall("select_narration_content", { element_ids: elementIds }),
          { stopReason: "toolUse" },
        );
      },
    }),
  );

  const selection = selectNarrationContent(sourceMaterialHtml);
  await firstSixCompletionsStarted.promise;

  expect(startedCompletionCount).toBe(6);

  pendingCompletions[0]!.resolve();
  await seventhCompletionStarted.promise;

  expect(startedCompletionCount).toBe(7);

  for (const pendingCompletion of pendingCompletions.slice(1)) {
    pendingCompletion.resolve();
  }

  await expect(selection).resolves.toEqual({
    ...fauxSelectionResult(sourceMaterialHtml, 7),
    chunkCount: 7,
  });
});

test("rejects source material when every completion selects no narration content", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage(fauxToolCall("select_narration_content", { element_ids: [] }), {
      stopReason: "toolUse",
    }),
  );

  await expect(selectNarrationContent("<p>Not narration content</p>")).rejects.toThrow(
    "Expected at least one narration source element ID",
  );
});

test("uses the configured prompt, tool, completion options, and abort signal", async () => {
  const response = fauxAssistantMessage(
    fauxToolCall("experimental_select", { element_ids: ["0"] }),
    { stopReason: "toolUse" },
  );
  const abortController = new AbortController();
  const completionContexts: unknown[] = [];
  const completionOptions: unknown[] = [];
  const configuration = createConfiguration(response, {
    completion: async (context, options) => {
      completionContexts.push(context);
      completionOptions.push(options);
      return response;
    },
    systemPrompt: "Experimental system prompt",
    tool: {
      ...PRODUCTION_CONFIG.tool,
      name: "experimental_select",
      description: "Experimental tool description",
    },
    completionOptions: {
      reasoningEffort: "medium",
      maxTokens: 2_048,
    },
  });
  const selectNarrationContent = createContentSelector(configuration);

  await selectNarrationContent("<p>Narrate me</p>", {
    signal: abortController.signal,
    conversionId: "conversion-123",
  });

  expect(completionContexts).toEqual([
    expect.objectContaining({
      systemPrompt: "Experimental system prompt",
      tool: expect.objectContaining({
        name: "experimental_select",
        description: "Experimental tool description",
      }),
    }),
  ]);
  expect(completionOptions).toEqual([
    {
      maxTokens: 2_048,
      reasoningEffort: "medium",
      signal: expect.any(AbortSignal),
      gatewayMetadata: {
        conversionId: "conversion-123",
        stage: "content-selection",
        chunkIndex: 1,
        selectionAttempt: 1,
      },
    },
  ]);
});

test("uses Gemini through AI Gateway and accounts for cached input and reasoning", async () => {
  const response = await PRODUCTION_CONFIG.completion(
    {
      systemPrompt: "Select narration content",
      userPrompt: "<p>Text</p>",
      tool: PRODUCTION_CONFIG.tool,
    },
    {
      ...PRODUCTION_CONFIG.completionOptions,
      apiKey: "test-api-key",
      env: { CLOUDFLARE_ACCOUNT_ID: "test-account" },
      gatewayMetadata: { conversionId: "conversion-123", chunkIndex: 1 },
      fetch: async (url, init) => {
        expect(url).toBe(
          "https://gateway.ai.cloudflare.com/v1/test-account/default/google-ai-studio/v1beta/openai/chat/completions",
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("cf-aig-authorization")).toBe("Bearer test-api-key");
        expect(headers.get("cf-aig-collect-log-payload")).toBe("false");
        expect(JSON.parse(headers.get("cf-aig-metadata")!)).toEqual({
          conversionId: "conversion-123",
          chunkIndex: 1,
        });
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        const body: unknown = JSON.parse(init.body);
        // Gemini rejects sampling parameters on upcoming models.
        expect(body).not.toHaveProperty("temperature");
        expect(body).toMatchObject({
          model: "gemini-3.8-flash",
          max_tokens: 4096,
          reasoning_effort: "low",
          messages: [
            { role: "system", content: "Select narration content" },
            { role: "user", content: "<p>Text</p>" },
          ],
          tools: [{ type: "function", function: PRODUCTION_CONFIG.tool }],
          tool_choice: { type: "function", function: { name: "select_narration_content" } },
        });
        expect(headers.has("authorization")).toBe(false);
        return Response.json({
          id: "completion-123",
          model: "gemini-3.8-flash",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "0",
                    type: "function",
                    function: {
                      name: "select_narration_content",
                      arguments: JSON.stringify({ element_ids: ["0"] }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens: 5,
            completion_tokens_details: { reasoning_tokens: 2 },
            total_tokens: 15,
          },
        });
      },
    },
  );
  expect(response).toMatchObject({
    provider: "google-ai-studio",
    model: "gemini-3.8-flash",
    stopReason: "toolUse",
    toolCalls: [{ id: "0", name: "select_narration_content", arguments: { element_ids: ["0"] } }],
    usage: {
      inputTokens: 6,
      cacheReadTokens: 4,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 15,
    },
  });
  expect(response.usage.estimatedCostUsd).toBeCloseTo(0.00002355, 10);
});

test("preserves truncation and missing reasoning usage with partial tool arguments", async () => {
  const response = await PRODUCTION_CONFIG.completion(
    { systemPrompt: "Select", userPrompt: "Text", tool: PRODUCTION_CONFIG.tool },
    {
      apiKey: "test-api-key",
      env: { CLOUDFLARE_ACCOUNT_ID: "test-account" },
      fetch: async () =>
        Response.json({
          id: "truncated",
          model: "gemini-3.8-flash",
          choices: [
            {
              finish_reason: "length",
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "0",
                    type: "function",
                    function: {
                      name: "select_narration_content",
                      arguments: '{"element_ids":[',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4096, total_tokens: 4106 },
        }),
    },
  );
  expect(response.stopReason).toBe("length");
  expect(response.toolCalls).toEqual([]);
  expect(response.usage.outputTokens).toBe(4096);
  expect(response.usage.reasoningTokens).toBeUndefined();
});

test("does not retry failed Gemini requests inside the workflow attempt", async () => {
  let requests = 0;
  await expect(
    PRODUCTION_CONFIG.completion(
      { systemPrompt: "Select", userPrompt: "Text", tool: PRODUCTION_CONFIG.tool },
      {
        ...PRODUCTION_CONFIG.completionOptions,
        apiKey: "test-api-key",
        env: { CLOUDFLARE_ACCOUNT_ID: "test-account" },
        fetch: async () => {
          requests += 1;
          return Response.json({ error: { message: "Unavailable" } }, { status: 503 });
        },
      },
    ),
  ).rejects.toThrow("Unavailable");
  expect(requests).toBe(1);
});

test("cancels an in-flight Gemini request when the caller aborts", async () => {
  const controller = new AbortController();
  let requests = 0;
  await expect(
    PRODUCTION_CONFIG.completion(
      { systemPrompt: "Select", userPrompt: "Text", tool: PRODUCTION_CONFIG.tool },
      {
        apiKey: "test-api-key",
        env: { CLOUDFLARE_ACCOUNT_ID: "test-account" },
        signal: controller.signal,
        fetch: async (_url, init) => {
          requests += 1;
          const signal = init?.signal;
          if (!signal) throw new Error("Expected request signal");
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
            controller.abort();
          });
        },
      },
    ),
  ).rejects.toThrow(/abort/i);
  expect(requests).toBe(1);
});

test("rejects truncated output without repeatedly generating the same selection", async () => {
  let requestCount = 0;
  const response = fauxAssistantMessage([], { stopReason: "length" });
  const selector = createContentSelector(
    createConfiguration(response, {
      completion: async () => {
        requestCount += 1;
        return response;
      },
      completionOptions: { maxTokens: 4_096 },
    }),
  );
  await expect(selector("<p>Narrate me</p>")).rejects.toThrow("exceeded its output token budget");
  expect(requestCount).toBe(1);
});

test("rejects a response without the selection tool call", async () => {
  const selectNarrationContent = createSelector(fauxAssistantMessage(fauxText("No selection")));

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "Expected exactly one select_narration_content call, received 0 (stop reason: stop)",
  );
});

test("rejects multiple selection tool calls", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage(
      [
        fauxToolCall("select_narration_content", { element_ids: ["0"] }),
        fauxToolCall("select_narration_content", { element_ids: ["0"] }),
      ],
      { stopReason: "toolUse" },
    ),
  );

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "Expected exactly one select_narration_content call, received 2 (stop reason: toolUse)",
  );
});

test("reports provider errors", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "provider unavailable",
    }),
  );

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "The AI request error: provider unavailable",
  );
});

test("reports a missing provider error message", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage([], { stopReason: "aborted" }),
  );

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "The AI request aborted: The provider did not provide an error message",
  );
});

test("rejects malformed selection tool arguments", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage(fauxToolCall("select_narration_content", { element_ids: null }), {
      stopReason: "toolUse",
    }),
  );

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "The AI selection tool arguments were invalid",
  );
});

test("rejects element IDs that were not supplied to the model", async () => {
  const selectNarrationContent = createSelector(
    fauxAssistantMessage(fauxToolCall("select_narration_content", { element_ids: ["unknown"] }), {
      stopReason: "toolUse",
    }),
  );

  await expect(selectNarrationContent("<p>Narrate me</p>")).rejects.toThrow(
    "The AI selected unknown data-createaudiobookfromurl-element-id values: unknown",
  );
});

test("rejects an inconsistent source element ID collection", async () => {
  const response = fauxAssistantMessage(
    fauxToolCall("select_narration_content", { element_ids: ["0"] }),
    { stopReason: "toolUse" },
  );
  const elementIds = Object.assign(["0"], { filter: () => [] });

  await expect(
    selectElementIds({
      configuration: createConfiguration(response),
      annotatedSourceMaterial: { html: "", elementIds },
    }),
  ).rejects.toThrow("Expected at least one narration source element ID");
});

test("exports the production narration content selector", () => {
  expect(productionSelector).toBeTypeOf("function");
});

function createSelector(response: SelectionCompletionResponse) {
  return createContentSelector(createConfiguration(response));
}

function createConfiguration(
  response: SelectionCompletionResponse,
  overrides: Partial<SelectionConfig> = {},
): SelectionConfig {
  return {
    ...PRODUCTION_CONFIG,
    completion: createCompletion(response),
    ...overrides,
  };
}

function createCompletion(response: SelectionCompletionResponse): SelectionCompletion {
  return async () => response;
}

function fauxAssistantMessage(
  content: SelectionToolCall | readonly SelectionToolCall[] | undefined = [],
  overrides: Partial<SelectionCompletionResponse> = {},
): SelectionCompletionResponse {
  const toolCalls = content === undefined ? [] : Array.isArray(content) ? content : [content];

  return {
    provider: "faux",
    model: "faux-model",
    toolCalls,
    stopReason: "stop",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    ...overrides,
  };
}

function fauxToolCall(name: string, argumentsValue: unknown): SelectionToolCall {
  return { id: `call-${name}`, name, arguments: argumentsValue };
}

function fauxText(_text: string): undefined {
  return undefined;
}

function fauxSelectionResult(selectedSourceMaterialHtml: string, requestCount = 1) {
  return {
    selectedSourceMaterialHtml,
    chunkCount: 1,
    usage: {
      provider: "faux",
      model: "faux-model",
      requestCount,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

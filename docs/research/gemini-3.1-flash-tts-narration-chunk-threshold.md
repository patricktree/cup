# Gemini 3.1 Flash TTS narration chunk threshold

## Question

How large may one narration chunk be when synthesized with
`gemini-3.1-flash-tts-preview`, while prioritizing consistent audiobook narration?

## Findings

- The model accepts text and produces audio. Its hard limits are 8,192 input tokens
  and 16,384 output tokens. These are capacity limits, not quality targets.
  [Gemini 3.1 Flash TTS Preview model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview?hl=en)
- Google warns specifically for this model that speech quality and consistency may
  drift when generated output is longer than a few minutes. Google recommends
  splitting transcripts into smaller chunks.
  [Gemini TTS limitations](https://ai.google.dev/gemini-api/docs/speech-generation?hl=en#limitations)
- Google describes roughly four characters per token and 60–80 English words per
  100 tokens. These are estimates, so a character limit cannot guarantee a token
  count across languages and content.
  [Understand and count tokens](https://ai.google.dev/gemini-api/docs/tokens?hl=en#about_tokens)
- The `models.countTokens` endpoint runs the selected model's tokenizer over the
  supplied input and returns its input token count. Counting the complete textual
  input would include any future natural-language performance direction as well as
  the transcript.
  [Counting tokens API](https://ai.google.dev/api/tokens)
- Single-speaker generation requires one configured voice. It does not require
  speaker labels, so the current request has no necessary textual speaker-label
  overhead.
  [Single-speaker TTS](https://ai.google.dev/gemini-api/docs/speech-generation?hl=en#single-speaker)

The generic TTS guide also mentions a 32,000-token session context window. The
model-specific 8,192-token input limit is the relevant hard ceiling for the model
used here.

## Recommendation

Use **2,000 characters** as the initial maximum for one narration chunk. Apply the
limit within each narration block, so ordinary paragraphs remain intact and only
oversized blocks are split.

For English, Google's approximation maps 2,000 characters to about 500 input
tokens or 300–400 words. This is far below the hard input limit and is a practical
starting point for staying around, rather than substantially beyond, Google's
vague "few minutes" quality boundary. Google does not publish a precise
quality-preserving character, word, token, or duration threshold, so 2,000
characters is a product heuristic that should be validated with representative
audiobook samples.

Do not add a `countTokens` request for every chunk initially. The 2,000-character
cap leaves ample room under 8,192 input tokens, while exact token counting would
add network requests without measuring the output-duration quality constraint.
If future prompts add substantial instructions, or source languages make the
character approximation unreliable, count the complete request input and use
approximately **500 input tokens** as the quality-oriented cap, while retaining a
character fallback.

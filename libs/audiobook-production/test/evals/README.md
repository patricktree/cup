# Run speech recognition evals

These evals run the production path of [overlap and cut](../../../../docs/architecture/conversion.md#overlap-and-cut) against real speech recognition: `recognizeSpeech` sends recorded provider audio to Whisper large v3 turbo through a real Workers AI `AI` binding and AI Gateway, as segment production does, and `findCutPoint` aligns the words it hears and runs the cut check. Each case is a real Gemini overlap take with the cut the research verified, so the evals catch a change in Whisper's output, in the binding's response shape, or in the cut rule that the unit tests' synthetic words cannot.

Every case checks that the binding returns Whisper's output itself, not wrapped in the REST API's `{ result }`, that the output parses through the production schema with a text and timing for every word, and that the cut check accepts a cut point inside the case's expected pause, or rejects the take when the case expects that. One more test sends a near-silent take and checks that it parses and places no accepted cut point.

Live evals call Whisper and can incur usage charges, well under a cent per run. They run separately from the package's unit tests.

## Configure credentials

The root [environment setup](../../../../AGENTS.md#environment-setup) creates `.env.evals`, from which the evals read `CLOUDFLARE_ACCOUNT_ID`, the account whose Workers AI and AI Gateway they use. You can instead export it.

The binding runs remotely even from Node.js: Wrangler's `getPlatformProxy` opens a remote proxy session, which uploads a preview Worker. The `CLOUDFLARE_API_KEY` of the environment files may not create Workers previews, so the evals do not pass it to Wrangler; Wrangler authenticates with its own login instead (`pnpm --filter @cup/audiobook-production exec wrangler login`), or with an exported `CLOUDFLARE_API_TOKEN` that may create Workers previews and run Workers AI.

## Run the evals

From the repository root, run `pnpm evals:speech-recognition`. This paid check runs only when invoked: the [review gate](../../../../AGENTS.md#validation-gates) runs it only when this library or a package it depends on changed relative to `origin/main`. Alternatively, from `libs/audiobook-production`, run `pnpm run eval`, and pass `-t <case-id>` to run one case. Runs execute sequentially without retries.

## Add an eval case

Create a descriptive directory under `cases/` with this structure:

```text
<case-id>/
  case.json
  provider-audio.mp3
```

`provider-audio.mp3` is the overlap take as MP3 frames in the segment audio format (24 kHz mono, 128 kbps), without tags, as `encodeMp3Frames` writes it. The eval decodes it to the provider PCM and encodes that again for speech recognition, so speech recognition and the cut check see the audio as they do in production.

`case.json` describes the take:

```json
{
  "description": "A narration chunk that opens with a heading.",
  "tags": ["heading-opens-chunk"],
  "narrationLanguage": "de",
  "overlapSentence": "Es geht um viel Steuergeld.",
  "separator": "\n\n",
  "narrationChunk": "Neue Begehrlichkeiten\n\nDie aktuelle Dürreperiode hat begonnen.",
  "chunkStartWordIndex": 5,
  "expectedPause": { "startSeconds": 5.21, "endSeconds": 6.28 }
}
```

- `narrationLanguage` is the manifest's narration language, which gives Whisper its language code, or `null` for a conversion without one, where Whisper detects the language.
- `overlapSentence`, `separator` and `narrationChunk` make up the synthesized text as segment production joins them: the separator is `"\n\n"`, or `" "` when the chunk continues a split narration block. The overlap sentence must be one sentence as production's sentence segmentation finds it.
- `chunkStartWordIndex` counts the overlap sentence's words as `countSynthesizedWords` does.
- `expectedPause` is the silent run (≤ −45 dBFS, in 10 ms frames of the decoded audio) between the overlap sentence and the chunk, where the cut point must lie.
- `expectedRejection`, set to `"cut-check-failed"`, expects the cut check to reject the take, so that production synthesizes the chunk alone. The description says why.

The package's unit tests load the committed cases, so `pnpm test` catches an invalid case without a paid run: a missing file, an invalid field, a chunk start word index that does not count the overlap sentence, an overlap of more than one sentence, a narration language speech recognition does not support, or an expected pause shorter than the cut check's 150 ms or beyond the audio.

## Where the cases come from

The cases are takes from the [overlap and cut aligner research](https://github.com/patricktree/cup/blob/research/overlap-cut-aligner/docs/research/overlap-cut-aligner.md) (`docs/research/overlap-cut-aligner.tar.xz` on the branch `research/overlap-cut-aligner`), chosen for numbers and units, table cells, headings as the overlap or at the chunk start, a mid-paragraph split, quotes in another language, and English, German and French. The research takes overlapped on both sides, so each case keeps the take only up to the research's verified cut after the chunk, or up to the middle of a pause after the chunk's first sentence to keep the file small; policy 7 overlaps only in front, and the end of a take does not affect the cut. The expected pause is the silent run around the research's verified cut, measured on the committed audio.

Two cases expect a rejection. In `de-english-quote-opens-chunk`, Whisper with language `de` leaves out the English quote that opens the chunk, so no aligned chunk word lies near the chunk start. In `fr-infobox-number-overlap`, Whisper ends the overlap's only word and starts the chunk's at the start of the pause, so the search span holds no pause.

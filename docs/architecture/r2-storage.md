# R2 objects and key layout

Cup stores prepared narration documents, cover images, generated audio segments, and segment failure details in one R2 bucket. This page describes the keys written by the current checkout; it is not an inventory of deployed objects. The [Worker configuration](../../apps/cloudflare-worker/wrangler.jsonc) binds `AUDIO_BUCKET` to `create-audiobook-from-url-audio`.

## Conversion prefixes

The application constructs slash-separated object keys through the shared [artifact-prefix helpers](../../libs/conversion-contracts/src/artifact-prefix.ts). The directory trees below show those key prefixes; each leaf is an object.

```text
create-audiobook-from-url-audio
├── accounts/
│   └── <accountId>/
│       └── conversions/
│           └── <conversionId>/
│               ├── audiobook.json
│               ├── cover-image
│               ├── audio-segments/
│               │   ├── 0.mp3
│               │   ├── 1.mp3
│               │   └── …
│               └── segment-<sequence>-failure.json
└── conversions/
    └── <conversionId>/
        ├── audiobook.json
        ├── cover-image
        ├── audio-segments/
        │   ├── 0.mp3
        │   ├── 1.mp3
        │   └── …
        └── segment-<sequence>-failure.json
```

| Owner                  | Conversion prefix                                  | Ownership boundary                                                                    |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Account                | `accounts/<accountId>/conversions/<conversionId>/` | Private artifacts grouped under the owning account for erasure                        |
| Trial conversion grant | `conversions/<conversionId>/`                      | Grant-authorized artifacts grouped by conversion; the grant ID is not part of the key |

`<sequence>` is the zero-based index of a synchronization unit in the prepared narration document. Segment names use plain decimal numbers without zero padding. A conversion can have a manifest before any MP3 objects exist, and later have only some sequences generated. Failure objects exist only for units whose workflow records a failure.

Ownership and authorization come from Durable Object records and registry routes, rather than being inferred from a key alone. See [storage ownership](README.md#storage-ownership) and [authentication and authorization](authentication.md).

## Objects within a conversion

The following paths are relative to either conversion prefix.

| Object key                        | Contents                                                                                                                 | Written by                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audiobook.json`                  | The prepared narration document with its title, source URL, speech configuration, and a record of the stored cover image | [Manifest storage](../../libs/audiobook-production/src/store-audiobook.ts), called by the [preparation workflow](../../libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts)      |
| `cover-image`                     | The publisher's original image bytes, unchanged, when the source page declared one that could be kept                    | [Cover image storage](../../libs/audiobook-production/src/store-cover-image.ts), called by the [preparation workflow](../../libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts) |
| `audio-segments/<sequence>.mp3`   | Independently playable narration audio for one synchronization unit                                                      | [Segment production](../../libs/audiobook-production/src/produce-audio-segment.ts), called by the [segment workflow](../../libs/create-audiobook-from-url-workflow/src/run-audio-segment-workflow.ts)      |
| `segment-<sequence>-failure.json` | JSON with an `explanation` string describing the failed speech generation                                                | [Segment workflow failure handling](../../libs/create-audiobook-from-url-workflow/src/run-audio-segment-workflow.ts)                                                                                       |

The owner stores the manifest's object reference, and loading validates the object against it. The manifest contains prepared text and synthesis configuration, not a list of generated audio objects.

The cover image has no file extension; its HTTP content type is the image type identified from its bytes, as described under [cover image](conversion.md#cover-image). It is written before the manifest that records it. The manifest is authoritative: a conversion can hold a `cover-image` object that no manifest records, left by a preparation attempt that later failed, and such an object is never served. When preparation is retried for an account under the same execution epoch, the account artifact writer answers the repeated write with the object it already stored, so the manifest describes that stored object.

The [audio format](../../libs/audiobook-production/src/audio-format.ts) defines the channel layout, sample rate, and bitrate, and [segment production](../../libs/audiobook-production/src/produce-audio-segment.ts) stores only audio frames, without ID3 tags. Production rejects any frame outside that format or with the padding bit set, so every frame is equally long and a segment's byte length follows from its settled duration ([`audio-format.test.ts`](../../libs/audiobook-production/test/audio-format.test.ts)). Nothing records segment byte lengths, so a change to the segment encoding must start recording them, because derivation then no longer holds for audio already stored. Segment publication uses a conditional write with `If-None-Match: *`. Retries validate an existing object's synthesis identity and reuse it instead of replacing audio already published for that sequence.

A later successful retry can leave the failure object in storage: the [synthesis-state reader](../../libs/api-server/src/use-cases/get-synthesis-state.ts) reads it only for a segment whose reservation was released, and the segment workflow does not delete the earlier failure object.

## Object metadata

Each MP3 object carries string custom metadata that describes its audio format, duration, CRC-32, exact narration text, and synthesis provider, model, voice, and policy version; the [segment storage implementation](../../libs/audiobook-production/src/audio-segment-storage.ts) defines the keys. A retry reuses a stored segment only when this synthesis identity matches.

Account-owned writes additionally carry `cup-writer-id` on manifests, cover images, audio segments, and failure objects. The [account artifact writer](../../libs/accounts/src/artifacts/artifact-writer.ts) derives this ID from the execution epoch and object key, registers the write before sending it to R2, and acknowledges and drains it afterward. This lets account deletion reconcile uncertain writes before erasing the prefix. Trial writes do not use this account wrapper.

## Access and lifecycle

The Worker loads manifests and serves media through the listener API. An MP3 object's existence alone does not make it playable: the narration track needs a ready conversion with every segment settled in the owner's duration ledger, and likewise only a cover image the manifest records is served ([`trial-audiobook-access.test.ts`](../../libs/api-server/test/trial-audiobook-access.test.ts)). [Delivery](conversion.md#delivery-positions-and-lifecycle) describes the request handling and [authentication](authentication.md) the access rules.

Account erasure deletes every object under `accounts/<accountId>/` after execution is fenced and artifact writers have drained. It leaves trial conversion prefixes and other accounts separate; see [account deletion](account-deletion.md) and the [erasure implementation](../../libs/accounts/src/durable-object/account-durable-object.ts).

For failed trial preparation, the [grant maintenance implementation](../../libs/conversion-grants/src/durable-object/conversion-grant-durable-object.ts) deletes the conversion prefix when cleanup is pending and no segment is settled. It preserves artifacts if any segment is settled. A failed audio unit does not by itself make preparation failed or trigger whole-conversion cleanup; the prepared document and completed audio remain available.

Older objects can remain outside the active ownership inventory. [ADR 0004](../adr/0004-preserve-only-grants-during-drizzle-transition.md) leaves historical R2 artifacts outside the trial SQLite transition even though their conversion records and ownership routes are removed. The current writers produce the four object types above; no narration track object is stored ([delivery](conversion.md#delivery-positions-and-lifecycle)). Bucket contents may therefore include artifacts from earlier layouts that this page does not enumerate.

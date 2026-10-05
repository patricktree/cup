# R2 objects and key layout

Cup stores prepared narration documents, generated audio segments, and segment failure details in one R2 bucket. This page describes the keys written by the current checkout; it is not an inventory of deployed objects. The [Worker configuration](../../apps/cloudflare-worker/wrangler.jsonc) binds `AUDIO_BUCKET` to `create-audiobook-from-url-audio`.

## Conversion prefixes

The application constructs slash-separated object keys through the shared [artifact-prefix helpers](../../libs/conversion-contracts/src/artifact-prefix.ts). The directory trees below show those key prefixes; each leaf is an object.

```text
create-audiobook-from-url-audio
├── accounts/
│   └── <accountId>/
│       └── conversions/
│           └── <conversionId>/
│               ├── audiobook.json
│               ├── audio-segments/
│               │   ├── 0.mp3
│               │   ├── 1.mp3
│               │   └── …
│               └── segment-<sequence>-failure.json
└── conversions/
    └── <conversionId>/
        ├── audiobook.json
        ├── audio-segments/
        │   ├── 0.mp3
        │   ├── 1.mp3
        │   └── …
        └── segment-<sequence>-failure.json
```

| Owner                  | Conversion prefix                                  | Ownership boundary                                                            |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Account                | `accounts/<accountId>/conversions/<conversionId>/` | Private artifacts grouped under the owning account for erasure                |
| Trial conversion grant | `conversions/<conversionId>/`                      | Unlisted artifacts grouped by conversion; the grant ID is not part of the key |

`<sequence>` is the zero-based index of a synchronization unit in the prepared narration document. Segment names use plain decimal numbers without zero padding. A conversion can have a manifest before any MP3 objects exist, and later have only some sequences generated. Failure objects exist only for units whose workflow records a failure.

Omitting the owner when constructing a conversion prefix selects the trial layout. Ownership and authorization come from Durable Object records and registry routes, rather than being inferred from a key alone. See [storage ownership](README.md#storage-ownership) and [authentication and authorization](authentication.md).

## Objects within a conversion

The following paths are relative to either conversion prefix.

| Object key                        | Contents                                                                                                                                            | Written by                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audiobook.json`                  | Title, original source URL, narration document HTML and synchronization units, and speech configuration: provider, model, voice, and policy version | [Manifest storage](../../libs/audiobook-production/src/store-audiobook.ts), called by the [preparation workflow](../../libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts) |
| `audio-segments/<sequence>.mp3`   | Independently playable narration audio for one synchronization unit                                                                                 | [Segment production](../../libs/audiobook-production/src/produce-audio-segment.ts), called by the [unit workflow](../../libs/create-audiobook-from-url-workflow/src/run-audio-segment-workflow.ts)    |
| `segment-<sequence>-failure.json` | JSON with an `explanation` string describing the failed speech generation                                                                           | [Unit workflow failure handling](../../libs/create-audiobook-from-url-workflow/src/run-audio-segment-workflow.ts)                                                                                     |

The manifest uses HTTP content type `application/json`. The owner stores its object reference, including key, content type, byte length, and ETag; loading validates the object against that reference. The manifest contains prepared text and synthesis configuration, not a list of generated audio objects.

MP3 objects use HTTP content type `audio/mpeg`. The [audio format](../../libs/audiobook-production/src/audio-format.ts) is mono at 24,000 Hz; production encodes at 128 kbit/s. Segment publication uses a conditional write with `If-None-Match: *`. Retries validate an existing object's synthesis identity and reuse it instead of replacing audio already published for that sequence.

Failure JSON is written with `application/json` HTTP content-type metadata. A later successful retry can leave the failure object in storage: the [segment-state reader](../../libs/api-server/src/use-cases/get-audio-segment-state.ts) prioritizes settled audio, and the unit workflow does not delete the earlier failure object.

## Object metadata

The [segment storage implementation](../../libs/audiobook-production/src/audio-segment-storage.ts) defines custom metadata used to validate and reuse audio. Metadata values are strings.

| Custom metadata key           | Meaning                                                |
| ----------------------------- | ------------------------------------------------------ |
| `audio-channel-count`         | Channel count, `1`                                     |
| `audio-encoding`              | Encoding, `mp3`                                        |
| `audio-sample-rate`           | Sample rate in Hz, `24000`                             |
| `audio-duration-milliseconds` | Analyzed encoded audio duration                        |
| `audio-crc32`                 | CRC-32 of the stored MP3 bytes, encoded as hexadecimal |
| `narration-text`              | Exact synthesis input, serialized as a JSON string     |
| `synthesis-provider`          | Speech provider                                        |
| `synthesis-model`             | Speech model                                           |
| `synthesis-voice`             | Voice                                                  |
| `synthesis-policy-version`    | Synthesis policy version                               |

Account-owned writes additionally carry `cup-writer-id` on manifests, audio segments, and failure objects. The [account artifact writer](../../libs/accounts/src/artifact-writer.ts) derives this ID from the execution epoch and object key, registers the write before sending it to R2, and acknowledges and drains it afterward. This lets account deletion reconcile uncertain writes before erasing the prefix. Trial writes do not use this account wrapper.

## Access and lifecycle

The Worker loads manifests and serves audio through the application API. Audio delivery requires a ready manifest, a valid synchronization-unit sequence, and a settled segment in the owner's duration ledger; an MP3 object's existence alone does not make it playable. The [audio delivery handler](../../libs/api-server/src/serve-audiobook.ts) supports HEAD requests, byte ranges, and conditional ETag requests. Private artifacts require the active owning account; unlisted trial audiobook links permit reading and replay under the [access rules](authentication.md).

Account erasure deletes every object under `accounts/<accountId>/` after execution is fenced and artifact writers have drained. It leaves trial conversion prefixes and other accounts separate. See [account deletion](account-deletion.md) and the [erasure implementation](../../libs/accounts/src/account-durable-object.ts).

For failed trial preparation, the [grant maintenance implementation](../../libs/conversion-grants/src/conversion-grant-durable-object.ts) deletes the conversion prefix when cleanup is pending and no segment is settled. It preserves artifacts if any segment is settled. A failed audio unit does not by itself make preparation failed or trigger whole-conversion cleanup; the prepared document and completed audio remain available.

Older objects can remain outside the active ownership inventory. [ADR 0004](../adr/0004-preserve-only-grants-during-drizzle-transition.md) leaves historical R2 artifacts outside the trial SQLite transition even though their conversion records and ownership routes are removed. The current writers produce the three object types above; they do not assemble a full-track audio file or write EPUB exports. Bucket contents may therefore include artifacts from earlier layouts that this page does not enumerate.

# Cup glossary

This is the authoritative vocabulary for Cup design, documentation, and implementation. See the [system overview](architecture/README.md) for component relationships and flows. A defined concept does not by itself establish that a feature is implemented.

## Language

Domain terms are common nouns. Use ordinary sentence casing: capitalize them at the start of a sentence or where the surrounding style requires it, and otherwise write them in lowercase.

## source content

The work submitted to become an audiobook, such as a book, story, essay, or other long-form text. A source page may carry the source content, but is not itself the source content.

_Avoid_: web page, source page

## source page

The web page carrying the source content alongside surrounding material that is not part of it.

_Avoid_: source content

## source URL

The URL submitted to locate the source page carrying the source content.

_Avoid_: source page URL

## conversion

The transformation of source content into an audiobook.

_Avoid_: workflow, job

## account

A person’s persistent identity in Cup that owns their conversions and conversion allowance. An account can have multiple sign-in methods without becoming a different account.

_Avoid_: trial grant, sign-in method

## account deletion

The complete lifecycle for removing an account: scheduling, possible recovery, removing its sign-in identity and Cup-owned data, and issuing deletion notices. Use this term in user-facing copy.

_Avoid_: account erasure for the overall process

## account erasure

The internal cleanup step within account deletion that removes the account’s Cup-owned content and records. Use this term only when referring to that specific step.

_Avoid_: account deletion for the cleanup step alone

## account conversion allowance

The duration allowance issued to an account. Its spent duration remains spent; deleting a conversion, once supported, will not refund it.

_Avoid_: conversion grant, trial allowance

## execution epoch

An account's version for authorizing conversion execution and artifact writes. Each account conversion carries the epoch assigned when its work was admitted. Account deletion increments the epoch when cleanup begins; work carrying an older epoch fails subsequent authorization checks. This is unrelated to speech generation.

_Avoid_: execution generation, generation

## trial link

A URL that gives its bearer access to a conversion grant.

_Avoid_: deep link, invite link

## conversion grant

A shared allowance for producing audiobooks, available to anyone possessing its grant credential. User-facing copy and documentation qualify what a conversion grant owns as trial, such as a trial link, a trial conversion, or a trial audiobook; the grant itself is a conversion grant.

_Avoid_: trial link, trial grant, user quota

## duration allowance

The amount of generated audio duration an account, conversion grant, or future paid plan permits. A conversion grant's allowance is shared across its authorized users and conversions.

_Avoid_: conversion slots, listening time

## duration reservation

A portion of a duration allowance temporarily held for one audio segment’s narration synthesis, based on its estimated audio duration. A conversion’s reservations are taken together: either every segment still lacking audio is reserved or none is. Each is unavailable to other conversions until reconciled against delivered audio or released when its synthesis ends without accessible audio.

_Avoid_: charge, spent allowance

## duration ledger

The append-only record of how an account's or conversion grant's duration allowance was granted and adjusted, and of each duration reservation and its reconciliation against generated audio duration or its release. The allowance, reserved duration, spent duration, and available duration are derived from it.

_Avoid_: balance, usage table

## available duration

The unspent portion of a duration allowance that is not held by active duration reservations. It is the balance shown to users and available for new duration reservations.

_Avoid_: total allowance, reserved duration

## duration balance

The available duration and reserved duration of one duration allowance, derived from its duration ledger and reported together.

_Avoid_: credit balance, ledger

## usage projection

The registry's copy of one account's or conversion grant's allowance, reserved duration, and spent duration, tagged with the owner's ledger revision. It lets operators list owners without calling every owner object; the owner's duration ledger stays authoritative.

_Avoid_: snapshot, usage snapshot

## grant credential

The secret carried by a trial link that proves access to its conversion grant.

_Avoid_: trial link, user identity

## grant session

Browser or native-app authorization derived from a grant credential. It authorizes work for its conversion grant only while the grant remains unexpired and unrevoked; it never authorizes listing the grant’s conversions, and the audiobook’s link alone never substitutes for it. [Trial access](architecture/authentication.md#trial-access) states the current rules.

_Avoid_: grant credential, user session

## conversion status

The state of a conversion: pending while its narration document is being prepared; synthesizing while audio is generated for any of its segments, during which the text can already be read; ready when every segment has audio or a final failure; failed when preparation could not finish; or insufficient duration when the narration document needs more than the available duration, in which case the document stays readable and synthesis can be requested again.

_Avoid_: workflow status

## preparation phase

The step of preparing a pending conversion's narration document that the conversion last started.

_Avoid_: conversion phase, workflow step

## audiobook source material

An inclusive representation of a source page containing everything that might contribute to the audiobook. Visual material may be replaced with a visual description.

_Avoid_: source body, page body, fetched page

## visual description

Text expressing relevant information from visual source content so that it can be considered for narration.

_Avoid_: narratable equivalent, audio description, image description

## narration source material

The subset of audiobook source material selected to contribute to the narration text.

_Avoid_: selected source material, narratable material

## narration content selection

The choice of which parts of audiobook source material contribute to narration source material.

_Avoid_: narration source element selection, narration source selection, source material selection

## narration text

The selected textual representation intended to be spoken in the audiobook. It preserves source wording verbatim and may include descriptions of non-textual media.

_Avoid_: narration script

## narration document

The structured document presentation of narration text that accompanies narration audio in the audiobook.

_Avoid_: transcript, source page, narration source material

## narration block

A semantically coherent portion of narration text intended to be spoken continuously.

_Avoid_: paragraph, section, HTML block

## narration chunk

A bounded portion of narration text processed as a single narration-synthesis input: one narration block, together with any headings directly preceding it. A narration block normally produces one chunk but may be divided when it is oversized.

_Avoid_: text chunk, audio chunk

## audio segment

The immutable, conversion-scoped audio produced from one narration chunk and identified by its sequence within the conversion. It is the unit of synthesis, storage, and settlement; listeners receive audio segments joined into the narration track. It remains part of the conversion whether or not audiobook production completes.

_Avoid_: audio chunk

## narration track

An audiobook's single audio file: its audio segments, unchanged and joined in document order. It exists only once every segment has audio, is assembled per request rather than stored, and is the audio delivered to listeners.

_Avoid_: audio file, full track, playback track

## generated audio duration

The duration of successfully produced narration audio made available to the user, which is the basis for consuming their trial or paid allowance regardless of whether they play it. It excludes failed synthesis attempts and measures audio duration rather than listening time.

_Avoid_: listening time, playback time

## spoken text

The exact wording that a narration provider reports it spoke when producing narration audio. It exists only when supplied directly by the provider and is never inferred from the audio.

_Avoid_: transcript, transcription

## synchronization unit

The smallest independently navigable portion of a narration document associated with one continuous interval of narration audio. Each unit has its own audio segment and starts in the narration track at the sum of the durations of the preceding segments; a position in the track is that start plus the offset within the unit's audio.

_Avoid_: sentence, paragraph, narration chunk, synchronization cue

## segment

The user-facing name for a synchronization unit: an independently selectable part of an audiobook's narration document and its corresponding audio. It can include headings or multiple paragraphs, and its text can be read before the corresponding audio segment is generated. A segment whose synthesis finally failed has no audio and is marked in the text; the audiobook cannot be played until a retry gives it audio.

_Avoid_: passage, paragraph, section

## audiobook

The adaptation produced from source content, comprising a prepared narration document and one narration audio segment per synchronization unit, delivered as one narration track once every segment has audio. Its text can be read while speech is generated. It becomes playable once every segment has audio and its narration track therefore exists, so its total duration is known before playback starts; when some segments finally failed, it stays unplayable until a retry succeeds.

_Avoid_: audio file, audio output, workflow output, article

## cover image

The single image a source page designates to represent its source content, kept with the audiobook as its cover. An audiobook may have none. It is not part of the narration text and has no visual description.

_Avoid_: hero image, thumbnail, preview image

## listening position

A user's remembered synchronization unit and offset within that unit's audio. It is restored only when a player initially loads; later saves replace the remembered position without moving other loaded players.

_Avoid_: bookmark, complete-track timestamp, shared grant progress

## private audiobook

An audiobook accessible only to its owning account.

_Avoid_: personal audiobook

## public audiobook

A planned audiobook intentionally accessible without signing in. No audiobook is public yet, and no audiobook is reachable by the audiobook’s link alone.

_Avoid_: unlisted audiobook, shared audiobook

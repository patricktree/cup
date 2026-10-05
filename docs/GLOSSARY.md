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

The duration allowance issued to an account. Its spent duration remains spent when completed conversions are deleted.

_Avoid_: conversion grant, trial allowance

## execution epoch

An account's version for authorizing conversion execution and artifact writes. Each account conversion carries the epoch assigned when its work was admitted. Account deletion increments the epoch when cleanup begins; work carrying an older epoch fails subsequent authorization checks. This is unrelated to speech generation.

_Avoid_: execution generation, generation

## trial link

A URL that gives its bearer access to a conversion grant.

_Avoid_: deep link, invite link

## conversion grant

A shared allowance for producing audiobooks, available to anyone possessing its grant credential.

_Avoid_: trial link, user quota

## duration allowance

The amount of generated audio duration an account, conversion grant, or future paid plan permits. A conversion grant's allowance is shared across its authorized users and conversions.

_Avoid_: conversion slots, listening time

## duration reservation

A portion of a duration allowance temporarily held for requested narration synthesis, based on its estimated audio duration. It is unavailable to other requests until reconciled against delivered audio or released when synthesis ends without accessible audio.

_Avoid_: charge, spent allowance

## available duration

The unspent portion of a duration allowance that is not held by active duration reservations. It is the balance shown to users and available for new synthesis requests.

_Avoid_: total allowance, reserved duration

## grant credential

The secret carried by a trial link that proves access to its conversion grant.

_Avoid_: trial link, user identity

## grant session

Browser or native-app authorization derived from a grant credential. Session validity and grant availability are checked separately. It may inspect its conversion grant and, while the grant remains unexpired and unrevoked, prepare articles, including when its duration allowance is exhausted. New speech synthesis additionally requires sufficient available duration. A grant session does not authorize listing the grant’s conversions. Reading prepared trial text and replaying completed audio require a session for the owning grant while it remains unexpired and unrevoked, including when its duration allowance is exhausted. An audiobook link alone does not authorize access.

_Avoid_: grant credential, user session

## conversion status

The preparation state of a conversion: pending while its narration document is being prepared, ready when the document is available, or failed when preparation could not finish. A ready conversion may have no generated audio; availability and failure are tracked independently for each audio segment.

_Avoid_: workflow status

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

A bounded portion of one narration block processed as a single narration-synthesis input. A narration block normally produces one chunk but may be divided when it is oversized.

_Avoid_: text chunk, audio chunk

## audio segment

The immutable, conversion-scoped audio produced from one narration chunk and identified by its sequence within the conversion. It remains part of the conversion whether or not audiobook production completes.

_Avoid_: audio chunk

## generated audio duration

The duration of successfully produced narration audio made available to the user, which is the basis for consuming their trial or paid allowance regardless of whether they play it. It excludes failed synthesis attempts and measures audio duration rather than listening time.

_Avoid_: listening time, playback time

## spoken text

The exact wording that a narration provider reports it spoke when producing narration audio. It exists only when supplied directly by the provider and is never inferred from the audio.

_Avoid_: transcript, transcription

## synchronization unit

The smallest independently navigable portion of a narration document associated with one continuous interval of narration audio.

_Avoid_: sentence, paragraph, narration chunk

## segment

The user-facing name for a synchronization unit: an independently selectable part of an audiobook's narration document and its corresponding audio. It can include headings or multiple paragraphs, and its text can be available before the corresponding audio segment is generated.

_Avoid_: passage, paragraph, section

## synchronization cue

A relationship between one synchronization unit and its corresponding interval in narration audio. Current playback uses a separate audio segment per unit and a local offset within that segment.

_Avoid_: timestamp, subtitle, caption

## audiobook

The adaptation produced from source content, comprising a prepared narration document and independently available narration audio segments. Its text can be read before any speech is generated; playback progressively supplies the audio for its synchronization units.

_Avoid_: audio file, audio output, workflow output

## speech synthesis lookahead

The portion of narration at and ahead of a player’s listening position for which it requests audio in advance to support uninterrupted playback.

_Avoid_: buffer, playback buffer

## listening position

A user's remembered synchronization unit and offset within that unit's audio. It is restored only when a player initially loads; later saves replace the remembered position without moving other loaded players.

_Avoid_: bookmark, complete-track timestamp, shared grant progress

## unlisted audiobook

An audiobook accessible to anyone who possesses its link but absent from public listings.

_Avoid_: private audiobook, public audiobook

## private audiobook

An audiobook accessible only to its owning user.

_Avoid_: unlisted audiobook, personal audiobook

## public audiobook

An audiobook intentionally accessible without signing in.

_Avoid_: unlisted audiobook, shared audiobook

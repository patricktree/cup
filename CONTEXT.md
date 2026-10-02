# Cup

This context describes how material from a source page becomes an audiobook.

## Language

Domain terms are common nouns. Use ordinary sentence casing: capitalize them at the start of a sentence or where the surrounding style requires it, and otherwise write them in lowercase.

**source content**:
The work submitted to become an audiobook, such as a book, story, essay, or other long-form text. A source page may carry the source content, but is not itself the source content.
_Avoid_: web page, source page

**source page**:
The web page carrying the source content alongside surrounding material that is not part of it.
_Avoid_: source content

**source URL**:
The URL submitted to locate the source page carrying the source content.
_Avoid_: source page URL

**conversion**:
The transformation of source content into an audiobook.
_Avoid_: workflow, job

**account**:
A person’s persistent identity in Cup that owns their conversions and conversion allowance. An account can have multiple sign-in methods without becoming a different account.
_Avoid_: trial grant, sign-in method

**account conversion allowance**:
The duration allowance issued to an account. Its spent duration remains spent when completed conversions are deleted.
_Avoid_: conversion grant, trial allowance

**trial link**:
A URL that gives its bearer access to a conversion grant.
_Avoid_: deep link, invite link

**conversion grant**:
A shared allowance for producing audiobooks, available to anyone possessing its grant credential.
_Avoid_: trial link, user quota

**duration allowance**:
The amount of generated audio duration an account, conversion grant, or future paid plan permits. A conversion grant's allowance is shared across its authorized users and conversions.
_Avoid_: conversion slots, listening time

**duration reservation**:
A portion of a duration allowance temporarily held for requested narration synthesis, based on its estimated audio duration. It is unavailable to other requests until reconciled against delivered audio or released when synthesis ends without accessible audio.
_Avoid_: charge, spent allowance

**available duration**:
The unspent portion of a duration allowance that is not held by active duration reservations. It is the balance shown to users and available for new synthesis requests.
_Avoid_: total allowance, reserved duration

**grant credential**:
The secret carried by a trial link that proves access to its conversion grant.
_Avoid_: trial link, user identity

**grant session**:
Browser or native-app authorization derived from a grant credential. A grant session does not expire independently. It may inspect its conversion grant and, while the grant remains open, start conversions. A grant session does not authorize listing the grant’s conversions. Individual trial audiobook links provide unlisted access independently of grant expiry or revocation.
_Avoid_: grant credential, user session

**conversion status**:
The lifecycle state of a conversion: pending while work remains, ready when the audiobook is available, or failed when no audiobook will be produced.
_Avoid_: workflow status

**audiobook source material**:
An inclusive representation of a source page containing everything that might contribute to the audiobook. Visual material may be replaced with a visual description.
_Avoid_: source body, page body, fetched page

**visual description**:
Text expressing relevant information from visual source content so that it can be considered for narration.
_Avoid_: narratable equivalent, audio description, image description

**narration source material**:
The subset of audiobook source material selected to contribute to the narration text.
_Avoid_: selected source material, narratable material

**narration content selection**:
The choice of which parts of audiobook source material contribute to narration source material.
_Avoid_: narration source element selection, narration source selection, source material selection

**narration text**:
The selected textual representation intended to be spoken in the audiobook. It preserves source wording verbatim and may include descriptions of non-textual media.
_Avoid_: narration script

**narration document**:
The structured document presentation of narration text that accompanies narration audio in the audiobook.
_Avoid_: transcript, source page, narration source material

**narration block**:
A semantically coherent portion of narration text intended to be spoken continuously.
_Avoid_: paragraph, section, HTML block

**narration chunk**:
A bounded portion of one narration block processed as a single narration-synthesis input. A narration block normally produces one chunk but may be divided when it is oversized.
_Avoid_: text chunk, audio chunk

**audio segment**:
The immutable, conversion-scoped audio produced from one narration chunk and identified by its sequence within the conversion. It remains part of the conversion whether or not audiobook production completes.
_Avoid_: audio chunk

**generated audio duration**:
The duration of successfully produced narration audio made available to the user, which is the basis for consuming their trial or paid allowance regardless of whether they play it. It excludes failed synthesis attempts and measures audio duration rather than listening time.
_Avoid_: listening time, playback time

**spoken text**:
The exact wording that a narration provider reports it spoke when producing narration audio. It exists only when supplied directly by the provider and is never inferred from the audio.
_Avoid_: transcript, transcription

**synchronization unit**:
The smallest independently navigable portion of a narration document associated with one continuous interval of narration audio.
_Avoid_: sentence, paragraph, narration chunk

**synchronization cue**:
A relationship between one synchronization unit and its corresponding interval in the narration audio.
_Avoid_: timestamp, subtitle, caption

**audiobook**:
The user-ready adaptation produced from source content, comprising structured narration text, narration audio, and synchronization cues.
_Avoid_: audio file, audio output, workflow output

**audiobook export**:
A portable rendition of a ready audiobook. An export has its own lifecycle, and its failure does not make the audiobook unavailable.
_Avoid_: audiobook, conversion output

**unlisted audiobook**:
An audiobook accessible to anyone who possesses its link but absent from public listings.
_Avoid_: private audiobook, public audiobook

**private audiobook**:
An audiobook accessible only to its owning user.
_Avoid_: unlisted audiobook, personal audiobook

**public audiobook**:
An audiobook intentionally accessible without signing in.
_Avoid_: unlisted audiobook, shared audiobook

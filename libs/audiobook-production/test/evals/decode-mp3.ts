import { MPEGDecoder } from "mpg123-decoder";

import { analyzeMp3 } from "#src/audio-format.ts";

/**
 * Decodes MP3 audio in `AUDIO_FORMAT` to the 16-bit little-endian mono PCM that synthesis returns,
 * so a committed MP3 stands in for the provider PCM.
 */
export async function decodeMp3ToPcm(mp3: Uint8Array): Promise<Uint8Array> {
  // rejects audio that is not mono MP3 frames in `AUDIO_FORMAT`
  analyzeMp3(mp3);

  const decoder = new MPEGDecoder();
  await decoder.ready;

  try {
    const { channelData, errors } = decoder.decode(mp3);
    if (errors.length > 0) {
      throw new Error(
        `Cannot decode MP3 audio: ${errors.map(({ message }) => message).join("; ")}`,
      );
    }

    // The decoder always returns two channels; for mono audio both carry the same samples.
    const samples = channelData[0]!;
    const pcm = new DataView(new ArrayBuffer(samples.length * 2));
    for (const [index, sample] of samples.entries()) {
      pcm.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), true);
    }

    return new Uint8Array(pcm.buffer);
  } finally {
    decoder.free();
  }
}

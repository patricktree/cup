import { createConversionArtifactPrefix } from "@cup/conversion-contracts";

import { EPUB_CONTENT_TYPE } from "#src/audio-format.ts";
import {
  assertStoredAudioSegment,
  type AudioSegmentReference,
  type StoredAudioSegment,
} from "#src/audio-segment-storage.ts";
import { calculateCrc32 } from "#src/crc32.ts";
import type { Audiobook } from "#src/store-audiobook.ts";

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const ZIP_DOS_DATE = 0x0021;
const MAX_ZIP_32_BIT_VALUE = 0xffff_ffff;

/** Identifies the stored EPUB derived from a canonical audiobook. */
export type EpubReference = {
  key: string;
  contentType: typeof EPUB_CONTENT_TYPE;
  byteLength: number;
  etag: string;
};

/** Supplies the canonical audiobook, its segments, and publication metadata for EPUB export. */
export type ExportOptions = {
  artifactPrefix?: string;
  bucket: EpubStorage;
  conversionId: string;
  audiobook: Audiobook;
  audioSegments: readonly AudioSegmentReference[];
  modifiedAt: string;
};

/** Minimal object-storage operations needed to stream a synchronized EPUB. */
export type EpubStorage = {
  get(key: string): Promise<
    | (StoredAudioSegment & {
        body: ReadableStream<Uint8Array>;
      })
    | null
  >;
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options: { httpMetadata: { contentType: typeof EPUB_CONTENT_TYPE } },
  ): Promise<{ key: string; size: number; etag: string } | null>;
};

type ByteEntry = {
  name: string;
  bytes: Uint8Array;
};

type StreamEntry = {
  name: string;
  audioSegment: AudioSegmentReference;
};

type CentralEntry = {
  name: Uint8Array;
  crc32: number;
  byteLength: number;
  localHeaderOffset: number;
  flags: number;
};

/** Builds an EPUB without buffering or transcoding the complete audiobook. */
export async function exportEpub({
  artifactPrefix,
  bucket,
  conversionId,
  audiobook,
  audioSegments,
  modifiedAt,
}: ExportOptions): Promise<EpubReference> {
  assertExportInputs(conversionId, audiobook, audioSegments, modifiedAt);

  const { byteEntries, streamEntries } = createPublicationEntries({
    audiobook,
    audioSegments,
    conversionId,
    modifiedAt,
  });
  const archiveByteLength = getArchiveByteLength(byteEntries, streamEntries);
  const key = `${artifactPrefix ?? createConversionArtifactPrefix(conversionId)}audiobook.epub`;
  const archive = new FixedLengthStream(archiveByteLength);
  const writer = archive.writable.getWriter();
  const upload = bucket.put(key, archive.readable, {
    httpMetadata: { contentType: EPUB_CONTENT_TYPE },
  });

  try {
    const centralEntries: CentralEntry[] = [];
    let offset = 0;

    for (const entry of byteEntries) {
      const name = encode(entry.name);
      const crc32 = calculateCrc32(entry.bytes);
      const localHeader = createLocalHeader({
        name,
        flags: ZIP_UTF8_FLAG,
        crc32,
        byteLength: entry.bytes.byteLength,
      });

      await writer.write(localHeader);
      await writer.write(entry.bytes);
      centralEntries.push({
        name,
        crc32,
        byteLength: entry.bytes.byteLength,
        localHeaderOffset: offset,
        flags: ZIP_UTF8_FLAG,
      });
      offset += localHeader.byteLength + entry.bytes.byteLength;
    }

    for (const entry of streamEntries) {
      const name = encode(entry.name);
      const flags = ZIP_UTF8_FLAG;
      const localHeader = createLocalHeader({
        name,
        flags,
        crc32: entry.audioSegment.crc32,
        byteLength: entry.audioSegment.byteLength,
      });
      const localHeaderOffset = offset;
      const audioObject = await bucket.get(entry.audioSegment.key);

      if (!audioObject || !("body" in audioObject)) {
        throw new Error(
          `Audio segment was not found while exporting EPUB: ${entry.audioSegment.key}`,
        );
      }

      assertStoredAudioSegment(audioObject, entry.audioSegment, artifactPrefix);
      await writer.write(localHeader);
      await copyBody(audioObject.body, writer);
      centralEntries.push({
        name,
        crc32: entry.audioSegment.crc32,
        byteLength: entry.audioSegment.byteLength,
        localHeaderOffset,
        flags,
      });
      offset += localHeader.byteLength + entry.audioSegment.byteLength;
    }

    const centralDirectoryOffset = offset;

    for (const centralEntry of centralEntries) {
      const header = createCentralDirectoryHeader(centralEntry);

      await writer.write(header);
      offset += header.byteLength;
    }

    await writer.write(
      createEndOfCentralDirectory({
        entryCount: centralEntries.length,
        centralDirectoryByteLength: offset - centralDirectoryOffset,
        centralDirectoryOffset,
      }),
    );
    await writer.close();

    const epub = await upload;

    if (!epub) {
      throw new Error(`EPUB upload did not produce an object: ${key}`);
    }

    return {
      key: epub.key,
      contentType: EPUB_CONTENT_TYPE,
      byteLength: epub.size,
      etag: epub.etag,
    };
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await upload.catch(() => undefined);
    throw error;
  }
}

function createPublicationEntries({
  audiobook,
  audioSegments,
  conversionId,
  modifiedAt,
}: Omit<ExportOptions, "bucket">): {
  byteEntries: ByteEntry[];
  streamEntries: StreamEntry[];
} {
  const identifier = `urn:create-audiobook-from-url:${conversionId}`;
  const audioItems = audioSegments
    .map(
      (_, sequence) =>
        `<item id="audio-${sequence + 1}" href="audio/${createAudioFileName(sequence)}" media-type="audio/mpeg"/>`,
    )
    .join("\n    ");
  const totalDuration = audiobook.synchronizationCues.at(-1)!.endMilliseconds;
  const firstUnitId = audiobook.narrationDocument.synchronizationUnits[0]!.id;
  const contentHtml = toXhtmlFragment(audiobook.narrationDocument.html);
  const packageDocument = xml(`
    <?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id" xml:lang="und">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="publication-id">${escapeXml(identifier)}</dc:identifier>
        <dc:title>${escapeXml(audiobook.title)}</dc:title>
        <dc:language>und</dc:language>
        <dc:source>${escapeXml(audiobook.originalUrl)}</dc:source>
        <meta property="dcterms:modified">${escapeXml(formatModifiedAt(modifiedAt))}</meta>
        <meta property="media:duration">${formatClockValue(totalDuration)}</meta>
        <meta property="media:duration" refines="#overlay">${formatClockValue(totalDuration)}</meta>
        <meta property="media:active-class">-epub-media-overlay-active</meta>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="content" href="content.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/>
        <item id="overlay" href="overlay.smil" media-type="application/smil+xml"/>
        <item id="styles" href="styles.css" media-type="text/css"/>
        ${audioItems}
      </manifest>
      <spine>
        <itemref idref="content"/>
      </spine>
    </package>
  `);
  const navigationDocument = xml(`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE html>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="und" xml:lang="und">
      <head><title>${escapeXml(audiobook.title)}</title></head>
      <body>
        <nav epub:type="toc" id="toc">
          <h1>Contents</h1>
          <ol><li><a href="content.xhtml#${escapeXml(firstUnitId)}">${escapeXml(audiobook.title)}</a></li></ol>
        </nav>
      </body>
    </html>
  `);
  const contentDocument = xml(`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE html>
    <html xmlns="http://www.w3.org/1999/xhtml" lang="und" xml:lang="und">
      <head>
        <title>${escapeXml(audiobook.title)}</title>
        <link rel="stylesheet" type="text/css" href="styles.css"/>
      </head>
      <body><article>${contentHtml}</article></body>
    </html>
  `);
  const parallels = audiobook.synchronizationCues
    .map((cue, sequence) => {
      const duration = cue.endMilliseconds - cue.startMilliseconds;

      return `
        <par id="par-${sequence + 1}">
          <text src="content.xhtml#${escapeXml(cue.synchronizationUnitId)}"/>
          <audio src="audio/${createAudioFileName(sequence)}" clipBegin="0.000s" clipEnd="${formatSeconds(duration)}"/>
        </par>`;
    })
    .join("");
  const mediaOverlay = xml(`
    <?xml version="1.0" encoding="UTF-8"?>
    <smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
      <body><seq id="audiobook" epub:textref="content.xhtml" xmlns:epub="http://www.idpf.org/2007/ops">${parallels}
      </seq></body>
    </smil>
  `);

  return {
    byteEntries: [
      { name: "mimetype", bytes: encode(EPUB_CONTENT_TYPE) },
      {
        name: "META-INF/container.xml",
        bytes: encode(
          xml(`
            <?xml version="1.0" encoding="UTF-8"?>
            <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
              <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
            </container>
          `),
        ),
      },
      { name: "EPUB/package.opf", bytes: encode(packageDocument) },
      { name: "EPUB/nav.xhtml", bytes: encode(navigationDocument) },
      { name: "EPUB/content.xhtml", bytes: encode(contentDocument) },
      { name: "EPUB/overlay.smil", bytes: encode(mediaOverlay) },
      {
        name: "EPUB/styles.css",
        bytes: encode(
          "body{font-family:serif;line-height:1.55;margin:5%;max-width:44rem}a{color:inherit}.-epub-media-overlay-active{background:#ffe58a}",
        ),
      },
    ],
    streamEntries: audioSegments.map((audioSegment, sequence) => ({
      name: `EPUB/audio/${createAudioFileName(sequence)}`,
      audioSegment,
    })),
  };
}

function assertExportInputs(
  conversionId: string,
  audiobook: Audiobook,
  audioSegments: readonly AudioSegmentReference[],
  modifiedAt: string,
): void {
  if (conversionId.trim().length === 0) {
    throw new Error("Cannot export an EPUB without a conversion ID");
  }

  if (
    audioSegments.length !== audiobook.narrationDocument.synchronizationUnits.length ||
    audioSegments.length !== audiobook.synchronizationCues.length
  ) {
    throw new Error("EPUB requires one audio segment for every synchronization unit");
  }

  for (const [sequence, audioSegment] of audioSegments.entries()) {
    const cue = audiobook.synchronizationCues[sequence]!;

    if (
      audioSegment.conversionId !== conversionId ||
      audioSegment.sequence !== sequence ||
      audioSegment.durationMilliseconds !== cue.endMilliseconds - cue.startMilliseconds
    ) {
      throw new Error(`Audio segment does not match EPUB sequence ${sequence}`);
    }
  }

  formatModifiedAt(modifiedAt);
}

function getArchiveByteLength(
  byteEntries: readonly ByteEntry[],
  streamEntries: readonly StreamEntry[],
): number {
  let byteLength = 22;

  for (const entry of byteEntries) {
    const nameLength = encode(entry.name).byteLength;

    byteLength += 30 + nameLength + entry.bytes.byteLength + 46 + nameLength;
  }

  for (const entry of streamEntries) {
    const nameLength = encode(entry.name).byteLength;

    byteLength += 30 + nameLength + entry.audioSegment.byteLength + 46 + nameLength;
  }

  assertZipValue(byteLength, "EPUB archive byte length");

  return byteLength;
}

function createLocalHeader({
  name,
  flags,
  crc32,
  byteLength,
}: Omit<CentralEntry, "localHeaderOffset">): Uint8Array {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x0403_4b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, ZIP_DOS_DATE, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, byteLength, true);
  view.setUint32(22, byteLength, true);
  view.setUint16(26, name.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);

  return header;
}

function createCentralDirectoryHeader(entry: CentralEntry): Uint8Array {
  const header = new Uint8Array(46 + entry.name.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x0201_4b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, entry.flags, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, ZIP_DOS_DATE, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.byteLength, true);
  view.setUint32(24, entry.byteLength, true);
  view.setUint16(28, entry.name.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  header.set(entry.name, 46);

  return header;
}

function createEndOfCentralDirectory({
  entryCount,
  centralDirectoryByteLength,
  centralDirectoryOffset,
}: {
  entryCount: number;
  centralDirectoryByteLength: number;
  centralDirectoryOffset: number;
}): Uint8Array {
  if (!Number.isSafeInteger(entryCount) || entryCount > 0xffff) {
    throw new Error(`EPUB has too many ZIP entries: ${entryCount}`);
  }

  assertZipValue(centralDirectoryByteLength, "ZIP central directory byte length");
  assertZipValue(centralDirectoryOffset, "ZIP central directory offset");

  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, 0x0605_4b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectoryByteLength, true);
  view.setUint32(16, centralDirectoryOffset, true);

  return record;
}

async function copyBody(
  body: ReadableStream<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  const reader = body.getReader();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        return;
      }

      if (!(result.value instanceof Uint8Array)) {
        throw new Error("Audio segment contained a non-binary body while exporting EPUB");
      }

      await writer.write(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function xml(value: string): string {
  return value
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

function toXhtmlFragment(html: string): string {
  return html.replaceAll("<br>", "<br/>");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatModifiedAt(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z$/u.exec(value);

  if (!match) {
    throw new Error(`EPUB modification time is invalid: ${value}`);
  }

  return `${match[1]}Z`;
}

function formatClockValue(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = (milliseconds % 60_000) / 1_000;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)}s`;
}

function createAudioFileName(sequence: number): string {
  return `${(sequence + 1).toString().padStart(5, "0")}.mp3`;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

// ZIP64 is deliberately outside this small writer's scope.
function assertZipValue(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ZIP_32_BIT_VALUE) {
    throw new Error(`${label} exceeds the EPUB ZIP32 limit: ${value}`);
  }
}

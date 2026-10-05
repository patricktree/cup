import type { AudioSegment, Audiobook, PlaybackPosition } from "@cup/web-app-api.routes";

import {
  getResourceAccountSession,
  refreshPlaybackAuthorization,
} from "#src/auth/account-session.js";
import {
  getAudioSegment,
  requestAudioSegment,
  savePlaybackPosition,
} from "#src/data-fetching/reader.js";

export type PreparedAudiobook = Extract<Audiobook, { status: "ready" }>;
export type PlayerSnapshot = {
  currentUnitIndex: number;
  durationMilliseconds?: number;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
};
export type PlayerServices = {
  request(unitIndex: number, retry: boolean): Promise<AudioSegment>;
  poll(unitIndex: number): Promise<AudioSegment>;
  save(position: PlaybackPosition): Promise<void>;
  authorize(): Promise<void>;
};

/**
 * An event-driven player: the selected unit is prepared while paused; playback admits synthesis
 * ahead.
 */
export class ProgressivePlayer {
  private readonly audiobook: PreparedAudiobook;
  private readonly services: PlayerServices;
  private readonly segments = new Map<number, AudioSegment>();
  private readonly requests = new Map<number, Promise<AudioSegment>>();
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot;
  private audio: HTMLAudioElement | null = null;
  private offsetMilliseconds: number;
  private lastSavedAt = 0;
  private sourceUnitIndex = -1;
  private revision = 0;
  private isDisposed = false;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    audiobook: PreparedAudiobook,
    position: PlaybackPosition | null,
    services: PlayerServices,
  ) {
    this.audiobook = audiobook;
    this.services = services;
    for (const segment of audiobook.segments) this.segments.set(segment.sequence, segment);
    const unitIndex = position
      ? audiobook.narrationDocument.synchronizationUnits.findIndex(
          (unit) => unit.id === position.synchronizationUnitId,
        )
      : 0;
    this.snapshot = {
      currentUnitIndex: Math.max(0, unitIndex),
      isPlaying: false,
      isBuffering: false,
      error: null,
    };
    this.offsetMilliseconds = unitIndex >= 0 ? (position?.offsetMilliseconds ?? 0) : 0;
  }

  static forConversion(
    this: void,
    conversionId: string,
    audiobook: PreparedAudiobook,
    position: PlaybackPosition | null,
    subject: string | null,
  ) {
    return new ProgressivePlayer(audiobook, position, {
      request: (unitIndex, retry) => requestAudioSegment(conversionId, unitIndex, retry),
      poll: (unitIndex) => getAudioSegment(conversionId, unitIndex),
      save: (value) => savePlaybackPosition(conversionId, value, subject),
      authorize: async () => {
        const session = await getResourceAccountSession();
        if (subject && session?.user.id !== subject)
          throw new Error("Sign in again to continue playback.");
        await refreshPlaybackAuthorization(session);
      },
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  attach = (audio: HTMLAudioElement | null) => {
    this.audio = audio;
    if (audio) {
      this.isDisposed = false;
      this.requestActiveSegment();
      return;
    }
    this.dispose();
  };

  private update(value: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }

  play = () => {
    if (this.snapshot.isPlaying || !this.audio) return;
    this.update({ isPlaying: true, error: null });
    void this.advance(this.revision);
  };

  pause = () => {
    this.revision += 1;
    if (this.snapshot.isBuffering) this.sourceUnitIndex = -1;
    this.update({ isPlaying: false, isBuffering: false });
    this.audio?.pause();
    this.save();
  };

  seek = (unitIndex: number) => {
    if (!this.audiobook.narrationDocument.synchronizationUnits[unitIndex]) return;
    const wasPlaying = this.snapshot.isPlaying;
    this.revision += 1;
    this.audio?.pause();
    this.sourceUnitIndex = -1;
    this.offsetMilliseconds = 0;
    this.update({ currentUnitIndex: unitIndex, error: null, isBuffering: false });
    this.save();
    if (wasPlaying) void this.advance(this.revision);
    else this.requestActiveSegment();
  };

  retry = () => {
    this.sourceUnitIndex = -1;
    this.segments.delete(this.snapshot.currentUnitIndex);
    this.update({ isPlaying: true, error: null });
    void this.advance(this.revision, true);
  };

  onEnded = () => {
    if (!this.snapshot.isPlaying) return;
    const next = this.snapshot.currentUnitIndex + 1;
    if (next >= this.audiobook.narrationDocument.synchronizationUnits.length) {
      this.offsetMilliseconds = 0;
      this.update({ currentUnitIndex: 0 });
      this.pause();
      return;
    }
    this.seek(next);
  };

  onTimeUpdate = () => {
    if (!this.audio || this.sourceUnitIndex !== this.snapshot.currentUnitIndex) return;
    this.offsetMilliseconds = this.audio.currentTime * 1_000;
    if (performance.now() - this.lastSavedAt >= 5_000) this.save();
    if (this.snapshot.isPlaying) this.requestAudioAhead(this.revision);
  };

  onPause = () => {
    if (
      this.snapshot.isPlaying &&
      !this.snapshot.isBuffering &&
      this.audio?.paused &&
      !this.audio.ended
    )
      this.pause();
  };

  onMediaError = () => {
    this.pause();
    this.update({ error: "Audio could not be played. Retry this segment." });
  };

  private async ensureSegment(unitIndex: number, retry = false): Promise<AudioSegment> {
    const existing = this.segments.get(unitIndex);
    if (existing?.status === "ready" || (existing?.status === "failed" && !retry)) return existing;
    const pending = this.requests.get(unitIndex);
    if (pending) return pending;
    const request = (async () => {
      let segment = await this.services.request(unitIndex, retry);
      this.segments.set(unitIndex, segment);
      while (segment.status === "generating" && !this.isDisposed) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        if (this.isDisposed) break;
        segment = await this.services.poll(unitIndex);
        this.segments.set(unitIndex, segment);
      }
      return segment;
    })();
    this.requests.set(unitIndex, request);
    try {
      return await request;
    } finally {
      this.requests.delete(unitIndex);
    }
  }

  private requestActiveSegment() {
    if (this.isDisposed || !this.audiobook.canGenerate) return;
    const unitIndex = this.snapshot.currentUnitIndex;
    void this.ensureSegment(unitIndex)
      .then((segment) => {
        if (
          !this.isDisposed &&
          this.snapshot.currentUnitIndex === unitIndex &&
          !this.snapshot.isPlaying &&
          segment.status === "failed"
        )
          this.update({ error: segment.explanation });
        return segment;
      })
      .catch((error: unknown) => {
        const explanation = error instanceof Error ? error.message : "Speech generation failed.";
        this.segments.set(unitIndex, { sequence: unitIndex, status: "failed", explanation });
        if (
          !this.isDisposed &&
          this.snapshot.currentUnitIndex === unitIndex &&
          !this.snapshot.isPlaying
        )
          this.update({ error: explanation });
      });
  }

  private async advance(revision: number, retry = false) {
    const unitIndex = this.snapshot.currentUnitIndex;
    this.update({ isBuffering: true });
    try {
      if (!this.segments.has(unitIndex) && !this.audiobook.canGenerate)
        throw new Error("Open the original trial link to generate more audio.");
      const currentUnit = this.ensureSegment(unitIndex, retry);
      this.requestAudioAhead(revision);
      const segment = await currentUnit;
      if (!this.isCurrent(revision)) return;
      if (segment.status === "failed") throw new Error(segment.explanation);
      if (segment.status !== "ready")
        throw new Error("Speech generation failed. Retry this segment.");
      await this.services.authorize();
      if (!this.isCurrent(revision)) return;
      const audio = this.audio;
      if (!audio) return;
      if (this.sourceUnitIndex !== unitIndex) {
        audio.src = segment.url;
        this.sourceUnitIndex = unitIndex;
        const offset = this.offsetMilliseconds;
        audio.addEventListener(
          "loadedmetadata",
          () => {
            if (this.sourceUnitIndex !== unitIndex || !this.isCurrent(revision)) return;
            audio.currentTime = Math.min(offset / 1_000, Math.max(0, audio.duration - 0.01));
          },
          { once: true },
        );
      }
      await audio.play();
      if (!this.isCurrent(revision)) {
        audio.pause();
        return;
      }
      this.update({
        isBuffering: false,
        durationMilliseconds: segment.durationMilliseconds,
      });
      this.requestAudioAhead(revision);
    } catch (error) {
      if (!this.isCurrent(revision)) return;
      this.pause();
      this.update({ error: error instanceof Error ? error.message : "Speech generation failed." });
    }
  }

  private isCurrent(revision: number) {
    return !this.isDisposed && this.snapshot.isPlaying && revision === this.revision;
  }

  private requestAudioAhead(revision: number) {
    if (!this.audiobook.canGenerate || !this.isCurrent(revision)) return;
    const offset =
      this.sourceUnitIndex === this.snapshot.currentUnitIndex && !this.snapshot.isBuffering
        ? (this.audio?.currentTime ?? 0) * 1_000
        : this.offsetMilliseconds;
    let duration = -offset;
    const units = this.audiobook.narrationDocument.synchronizationUnits;
    for (
      let unitIndex = this.snapshot.currentUnitIndex;
      unitIndex < units.length && duration < 60_000;
      unitIndex += 1
    ) {
      if (!this.isCurrent(revision)) return;
      const known = this.segments.get(unitIndex);
      const estimate =
        known?.status === "ready"
          ? known.durationMilliseconds
          : Math.max(1_000, units[unitIndex]!.narrationText.length * 80);
      duration += estimate;
      if (known?.status === "failed") return;
      if (known?.status === "ready" || this.requests.has(unitIndex)) continue;
      void this.ensureSegment(unitIndex)
        .then((segment) => {
          if (segment.status === "ready" && this.isCurrent(revision))
            this.requestAudioAhead(revision);
          return segment;
        })
        .catch((error: unknown) => {
          // Retain speculative failures so ticks do not retry them before explicit segment retry.
          this.segments.set(unitIndex, {
            sequence: unitIndex,
            status: "failed",
            explanation: error instanceof Error ? error.message : "Speech generation failed.",
          });
        });
    }
  }

  private save() {
    const unit =
      this.audiobook.narrationDocument.synchronizationUnits[this.snapshot.currentUnitIndex]!;
    const position = {
      synchronizationUnitId: unit.id,
      offsetMilliseconds: this.offsetMilliseconds,
    };
    this.lastSavedAt = Date.now();
    this.saveChain = this.saveChain.catch(() => undefined).then(() => this.services.save(position));
    void this.saveChain.catch((error) => {
      if (!this.isDisposed)
        this.update({
          error: error instanceof Error ? error.message : "Listening position could not be saved.",
        });
    });
  }

  private dispose() {
    this.isDisposed = true;
    this.revision += 1;
    this.update({ isPlaying: false, isBuffering: false });
    this.save();
  }
}

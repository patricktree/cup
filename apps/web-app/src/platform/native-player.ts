import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import type { PlayableAudiobook, PlayerSnapshot } from "#src/app/player/audiobook-player.js";
import {
  createAudiobookTimeline,
  findTimelineEntryIndex,
  type AudiobookTimeline,
} from "#src/app/player/audiobook-timeline.js";
import { getResourceAccountSession } from "#src/auth/account-session.js";

const native = registerPlugin<{
  configure(input: {
    playerId: string;
    conversionId: string;
    audiobook: PlayableAudiobook;
    position: PlaybackPosition | null;
    token: string | null;
    isSignedIn: boolean;
  }): Promise<Partial<PlayerSnapshot>>;
  command(input: {
    action: "play" | "pause" | "seekToUnit" | "seekTo";
    playerId?: string;
    token?: string | null;
    unitIndex?: number;
    positionMilliseconds?: number;
  }): Promise<void>;
  addListener(
    event: "state",
    listener: (state: PlayerSnapshot) => void,
  ): Promise<PluginListenerHandle>;
}>("NarrationPlayer");

export function stopNativePlayback() {
  if (Capacitor.isNativePlatform()) void native.command({ action: "pause" });
}

/** Native engines own audio and listening positions while the WebView is suspended. */
export class NativePlayer {
  private readonly playerId = crypto.randomUUID();
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | undefined;
  private listener: PluginListenerHandle | undefined;
  private readonly conversionId: string;
  private readonly audiobook: PlayableAudiobook;
  private readonly position: PlaybackPosition | null;
  private readonly isSignedIn: boolean;
  private readonly timeline: AudiobookTimeline;
  constructor(
    conversionId: string,
    audiobook: PlayableAudiobook,
    position: PlaybackPosition | null,
    isSignedIn: boolean,
  ) {
    this.conversionId = conversionId;
    this.audiobook = audiobook;
    this.position = position;
    this.isSignedIn = isSignedIn;
    // The native engine reports the restored position; until then show the start of the unit.
    const timeline = createAudiobookTimeline(audiobook.segments);
    this.timeline = timeline;
    const unitIndex = position
      ? audiobook.narrationDocument.synchronizationUnits.findIndex(
          (unit) => unit.id === position.synchronizationUnitId,
        )
      : 0;
    const entry = timeline.entries[Math.max(0, findTimelineEntryIndex(timeline, unitIndex))];
    this.snapshot = {
      currentUnitIndex: entry?.unitIndex ?? 0,
      positionMilliseconds: entry?.startMilliseconds ?? 0,
      durationMilliseconds: timeline.durationMilliseconds,
      isPlaying: false,
      isBuffering: false,
      error: null,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  // A native engine that is not running yet reports only part of the state.
  private update = (state: Partial<PlayerSnapshot>) => {
    this.snapshot = { ...this.snapshot, ...state };
    for (const listener of this.listeners) listener();
  };
  open = () => {
    this.initialization = (this.initialization ?? Promise.resolve()).then(() => this.initialize());
  };
  close = () => {
    this.initialization = (this.initialization ?? Promise.resolve()).then(() => this.stop());
  };
  private async initialize() {
    this.listener = await native.addListener("state", this.update);
    const session = await getResourceAccountSession();
    this.update(
      await native.configure({
        playerId: this.playerId,
        conversionId: this.conversionId,
        audiobook: this.audiobook,
        position: this.position,
        token: session?.access_token ?? null,
        isSignedIn: this.isSignedIn,
      }),
    );
  }
  private async stop() {
    await native.command({ action: "pause", playerId: this.playerId });
    await this.listener?.remove();
  }
  private command(
    action: "play" | "pause" | "seekToUnit" | "seekTo",
    target: { unitIndex?: number; positionMilliseconds?: number } = {},
  ) {
    void this.initialization
      ?.then(async () => {
        const session = action === "play" ? await getResourceAccountSession() : undefined;
        return native.command({
          action,
          playerId: this.playerId,
          ...target,
          ...(session === undefined ? {} : { token: session?.access_token ?? null }),
        });
      })
      .catch((error) =>
        this.update({
          ...this.snapshot,
          isPlaying: false,
          isBuffering: false,
          error: error instanceof Error ? error.message : "Playback failed.",
        }),
      );
  }
  play = () => this.command("play");
  pause = () => this.command("pause");
  seekToUnit = (unitIndex: number) => this.command("seekToUnit", { unitIndex });
  seekTo = (positionMilliseconds: number) => this.command("seekTo", { positionMilliseconds });
  skip = (direction: 1 | -1) => {
    const entryIndex = this.timeline.entries.findIndex(
      (entry) => entry.unitIndex === this.snapshot.currentUnitIndex,
    );
    const destination = this.timeline.entries[entryIndex + direction];
    if (entryIndex >= 0 && destination) this.seekToUnit(destination.unitIndex);
  };
}

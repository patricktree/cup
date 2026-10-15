import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import type { Audiobook, PlaybackPosition } from "@cup/listener-api.routes";

import type { PlayerSnapshot, ReportedPosition, TimelineLocation } from "#src/platform/player.js";

/** What the native engine needs from the loaded audiobook's playback session. */
export type NativePlayerSession = {
  conversionId: string;
  audiobook: Extract<Audiobook, { status: "ready" }>;
  subject: string | null;
  timeline: { durationMilliseconds: number };
  initialLocation: TimelineLocation;
  reportedPositionAt(location: TimelineLocation): ReportedPosition;
  listeningPositionOf(position: ReportedPosition): PlaybackPosition | null;
  adjacentUnitIndex(unitIndex: number, direction: 1 | -1): number | undefined;
  /** The subject's bearer token, or `null` for anonymous and trial listeners. */
  getAccessToken(): Promise<string | null>;
};

const native = registerPlugin<{
  configure(input: {
    playerId: string;
    conversionId: string;
    audiobook: NativePlayerSession["audiobook"];
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
  if (Capacitor.isNativePlatform()) {
    void native.command({ action: "pause" });
  }
}

/**
 * Native engines own audio and listening positions while the WebView is suspended: they restore the
 * position they are given by the session's rule and save positions themselves.
 */
export class NativePlayer {
  private readonly playerId = crypto.randomUUID();
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | undefined;
  private listener: PluginListenerHandle | undefined;
  private readonly session: NativePlayerSession;
  private readonly initialPosition: ReportedPosition;

  constructor(session: NativePlayerSession) {
    this.session = session;
    // The native engine reports the restored position once it runs; until then show the session's.
    this.initialPosition = session.reportedPositionAt(session.initialLocation);
    this.snapshot = {
      ...this.initialPosition,
      durationMilliseconds: session.timeline.durationMilliseconds,
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
    for (const listener of this.listeners) {
      listener();
    }
  };
  open = () => {
    this.initialization = (this.initialization ?? Promise.resolve()).then(() => this.initialize());
  };
  close = () => {
    this.initialization = (this.initialization ?? Promise.resolve()).then(() => this.stop());
  };
  private async initialize() {
    this.listener = await native.addListener("state", this.update);
    // A refused token must not leave the engine unconfigured: Play hands it a current one.
    const token = await this.session.getAccessToken().catch(() => null);
    this.update(
      await native.configure({
        playerId: this.playerId,
        conversionId: this.session.conversionId,
        audiobook: this.session.audiobook,
        // Already resolved by the session's rule, which the native engine applies again unchanged.
        position: this.session.listeningPositionOf(this.initialPosition),
        token,
        isSignedIn: this.session.subject !== null,
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
        // Play hands the engine a current token, which it sends with its media and position requests.
        // The media cookie the host issues on Play is only for the WebView, so Play does not wait for it.
        const token = action === "play" ? await this.session.getAccessToken() : undefined;
        return native.command({
          action,
          playerId: this.playerId,
          ...target,
          ...(token === undefined ? {} : { token }),
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
    const unitIndex = this.session.adjacentUnitIndex(this.snapshot.currentUnitIndex, direction);
    if (unitIndex !== undefined) {
      this.seekToUnit(unitIndex);
    }
  };
}

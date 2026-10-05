import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import type { PreparedAudiobook, PlayerSnapshot } from "#src/app/player/progressive-player.js";
import { getResourceAccountSession } from "#src/data-fetching/account-session.js";

const native = registerPlugin<{
  configure(input: {
    playerId: string;
    conversionId: string;
    audiobook: PreparedAudiobook;
    position: PlaybackPosition | null;
    token: string | null;
    isSignedIn: boolean;
  }): Promise<PlayerSnapshot>;
  command(input: {
    action: "play" | "pause" | "seek" | "retry";
    playerId?: string;
    token?: string | null;
    sequence?: number;
  }): Promise<void>;
  addListener(
    event: "state",
    listener: (state: PlayerSnapshot) => void,
  ): Promise<PluginListenerHandle>;
}>("NarrationPlayer");

export function stopNativePlayback() {
  if (Capacitor.isNativePlatform()) void native.command({ action: "pause" });
}

/** Native engines own audio, lookahead, and listening positions while the WebView is suspended. */
export class NativePlayer {
  private readonly playerId = crypto.randomUUID();
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | undefined;
  private listener: PluginListenerHandle | undefined;
  private readonly conversionId: string;
  private readonly audiobook: PreparedAudiobook;
  private readonly position: PlaybackPosition | null;
  private readonly isSignedIn: boolean;
  constructor(
    conversionId: string,
    audiobook: PreparedAudiobook,
    position: PlaybackPosition | null,
    isSignedIn: boolean,
  ) {
    this.conversionId = conversionId;
    this.audiobook = audiobook;
    this.position = position;
    this.isSignedIn = isSignedIn;
    const sequence = position
      ? audiobook.narrationDocument.synchronizationUnits.findIndex(
          (unit) => unit.id === position.synchronizationUnitId,
        )
      : 0;
    this.snapshot = {
      sequence: Math.max(0, sequence),
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
  private update = (state: PlayerSnapshot) => {
    this.snapshot = state;
    for (const listener of this.listeners) listener();
  };
  attach = (audio: HTMLAudioElement | null) => {
    const previous = this.initialization ?? Promise.resolve();
    this.initialization = audio
      ? previous.then(() => this.initialize())
      : previous.then(() => this.close());
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
  private async close() {
    await native.command({ action: "pause", playerId: this.playerId });
    await this.listener?.remove();
  }
  private command(action: "play" | "pause" | "seek" | "retry", sequence?: number) {
    void this.initialization
      ?.then(async () => {
        const session =
          action === "play" || action === "retry" ? await getResourceAccountSession() : undefined;
        return native.command({
          action,
          playerId: this.playerId,
          ...(sequence === undefined ? {} : { sequence }),
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
  seek = (sequence: number) => this.command("seek", sequence);
  retry = () => this.command("retry");
}

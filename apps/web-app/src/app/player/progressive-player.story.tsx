import React from "react";

import type { AudioSegment } from "@cup/web-app-api.routes";

import { ProgressivePlayer, type PreparedAudiobook } from "#src/app/player/progressive-player.ts";

export function SpeechSynthesisLookahead() {
  const [requested, setRequested] = React.useState<number[]>([]);
  const [pending] = React.useState(() => new Map<number, (segment: AudioSegment) => void>());
  const [player] = React.useState(() => {
    const audiobook: PreparedAudiobook = {
      status: "ready",
      canGenerate: true,
      playbackPosition: null,
      segments: [],
      title: "Speech synthesis lookahead",
      originalUrl: "https://example.com/article",
      narrationDocument: {
        html: "<p>Speech synthesis lookahead</p>",
        synchronizationUnits: Array.from({ length: 8 }, (_, unitIndex) => ({
          id: `unit-${unitIndex}`,
          narrationText: "a".repeat(250),
        })),
      },
    };
    return new ProgressivePlayer(audiobook, null, {
      request: (unitIndex) => {
        setRequested((previous) => [...previous, unitIndex]);
        return new Promise<AudioSegment>((resolve) => pending.set(unitIndex, resolve));
      },
      poll: () => {
        throw new Error("Requests remain pending until completed by the test.");
      },
      save: () => Promise.resolve(),
      authorize: () => Promise.resolve(),
    });
  });
  React.useEffect(() => {
    const audio = document.createElement("audio");
    audio.preload = "none";
    // Keep browser autoplay and media loading outside this scheduling test.
    audio.play = () => Promise.resolve();
    player.attach(audio);
    return () => player.attach(null);
  }, [player]);
  const snapshot = React.useSyncExternalStore(player.subscribe, player.getSnapshot);
  const complete = (unitIndex: number, failed = false) => {
    const resolve = pending.get(unitIndex);
    if (!resolve) throw new Error("Passage has no pending request.");
    pending.delete(unitIndex);
    resolve(
      failed
        ? { sequence: unitIndex, status: "failed", explanation: "Passage failed." }
        : {
            sequence: unitIndex,
            status: "ready",
            durationMilliseconds: 20_000,
            url: `https://example.com/audio/${unitIndex}.mp3`,
          },
    );
  };
  return (
    <main>
      <output aria-label="Requested units">{requested.join(",")}</output>
      <output aria-label="Playing">{String(snapshot.isPlaying)}</output>
      <output aria-label="Error">{snapshot.error}</output>
      <button onClick={player.play}>Play</button>
      <button onClick={player.pause}>Pause</button>
      <button onClick={player.retry}>Retry</button>
      <button onClick={player.onTimeUpdate}>Tick</button>
      {Array.from({ length: 8 }, (_, unitIndex) => (
        <section key={unitIndex}>
          <button onClick={() => complete(unitIndex)}>Complete {unitIndex}</button>
          <button onClick={() => complete(unitIndex, true)}>Fail {unitIndex}</button>
          <button onClick={() => player.seek(unitIndex)}>Seek {unitIndex}</button>
        </section>
      ))}
    </main>
  );
}

package com.cup_audio.app;

import android.content.Context;
import android.os.Handler;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Owns playback intent and the whole-audiobook timeline independently of the service.
 *
 * <p>Every segment has audio or a final failure before playback starts, so the timeline is exact.
 * Segments without audio are skipped and take no time. See ADR 0008.
 */
final class NarrationPlaybackCoordinator implements NarrationAudioAdapter.Listener {
  interface StateListener {
    void publish(
        int currentUnitIndex,
        long positionMilliseconds,
        long durationMilliseconds,
        boolean playing,
        boolean buffering,
        String error);
  }

  private final Context context;
  private final Handler main;
  private final NarrationApiClient api;
  private final NarrationPositionStore positions;
  private final StateListener listener;
  private NarrationAudioAdapter audio;
  private JSONObject config;
  private String conversionId;
  private List<NarrationTimeline.Entry> entries = new ArrayList<>();
  private long totalDuration;
  private int entryIndex;
  private long offset;
  // Whether the player holds this audiobook's playlist; it is loaded on the first Play.
  private boolean loaded;
  private boolean active, buffering;
  private String error;
  private boolean closed;

  NarrationPlaybackCoordinator(
      Context context,
      Handler main,
      NarrationApiClient api,
      NarrationPositionStore positions,
      StateListener listener) {
    this.context = context;
    this.main = main;
    this.api = api;
    this.positions = positions;
    this.listener = listener;
  }

  void attach(NarrationAudioAdapter audio) {
    this.audio = audio;
    main.postDelayed(tick, 1000);
  }

  boolean hasConversion(String id) {
    return config != null && id.equals(conversionId);
  }

  void authorize(JSONObject config) {
    api.authorize(config);
    audio.authorize(api.headers());
  }

  void configure(JSONObject input) throws Exception {
    pauseNarration();
    config = input;
    conversionId = config.getString("conversionId");
    JSONObject audiobook = config.getJSONObject("audiobook");
    JSONArray units = audiobook.getJSONObject("narrationDocument").getJSONArray("synchronizationUnits");
    entries = NarrationTimeline.create(audiobook.getJSONArray("segments"), units);
    totalDuration = NarrationTimeline.duration(entries);

    int restoredUnitIndex = NarrationPositionStore.initialUnitIndex(config, context);
    JSONObject position = NarrationPositionStore.initialPosition(config, context);
    entryIndex = Math.max(0, NarrationTimeline.indexOfUnit(entries, restoredUnitIndex));
    // A skipped unit resumes at the start of the next one with audio.
    boolean restoredUnitIsPlayable =
        !entries.isEmpty() && entries.get(entryIndex).unitIndex == restoredUnitIndex;
    offset =
        position == null || !restoredUnitIsPlayable ? 0 : position.getLong("offsetMilliseconds");

    api.configure(config);
    audio.authorize(api.headers());
    audio.reset();
    loaded = false;
    error = null;
    publish();
  }

  void command(String action, int unitIndex, long positionMilliseconds) {
    if (action.equals("pause")) pauseNarration();
    else if (action.equals("seekToUnit")) seekToUnit(unitIndex);
    else if (action.equals("seekTo")) seekToPosition(positionMilliseconds);
    else playNarration();
  }

  private void playNarration() {
    if (config == null || entries.isEmpty()) return;
    audio.beginBuffering();
    active = true;
    error = null;
    try {
      if (loaded) audio.resume();
      else {
        audio.load(
            entries, config.getJSONObject("audiobook").getString("title"), entryIndex, offset);
        loaded = true;
      }
      publish();
    } catch (Exception failure) {
      fail(failure.getMessage());
    }
  }

  void pauseNarration() {
    if (audio != null) {
      audio.endBuffering();
      readPlayerPosition();
      audio.pause();
    }
    active = false;
    buffering = false;
    save();
    publish();
  }

  /** Seeks to the start of a unit, or of the next unit with audio when it was skipped. */
  private void seekToUnit(int unitIndex) {
    int index = NarrationTimeline.indexOfUnit(entries, unitIndex);
    if (index >= 0) moveTo(index, 0);
  }

  /** Seeks to a position on the whole-audiobook timeline. */
  private void seekToPosition(long positionMilliseconds) {
    if (entries.isEmpty()) return;
    // Stop just short of the end: a player sought to its end has ended and would not resume there.
    long position = Math.min(Math.max(0, positionMilliseconds), Math.max(0, totalDuration - 1));
    int index = NarrationTimeline.indexAtPosition(entries, position);
    NarrationTimeline.Entry entry = entries.get(index);
    moveTo(index, Math.min(position - entry.start, entry.duration));
  }

  private void moveTo(int index, long newOffset) {
    if (index < 0 || index >= entries.size()) return;
    entryIndex = index;
    offset = newOffset;
    error = null;
    if (loaded) audio.seek(index, newOffset);
    save();
    publish();
  }

  private void readPlayerPosition() {
    if (!loaded || audio == null) return;
    int index = audio.currentIndex();
    if (index < 0 || index >= entries.size()) return;
    entryIndex = index;
    offset = audio.positionMilliseconds();
  }

  private void save() {
    if (config == null || entries.isEmpty()) return;
    try {
      positions.save(
          conversionId,
          entries.get(entryIndex).unitId,
          offset,
          config.optBoolean("isSignedIn"),
          message -> {
            if (closed) return;
            error = message;
            publish();
          });
    } catch (Exception failure) {
      error = failure.getMessage();
    }
  }

  private final Runnable tick =
      new Runnable() {
        int count;

        @Override
        public void run() {
          if (active) {
            readPlayerPosition();
            if (++count % 5 == 0) save();
            publish();
          }
          main.postDelayed(this, 1000);
        }
      };

  private void fail(String message) {
    pauseNarration();
    error = message;
    publish();
  }

  private void publish() {
    if (closed) return;
    boolean hasEntry = entryIndex < entries.size();
    listener.publish(
        hasEntry ? entries.get(entryIndex).unitIndex : 0,
        (hasEntry ? entries.get(entryIndex).start : 0) + offset,
        totalDuration,
        active,
        buffering,
        error);
  }

  @Override
  public void onSegmentChanged() {
    readPlayerPosition();
    save();
    publish();
  }

  @Override
  public void onBufferingChanged(boolean isBuffering) {
    if (buffering == (active && isBuffering)) return;
    buffering = active && isBuffering;
    publish();
  }

  @Override
  public void onEnded() {
    // Return to the start paused. The playlist stays loaded, so the media session keeps reporting
    // the audiobook's duration and the next Play resumes an ended player from the beginning.
    active = false;
    audio.pause();
    audio.seek(0, 0);
    pauseNarration();
  }

  @Override
  public void onNext() {
    readPlayerPosition();
    moveTo(entryIndex + 1, 0);
  }

  @Override
  public void onPrevious() {
    readPlayerPosition();
    moveTo(entryIndex - 1, 0);
  }

  @Override
  public void onSeek(long positionMilliseconds) {
    seekToPosition(positionMilliseconds);
  }

  @Override
  public void onPlayWhenReadyChanged(boolean ready) {
    if (!ready && active) pauseNarration();
    else if (ready && !active) playNarration();
  }

  @Override
  public void onFailure(String message) {
    // A failed player must prepare its playlist again on the next Play.
    readPlayerPosition();
    loaded = false;
    fail(message);
  }

  void close() {
    pauseNarration();
    closed = true;
    main.removeCallbacks(tick);
  }
}

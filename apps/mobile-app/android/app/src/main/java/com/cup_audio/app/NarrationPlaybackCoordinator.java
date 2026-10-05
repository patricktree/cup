package com.cup_audio.app;

import android.content.Context;
import android.os.Handler;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Owns playback intent, segment selection, and bounded generation independently of the service. */
final class NarrationPlaybackCoordinator implements NarrationAudioAdapter.Listener {
  interface StateListener {
    void publish(int currentUnitIndex, boolean playing, boolean buffering, String error);
  }

  private final Context context;
  private final Handler main;
  private final NarrationApiClient api;
  private final NarrationPositionStore positions;
  private final StateListener listener;
  private NarrationAudioAdapter audio;
  private final Set<String> requests = new HashSet<>();
  private final Map<Integer, JSONObject> segments = new HashMap<>();
  private final Map<Integer, String> failures = new HashMap<>();
  private JSONObject config;
  private JSONArray units;
  private String conversionId;
  private int currentUnitIndex, sourceUnitIndex = -1;
  private long offset;
  private boolean active, buffering, canGenerate;
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
    canGenerate = config.getJSONObject("audiobook").getBoolean("canGenerate");
    units =
        config
            .getJSONObject("audiobook")
            .getJSONObject("narrationDocument")
            .getJSONArray("synchronizationUnits");
    currentUnitIndex = NarrationPositionStore.initialUnitIndex(config, context);
    JSONObject position = NarrationPositionStore.initialPosition(config, context);
    offset = position == null ? 0 : position.getLong("offsetMilliseconds");
    api.configure(config);
    audio.authorize(api.headers());
    audio.reset();
    segments.clear();
    failures.clear();
    sourceUnitIndex = -1;
    JSONArray known = config.getJSONObject("audiobook").getJSONArray("segments");
    for (int i = 0; i < known.length(); i++) {
      JSONObject segment = known.getJSONObject(i);
      if (segment.getString("status").equals("ready"))
        segments.put(segment.getInt("sequence"), segment);
    }
    error = null;
    requestActiveSegment();
  }

  void command(String action, int unitIndex) {
    if (action.equals("pause")) pauseNarration();
    else if (action.equals("seek")) seek(unitIndex);
    else playNarration(action.equals("retry"));
  }

  private void playNarration(boolean retry) {
    if (config == null) return;
    if (retry) {
      sourceUnitIndex = -1;
      failures.remove(currentUnitIndex);
      segments.remove(currentUnitIndex);
    }
    audio.beginBuffering();
    active = true;
    error = null;
    buffering = true;
    publish();
    advance(retry);
  }

  void pauseNarration() {
    audio.endBuffering();
    active = false;
    buffering = false;
    if (audio != null) {
      if (sourceUnitIndex == currentUnitIndex) offset = audio.positionMilliseconds();
      audio.pause();
    }
    save();
    publish();
  }

  private void seek(int unitIndex) {
    if (unitIndex >= units.length()) {
      currentUnitIndex = 0;
      offset = 0;
      sourceUnitIndex = -1;
      pauseNarration();
      return;
    }
    if (unitIndex < 0) return;
    if (active) audio.beginBuffering();
    buffering = active;
    audio.pause();
    currentUnitIndex = unitIndex;
    error = null;
    offset = 0;
    sourceUnitIndex = -1;
    buffering = active;
    save();
    publish();
    if (active) advance(false);
    else requestActiveSegment();
  }

  private void advance(boolean retry) {
    if (!active) return;
    JSONObject segment = segments.get(currentUnitIndex);
    if (segment == null) {
      if (failures.containsKey(currentUnitIndex) && !retry) {
        fail(failures.get(currentUnitIndex));
        return;
      }
      request(currentUnitIndex, retry);
      requestAudioAhead();
      return;
    }
    try {
      if (sourceUnitIndex != currentUnitIndex) {
        sourceUnitIndex = currentUnitIndex;
        offset = Math.min(offset, Math.max(0, segment.getLong("durationMilliseconds") - 10));
        audio.load(
            segment,
            units.getJSONObject(currentUnitIndex).getString("id"),
            config.getJSONObject("audiobook").getString("title"),
            offset);
      } else audio.resume();
      buffering = false;
      publish();
      requestAudioAhead();
    } catch (Exception failure) {
      fail(failure.getMessage());
    }
  }

  private void requestActiveSegment() {
    if (closed || !canGenerate) return;
    if (failures.containsKey(currentUnitIndex)) {
      error = failures.get(currentUnitIndex);
      publish();
      return;
    }
    if (!segments.containsKey(currentUnitIndex)) request(currentUnitIndex, false);
  }

  private void requestAudioAhead() {
    if (!active || !canGenerate) return;
    double duration = -offset;
    try {
      for (int next = currentUnitIndex; next < units.length() && duration < 60000; next++) {
        JSONObject segment = segments.get(next);
        duration +=
            segment == null
                ? Math.max(1000, units.getJSONObject(next).getString("narrationText").length() * 80)
                : segment.getDouble("durationMilliseconds");
        if (failures.containsKey(next)) return;
        if (segment == null) request(next, false);
      }
    } catch (Exception failure) {
      fail(failure.getMessage());
    }
  }

  private void request(int unitIndex, boolean retry) {
    String id = conversionId;
    String requestId = id + ":" + unitIndex;
    if (!requests.add(requestId)) return;
    api.requestSegment(
        id,
        unitIndex,
        retry,
        (completed, failure) -> {
          requests.remove(requestId);
          if (closed) return;
          if (!id.equals(conversionId)) {
            if (active) advance(false);
            return;
          }
          if (failure != null) failures.put(unitIndex, failure);
          else segments.put(unitIndex, completed);
          if (active && unitIndex == currentUnitIndex) {
            if (failure != null) fail(failure);
            else advance(false);
          } else {
            if (unitIndex == currentUnitIndex && failure != null) {
              error = failure;
              publish();
            }
            requestAudioAhead();
          }
        });
  }

  private void save() {
    if (config == null) return;
    try {
      positions.save(
          conversionId,
          units.getJSONObject(currentUnitIndex).getString("id"),
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
            if (sourceUnitIndex == currentUnitIndex) offset = audio.positionMilliseconds();
            if (++count % 5 == 0) save();
            requestAudioAhead();
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
    if (!closed) listener.publish(currentUnitIndex, active, buffering, error);
  }

  @Override
  public void onEnded() {
    if (active) seek(currentUnitIndex + 1);
  }

  @Override
  public void onNext() {
    seek(currentUnitIndex + 1);
  }

  @Override
  public void onPrevious() {
    seek(currentUnitIndex - 1);
  }

  @Override
  public void onPlayWhenReadyChanged(boolean ready) {
    if (!ready && active && !buffering) pauseNarration();
    else if (ready && !active) playNarration(false);
  }

  @Override
  public void onFailure(String message) {
    fail(message);
  }

  void close() {
    pauseNarration();
    closed = true;
    main.removeCallbacks(tick);
  }
}

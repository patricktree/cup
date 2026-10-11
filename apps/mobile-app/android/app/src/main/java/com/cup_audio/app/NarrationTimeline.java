package com.cup_audio.app;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** The whole-audiobook timeline derived from independently stored audio segments. */
final class NarrationTimeline {
  /** One audio segment's interval on the timeline. */
  static final class Entry {
    final int unitIndex;
    final String unitId;
    final long start;
    final long duration;
    final String url;

    Entry(int unitIndex, String unitId, long start, long duration, String url) {
      this.unitIndex = unitIndex;
      this.unitId = unitId;
      this.start = start;
      this.duration = duration;
      this.url = url;
    }
  }

  private NarrationTimeline() {}

  /** Segments arrive in document order; those without audio take no time on the timeline. */
  static List<Entry> create(JSONArray segments, JSONArray units) throws Exception {
    List<Entry> entries = new ArrayList<>();
    long start = 0;
    for (int i = 0; i < segments.length(); i++) {
      JSONObject segment = segments.getJSONObject(i);
      if (!segment.getString("status").equals("ready")) continue;
      int unitIndex = segment.getInt("sequence");
      long duration = Math.round(segment.getDouble("durationMilliseconds"));
      entries.add(
          new Entry(
              unitIndex,
              units.getJSONObject(unitIndex).getString("id"),
              start,
              duration,
              segment.getString("url")));
      start += duration;
    }
    return entries;
  }

  static long duration(List<Entry> entries) {
    if (entries.isEmpty()) return 0;
    Entry last = entries.get(entries.size() - 1);
    return last.start + last.duration;
  }

  /** Finds the entry for a unit, or the next one with audio when that unit was skipped. */
  static int indexOfUnit(List<Entry> entries, int unitIndex) {
    for (int i = 0; i < entries.size(); i++) if (entries.get(i).unitIndex >= unitIndex) return i;
    return -1;
  }

  /** Finds the entry playing at a whole-audiobook position. */
  static int indexAtPosition(List<Entry> entries, long positionMilliseconds) {
    for (int i = entries.size() - 1; i > 0; i--)
      if (entries.get(i).start <= positionMilliseconds) return i;
    return 0;
  }
}

package com.cup_audio.app;

import android.content.Context;
import android.os.Handler;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Keeps anonymous listening positions local and sends account saves in arrival order. */
final class NarrationPositionStore {
  private final Context context;
  private final Handler main;
  private final NarrationApiClient api;
  private final ExecutorService writes = Executors.newSingleThreadExecutor();

  NarrationPositionStore(Context context, Handler main, NarrationApiClient api) {
    this.context = context;
    this.main = main;
    this.api = api;
  }

  static JSONObject initialPosition(JSONObject config, Context context) throws Exception {
    JSONObject position = config.optJSONObject("position");
    if (!config.optBoolean("isSignedIn")) {
      String stored =
          context
              .getSharedPreferences("positions", Context.MODE_PRIVATE)
              .getString(config.getString("conversionId"), null);
      if (stored != null) position = new JSONObject(stored);
    }
    return position;
  }

  static int initialUnitIndex(JSONObject config, Context context) throws Exception {
    JSONObject position = initialPosition(config, context);
    JSONArray units =
        config
            .getJSONObject("audiobook")
            .getJSONObject("narrationDocument")
            .getJSONArray("synchronizationUnits");
    if (position != null)
      for (int i = 0; i < units.length(); i++)
        if (units
            .getJSONObject(i)
            .getString("id")
            .equals(position.getString("synchronizationUnitId"))) return i;
    return 0;
  }

  void save(String id, String unitId, long offset, boolean signedIn, Consumer<String> onFailure)
      throws Exception {
    JSONObject position =
        new JSONObject().put("synchronizationUnitId", unitId).put("offsetMilliseconds", offset);
    if (!signedIn) {
      context
          .getSharedPreferences("positions", Context.MODE_PRIVATE)
          .edit()
          .putString(id, position.toString())
          .apply();
      return;
    }
    Map<String, String> auth = api.headers();
    writes.execute(
        () -> {
          try {
            api.http("PUT", "/api/audiobooks/" + id + "/position", position, auth);
          } catch (Exception failure) {
            main.post(
                () ->
                    onFailure.accept(
                        "Listening position could not be saved: " + failure.getMessage()));
          }
        });
  }

  void close() {
    writes.shutdown();
  }
}

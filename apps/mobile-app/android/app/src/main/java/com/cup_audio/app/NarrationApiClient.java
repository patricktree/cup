package com.cup_audio.app;

import android.os.Handler;
import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Owns authenticated HTTP and segment polling; callbacks run on the main thread. */
final class NarrationApiClient {
  static final String ORIGIN = "https://cup-audio.com";

  interface SegmentCallback {
    void complete(JSONObject segment, String error);
  }

  private final Handler main;
  private final ExecutorService network = Executors.newCachedThreadPool();
  private String token, cookie;

  NarrationApiClient(Handler main) {
    this.main = main;
  }

  void configure(JSONObject config) {
    authorize(config);
    cookie = CookieManager.getInstance().getCookie(ORIGIN + "/api");
  }

  void authorize(JSONObject config) {
    token = config.isNull("token") ? null : config.optString("token", null);
  }

  void requestSegment(String id, int sequence, boolean retry, SegmentCallback callback) {
    Map<String, String> auth = headers();
    network.execute(
        () -> {
          JSONObject result = null;
          String message = null;
          try {
            String path = "/api/audiobooks/" + id + "/segments/" + sequence;
            result = http("POST", path, new JSONObject().put("retry", retry), auth);
            while (result.getString("status").equals("generating")) {
              Thread.sleep(1000);
              result = http("GET", path, null, auth);
            }
            if (!result.getString("status").equals("ready"))
              throw new Exception(
                  result.optString("explanation", "Speech generation failed. Retry this passage."));
          } catch (Exception failure) {
            message = failure.getMessage();
          }
          JSONObject segment = result;
          String error = message;
          main.post(() -> callback.complete(segment, error));
        });
  }

  Map<String, String> headers() {
    Map<String, String> headers = new HashMap<>();
    if (token != null) headers.put("Authorization", "Bearer " + token);
    if (cookie != null) headers.put("Cookie", cookie);
    headers.put("Content-Type", "application/json");
    headers.put("X-Create-Audiobook-From-URL-Request", "1");
    return headers;
  }

  JSONObject http(String method, String path, JSONObject body, Map<String, String> headers)
      throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
    try {
      connection.setRequestMethod(method);
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(30000);
      for (Map.Entry<String, String> header : headers.entrySet())
        connection.setRequestProperty(header.getKey(), header.getValue());
      if (body != null) {
        connection.setDoOutput(true);
        try (java.io.OutputStream out = connection.getOutputStream()) {
          out.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
      }
      int status = connection.getResponseCode();
      if (status == 204) return new JSONObject();
      try (java.io.InputStream in =
          status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
        JSONObject response = new JSONObject(readResponse(in));
        if (status >= 400)
          throw new Exception(
              response.optJSONObject("error") == null
                  ? "Request failed."
                  : response.getJSONObject("error").getString("message"));
        return response;
      }
    } finally {
      connection.disconnect();
    }
  }

  private static String readResponse(java.io.InputStream input) throws java.io.IOException {
    java.io.ByteArrayOutputStream result = new java.io.ByteArrayOutputStream();
    byte[] buffer = new byte[4096];
    int count;
    while ((count = input.read(buffer)) != -1) result.write(buffer, 0, count);
    return result.toString(StandardCharsets.UTF_8.name());
  }

  void close() {
    network.shutdown();
  }
}

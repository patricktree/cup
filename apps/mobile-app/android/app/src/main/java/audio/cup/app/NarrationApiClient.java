package audio.cup.app;

import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/** Owns authenticated HTTP for the native player. */
final class NarrationApiClient {
  static final String ORIGIN = "https://cup.audio";

  private String token, cookie;

  void configure(JSONObject config) {
    authorize(config);
    cookie = CookieManager.getInstance().getCookie(ORIGIN + "/api");
  }

  void authorize(JSONObject config) {
    token = config.isNull("token") ? null : config.optString("token", null);
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
}

package audio.cup.app;

import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Debug builds only. Replaces the Google sign-in plugin of the same name when the mobile E2E suite
 * launches the app with a test origin: {@code signIn} returns an ID token from the suite's fake auth
 * provider that carries the hashed nonce it was given, so the web app's unchanged sign-in runs
 * against the test Worker without Google. The fake auth provider's origin is the {@code supabaseUrl}
 * of the test Worker's auth configuration.
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class FakeGoogleSignInPlugin extends Plugin {
    private static final Pattern LOCALHOST_ORIGIN = Pattern.compile("http://localhost:[1-9][0-9]{0,4}");
    private static final int TIMEOUT_MILLISECONDS = 10_000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    /** Read at load, from the launch intent: a later intent, such as a share, carries no origin. */
    private String apiOrigin;

    @Override
    public void load() {
        apiOrigin = TestApiOrigin.fromIntent(getActivity().getIntent());
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String nonce = call.getString("nonce");
        if (nonce == null || apiOrigin == null) {
            call.reject("The sign-in fake needs a nonce and the test origin.");
            return;
        }
        executor.execute(() -> {
            try {
                call.resolve(signInWithFakeAuthProvider(apiOrigin, nonce));
            } catch (IOException | JSONException | IllegalStateException error) {
                call.reject("The sign-in fake could not reach the fake auth provider: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @NonNull
    private static JSObject signInWithFakeAuthProvider(String apiOrigin, String nonce) throws IOException, JSONException {
        String authOrigin = new JSONObject(request(apiOrigin + "/api/auth/config", null)).getString("supabaseUrl");
        // Plain HTTP reaches localhost only; never send anything elsewhere.
        if (!LOCALHOST_ORIGIN.matcher(authOrigin).matches()) {
            throw new IllegalStateException("The test Worker's auth provider is not at localhost: " + authOrigin);
        }
        JSONObject token = new JSONObject(
            request(authOrigin + "/qa/google-id-token", new JSONObject().put("nonce", nonce).toString())
        );
        JSObject result = new JSObject();
        result.put("idToken", token.getString("idToken"));
        result.put("userId", token.getString("userId"));
        result.put("email", token.getString("email"));
        result.put("displayName", token.getString("displayName"));
        result.put("givenName", JSONObject.NULL);
        result.put("familyName", JSONObject.NULL);
        result.put("imageUrl", JSONObject.NULL);
        result.put("accessToken", JSONObject.NULL);
        result.put("serverAuthCode", JSONObject.NULL);
        return result;
    }

    /** Sends a GET, or a JSON POST when a body is given, and returns the response body. */
    @NonNull
    private static String request(String url, String jsonBody) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MILLISECONDS);
            connection.setReadTimeout(TIMEOUT_MILLISECONDS);
            if (jsonBody != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException(url + " answered " + status + ".");
            }
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                for (int read = input.read(buffer); read != -1; read = input.read(buffer)) {
                    body.write(buffer, 0, read);
                }
                return body.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            connection.disconnect();
        }
    }
}

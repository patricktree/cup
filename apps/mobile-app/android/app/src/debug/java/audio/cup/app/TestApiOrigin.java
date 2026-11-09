package audio.cup.app;

import android.content.Intent;
import androidx.annotation.Nullable;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Debug builds only: the test Worker origin the mobile E2E suite passes as an intent extra. */
final class TestApiOrigin {
    static final String EXTRA = "cupTestApiOrigin";
    private static final Pattern LOCALHOST_ORIGIN = Pattern.compile("http://localhost:([1-9][0-9]{0,4})");

    private TestApiOrigin() {}

    /**
     * Returns the origin, or null when the launch carries none.
     *
     * @throws IllegalArgumentException when the value is anything but {@code http://localhost:<port>}
     */
    @Nullable
    static String fromIntent(@Nullable Intent intent) {
        String value = intent == null ? null : intent.getStringExtra(EXTRA);
        if (value == null) {
            return null;
        }
        Matcher matcher = LOCALHOST_ORIGIN.matcher(value);
        if (!matcher.matches() || Integer.parseInt(matcher.group(1)) > 65535) {
            throw new IllegalArgumentException(
                "The " + EXTRA + " launch argument must be exactly http://localhost:<port>, got \"" + value + "\"."
            );
        }
        return value;
    }
}

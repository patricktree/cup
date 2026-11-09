package audio.cup.app;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Debug builds only. Reads the mobile E2E suite's launch arguments around Capacitor's bridge
 * creation, so the main sources and release builds stay free of test hooks.
 */
public class DebugApplication extends Application {
    /**
     * With the test origin, keeps the real Google sign-in plugin instead of the fake, so a test can
     * open Google's real add-account screen.
     */
    static final String REAL_GOOGLE_SIGN_IN_EXTRA = "cupTestRealGoogleSignIn";

    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(new LaunchArgumentsCallbacks());
    }

    private static final class LaunchArgumentsCallbacks implements ActivityLifecycleCallbacks {
        @Override
        public void onActivityPreCreated(@NonNull Activity activity, @Nullable Bundle savedInstanceState) {
            if (!(activity instanceof BridgeActivity)) {
                return;
            }
            // Throws on a malformed argument, which stops the app before it can reach production.
            if (TestApiOrigin.fromIntent(activity.getIntent()) != null) {
                ((BridgeActivity) activity).registerPlugin(TestApiOriginPlugin.class);
            }
        }

        @Override
        public void onActivityPostCreated(@NonNull Activity activity, @Nullable Bundle savedInstanceState) {
            if (!(activity instanceof BridgeActivity)) {
                return;
            }
            Intent intent = activity.getIntent();
            if (TestApiOrigin.fromIntent(intent) == null || intent.getBooleanExtra(REAL_GOOGLE_SIGN_IN_EXTRA, false)) {
                return;
            }
            // Capacitor registers the plugins it found after those registered before onCreate, so the
            // fake replaces the real plugin of the same name only once the bridge exists. The web app
            // calls the plugin by name, so its calls reach the fake from then on.
            Bridge bridge = ((BridgeActivity) activity).getBridge();
            bridge.registerPlugin(FakeGoogleSignInPlugin.class);
        }

        @Override
        public void onActivityCreated(@NonNull Activity activity, @Nullable Bundle savedInstanceState) {}

        @Override
        public void onActivityStarted(@NonNull Activity activity) {}

        @Override
        public void onActivityResumed(@NonNull Activity activity) {}

        @Override
        public void onActivityPaused(@NonNull Activity activity) {}

        @Override
        public void onActivityStopped(@NonNull Activity activity) {}

        @Override
        public void onActivitySaveInstanceState(@NonNull Activity activity, @NonNull Bundle outState) {}

        @Override
        public void onActivityDestroyed(@NonNull Activity activity) {}
    }
}

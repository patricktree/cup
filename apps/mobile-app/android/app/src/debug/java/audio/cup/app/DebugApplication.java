package audio.cup.app;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.getcapacitor.BridgeActivity;

/**
 * Debug builds only. Reads the mobile E2E suite's launch arguments before Capacitor creates its
 * bridge, so the main sources and release builds stay free of test hooks.
 */
public class DebugApplication extends Application {
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

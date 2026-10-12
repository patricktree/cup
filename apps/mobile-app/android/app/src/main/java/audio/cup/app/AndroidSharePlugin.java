package audio.cup.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidShare")
public class AndroidSharePlugin extends Plugin {
    @Override
    public void load() {
        receiveShare(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        receiveShare(intent);
    }

    private void receiveShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }
        String mimeType = intent.getType();
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (mimeType == null || !mimeType.startsWith("text/") || text == null || text.toString().trim().isEmpty()) {
            return;
        }

        JSObject share = new JSObject();
        share.put("text", text.toString().trim());
        // Retain cold-start shares until the web app has registered its listener.
        notifyListeners("shareIntentReceived", share, true);
        intent.removeExtra(Intent.EXTRA_TEXT);
    }
}

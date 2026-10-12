package audio.cup.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidAppLinks")
public class AndroidAppLinksPlugin extends Plugin {
    @Override
    public void load() {
        receiveAppLink(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        receiveAppLink(intent);
    }

    private void receiveAppLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri url = intent.getData();
        if (url == null || !"https".equals(url.getScheme()) ||
            !"cup.audio".equals(url.getHost())) {
            return;
        }

        JSObject appLink = new JSObject();
        appLink.put("url", url.toString());
        // Keep cold-start links until the web router registers its listener.
        notifyListeners("appLinkReceived", appLink, true);
        intent.setData(null);
    }
}

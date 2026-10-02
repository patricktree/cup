package com.cup_audio.app;

import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Installs the owner-session cookie in the WebView used by the HTML audio element. */
@CapacitorPlugin(name = "AccountMedia")
public class AccountMediaPlugin extends Plugin {
    private static final String ORIGIN = "https://cup-audio.com";

    @Override
    public void load() {
        CookieManager manager = CookieManager.getInstance();
        manager.setAcceptCookie(true);
        manager.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token", "");
        if (!token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) {
            call.reject("Invalid media session");
            return;
        }
        int maxAge = call.getInt("maxAge", 0);
        maxAge = Math.max(0, Math.min(300, maxAge));
        setCookie(call, "cup_media=" + token + "; Max-Age=" + maxAge);
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        setCookie(call, "cup_media=; Max-Age=0");
    }

    private void setCookie(PluginCall call, String value) {
        CookieManager manager = CookieManager.getInstance();
        manager.setCookie(ORIGIN, value + "; Path=/api/files; Secure; HttpOnly; SameSite=None", accepted -> {
            manager.flush();
            if (Boolean.TRUE.equals(accepted)) call.resolve(new JSObject());
            else call.reject("Media cookie could not be installed");
        });
    }
}

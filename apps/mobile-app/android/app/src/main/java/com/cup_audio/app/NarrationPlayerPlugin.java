package com.cup_audio.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NarrationPlayer")
public class NarrationPlayerPlugin extends Plugin {
  static NarrationPlayerPlugin bridge;
  static String configuration;
  static boolean wantsPlayback;

  @PluginMethod
  public void configure(PluginCall call) {
    getActivity()
        .runOnUiThread(
            () -> {
              if (NarrationPlaybackService.instance != null)
                NarrationPlaybackService.instance.pauseNarration();
              wantsPlayback = false;
              bridge = this;
              configuration = call.getData().toString();
              try {
                if (NarrationPlaybackService.instance != null)
                  NarrationPlaybackService.instance.configure(
                      new org.json.JSONObject(configuration));
              } catch (Exception error) {
                call.reject(error.getMessage());
                return;
              }
              JSObject state = new JSObject();
              state.put("currentUnitIndex", 0);
              state.put("isPlaying", false);
              state.put("isBuffering", false);
              state.put("error", org.json.JSONObject.NULL);
              try {
                org.json.JSONObject config = new org.json.JSONObject(configuration);
                state.put(
                    "currentUnitIndex", NarrationPositionStore.initialUnitIndex(config, getContext()));
              } catch (Exception error) {
                call.reject(error.getMessage());
                return;
              }
              call.resolve(state);
            });
  }

  @PluginMethod
  public void command(PluginCall call) {
    getActivity()
        .runOnUiThread(
            () -> {
              String action = call.getString("action", "pause");
              NarrationPlaybackService service = NarrationPlaybackService.instance;
              try {
                if (configuration != null
                    && call.getString("playerId") != null
                    && !new org.json.JSONObject(configuration)
                        .getString("playerId")
                        .equals(call.getString("playerId"))) {
                  call.resolve();
                  return;
                }
              } catch (Exception error) {
                call.reject(error.getMessage());
                return;
              }
              if (action.equals("pause")) wantsPlayback = false;
              if ((action.equals("play") || action.equals("retry")) && configuration != null) {
                wantsPlayback = true;
                try {
                  org.json.JSONObject config = new org.json.JSONObject(configuration);
                  if (call.getData().has("token")) config.put("token", call.getData().opt("token"));
                  configuration = config.toString();
                } catch (Exception error) {
                  call.reject(error.getMessage());
                  return;
                }
                Intent intent = new Intent(getContext(), NarrationPlaybackService.class);
                intent.putExtra("playerId", call.getString("playerId"));
                intent.putExtra("action", action);
                ContextCompat.startForegroundService(getContext(), intent);
              } else if (service != null) service.command(action, call.getInt("unitIndex", 0));
              else if (action.equals("seek") && configuration != null) {
                Intent intent = new Intent(getContext(), NarrationPlaybackService.class);
                intent.putExtra("playerId", call.getString("playerId"));
                intent.putExtra("action", "seek");
                intent.putExtra("unitIndex", call.getInt("unitIndex", 0));
                getContext().startService(intent);
              }
              call.resolve();
            });
  }

  static void publish(JSObject state) {
    if (bridge != null) bridge.notifyListeners("state", state);
  }
}

package com.cup_audio.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

/** Hosts the native coordinator for Android's media-playback service lifetime. */
public class NarrationPlaybackService extends MediaSessionService {
  static NarrationPlaybackService instance;
  private NarrationPlaybackCoordinator coordinator;
  private NarrationAudioAdapter audio;
  private NarrationApiClient api;
  private NarrationPositionStore positions;

  @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    setMediaNotificationProvider(
        new DefaultMediaNotificationProvider.Builder(this)
            .setNotificationId(410)
            .setChannelId("narration")
            .setChannelName(R.string.app_name)
            .build());
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
          .createNotificationChannel(
              new NotificationChannel(
                  "narration", "Narration", NotificationManager.IMPORTANCE_LOW));
    Handler main = new Handler(Looper.getMainLooper());
    api = new NarrationApiClient(main);
    positions = new NarrationPositionStore(this, main, api);
    coordinator =
        new NarrationPlaybackCoordinator(
            this,
            main,
            api,
            positions,
            (currentUnitIndex, playing, buffering, error) -> {
              if (instance != this) return;
              NarrationPlayerPlugin.wantsPlayback = playing;
              JSObject state = new JSObject();
              state.put("currentUnitIndex", currentUnitIndex);
              state.put("isPlaying", playing);
              state.put("isBuffering", buffering);
              state.put("error", error == null ? JSONObject.NULL : error);
              NarrationPlayerPlugin.publish(state);
            });
    audio = new NarrationAudioAdapter(this, coordinator);
    coordinator.attach(audio);
  }

  @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    super.onStartCommand(intent, flags, startId);
    if (intent == null || NarrationPlayerPlugin.configuration == null) return START_NOT_STICKY;
    if (!"seek".equals(intent.getStringExtra("action")))
      startForeground(
          410,
          new NotificationCompat.Builder(this, "narration")
              .setContentTitle("Preparing narration")
              .setSmallIcon(android.R.drawable.ic_media_play)
              .build());
    try {
      JSONObject incoming = new JSONObject(NarrationPlayerPlugin.configuration);
      boolean shouldPlay = NarrationPlayerPlugin.wantsPlayback;
      if (intent.getStringExtra("playerId") != null
          && !incoming.getString("playerId").equals(intent.getStringExtra("playerId")))
        return START_NOT_STICKY;
      if (!coordinator.hasConversion(incoming.getString("conversionId"))) configure(incoming);
      coordinator.authorize(incoming);
      if ("seek".equals(intent.getStringExtra("action")))
        coordinator.command("seek", intent.getIntExtra("unitIndex", 0));
      else if (shouldPlay)
        coordinator.command("retry".equals(intent.getStringExtra("action")) ? "retry" : "play", 0);
      else pauseNarration();
    } catch (Exception failure) {
      coordinator.onFailure(failure.getMessage());
    }
    return START_NOT_STICKY;
  }

  @Nullable
  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo info) {
    return audio.session();
  }

  void configure(JSONObject input) throws Exception {
    coordinator.configure(input);
  }

  void command(String action, int unitIndex) {
    coordinator.command(action, unitIndex);
  }

  void pauseNarration() {
    coordinator.pauseNarration();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    pauseNarration();
    stopSelf();
  }

  @Override
  public void onDestroy() {
    coordinator.close();
    positions.close();
    api.close();
    audio.close();
    instance = null;
    super.onDestroy();
  }
}

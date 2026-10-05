package com.cup_audio.app;

import android.content.Context;
import android.os.PowerManager;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import java.util.Map;
import org.json.JSONObject;

/** Owns Media3, lock-screen controls, audio focus, and buffering wake locks. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class NarrationAudioAdapter {
  interface Listener {
    void onEnded();

    void onNext();

    void onPrevious();

    void onPlayWhenReadyChanged(boolean ready);

    void onFailure(String message);
  }

  private final ExoPlayer player;
  private final MediaSession session;
  private final DefaultHttpDataSource.Factory httpFactory;
  private final PowerManager.WakeLock preparationWakeLock;

  NarrationAudioAdapter(Context context, Listener listener) {
    preparationWakeLock =
        ((PowerManager) context.getSystemService(Context.POWER_SERVICE))
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Cup:prepare-audio");
    httpFactory = new DefaultHttpDataSource.Factory();
    player =
        new ExoPlayer.Builder(context)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory))
            .build();
    player.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build(),
        true);
    player.setWakeMode(C.WAKE_MODE_NETWORK);
    ForwardingPlayer sessionPlayer =
        new ForwardingPlayer(player) {
          @Override
          public Player.Commands getAvailableCommands() {
            return super.getAvailableCommands()
                .buildUpon()
                .remove(Player.COMMAND_SET_MEDIA_ITEM)
                .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                .build();
          }

          @Override
          public boolean isCommandAvailable(int command) {
            return getAvailableCommands().contains(command);
          }

          @Override
          public void seekToNextMediaItem() {
            listener.onNext();
          }

          @Override
          public void seekToPreviousMediaItem() {
            listener.onPrevious();
          }

          @Override
          public void seekToNext() {
            listener.onNext();
          }

          @Override
          public void seekToPrevious() {
            listener.onPrevious();
          }
        };
    session = new MediaSession.Builder(context, sessionPlayer).build();
    player.addListener(
        new Player.Listener() {
          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY && preparationWakeLock.isHeld())
              preparationWakeLock.release();
            if (state == Player.STATE_ENDED) listener.onEnded();
          }

          @Override
          public void onPlayWhenReadyChanged(boolean ready, int reason) {
            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST
                || reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)
              listener.onPlayWhenReadyChanged(ready);
          }

          @Override
          public void onPlayerError(PlaybackException failure) {
            listener.onFailure("Audio could not be played. Retry this segment.");
          }
        });
  }

  MediaSession session() {
    return session;
  }

  long positionMilliseconds() {
    return player.getCurrentPosition();
  }

  void authorize(Map<String, String> headers) {
    httpFactory.setDefaultRequestProperties(headers);
  }

  void reset() {
    player.stop();
    player.clearMediaItems();
  }

  void pause() {
    player.pause();
  }

  void resume() {
    player.play();
  }

  void load(JSONObject segment, String unitId, String title, long offset) throws Exception {
    MediaItem item =
        new MediaItem.Builder()
            .setUri(segment.getString("url"))
            .setMediaId(unitId)
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
            .build();
    player.setMediaItem(item, offset);
    player.prepare();
    player.play();
  }

  void beginBuffering() {
    if (!preparationWakeLock.isHeld()) preparationWakeLock.acquire(120_000);
  }

  void endBuffering() {
    if (preparationWakeLock.isHeld()) preparationWakeLock.release();
  }

  void close() {
    endBuffering();
    session.release();
    player.release();
  }
}

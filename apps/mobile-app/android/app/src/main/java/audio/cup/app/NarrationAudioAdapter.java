package audio.cup.app;

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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Owns Media3, lock-screen controls, audio focus, and buffering wake locks.
 *
 * <p>The player holds one media item per audio segment, so it buffers the following segment ahead
 * of each boundary. The media session instead sees one item spanning the whole audiobook, which
 * gives the notification and lock screen a single progress bar with the exact length.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class NarrationAudioAdapter {
  interface Listener {
    /** Playback moved to another segment, by reaching a boundary or by seeking. */
    void onSegmentChanged();

    void onBufferingChanged(boolean isBuffering);

    void onEnded();

    /** A position on the whole-audiobook timeline chosen in the system media controls. */
    void onSeek(long positionMilliseconds);

    void onNext();

    void onPrevious();

    void onPlayWhenReadyChanged(boolean ready);

    void onFailure(String message);
  }

  private final ExoPlayer player;
  private final MediaSession session;
  private final DefaultHttpDataSource.Factory httpFactory;
  private final PowerManager.WakeLock preparationWakeLock;
  private List<NarrationTimeline.Entry> entries = new ArrayList<>();

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
          public long getDuration() {
            return entries.isEmpty() ? C.TIME_UNSET : NarrationTimeline.duration(entries);
          }

          @Override
          public long getContentDuration() {
            return getDuration();
          }

          @Override
          public long getCurrentPosition() {
            return segmentStart() + super.getCurrentPosition();
          }

          @Override
          public long getContentPosition() {
            return getCurrentPosition();
          }

          @Override
          public long getBufferedPosition() {
            return segmentStart() + super.getBufferedPosition();
          }

          @Override
          public long getContentBufferedPosition() {
            return getBufferedPosition();
          }

          @Override
          public void seekTo(long positionMilliseconds) {
            listener.onSeek(positionMilliseconds);
          }

          @Override
          public void seekTo(int mediaItemIndex, long positionMilliseconds) {
            listener.onSeek(positionMilliseconds);
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
            listener.onBufferingChanged(state == Player.STATE_BUFFERING);
            if (state == Player.STATE_ENDED) listener.onEnded();
          }

          @Override
          public void onMediaItemTransition(MediaItem item, int reason) {
            if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED)
              listener.onSegmentChanged();
          }

          @Override
          public void onPlayWhenReadyChanged(boolean ready, int reason) {
            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST
                || reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)
              listener.onPlayWhenReadyChanged(ready);
          }

          @Override
          public void onPlayerError(PlaybackException failure) {
            listener.onFailure("Audio could not be played. Press Play to try again.");
          }
        });
  }

  MediaSession session() {
    return session;
  }

  /** The position within the current segment. */
  long positionMilliseconds() {
    return player.getCurrentPosition();
  }

  int currentIndex() {
    return player.getCurrentMediaItemIndex();
  }

  private long segmentStart() {
    int index = player.getCurrentMediaItemIndex();
    return index >= 0 && index < entries.size() ? entries.get(index).start : 0;
  }

  void authorize(Map<String, String> headers) {
    httpFactory.setDefaultRequestProperties(headers);
  }

  void reset() {
    player.stop();
    player.clearMediaItems();
    entries = new ArrayList<>();
  }

  void seek(int index, long offset) {
    player.seekTo(index, offset);
  }

  void pause() {
    player.pause();
  }

  void resume() {
    player.play();
  }

  void load(List<NarrationTimeline.Entry> timeline, String title, int index, long offset) {
    entries = timeline;
    List<MediaItem> items = new ArrayList<>();
    for (NarrationTimeline.Entry entry : timeline)
      items.add(
          new MediaItem.Builder()
              .setUri(entry.url)
              .setMediaId(entry.unitId)
              .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
              .build());
    player.setMediaItems(items, index, offset);
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

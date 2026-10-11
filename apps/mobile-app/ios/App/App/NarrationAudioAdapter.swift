import AVFoundation
import MediaPlayer
import UIKit

/// Owns the queue player, interruptions, remote commands, and finite buffering background tasks.
///
/// The queue holds the current segment and the following one, so the boundary between them needs
/// no loading pause. The following segment is supplied one at a time with current authorization.
final class NarrationAudioAdapter: NarrationAudioOutput {
  var onTick: (() -> Void)?
  var onAdvanced: (() -> Void)?
  var onEnded: (() -> Void)?
  var onFollowingFailed: (() -> Void)?
  var onFailure: ((String) -> Void)?
  var onPause: (() -> Void)?
  var onPlay: (() -> Void)?
  var onNext: (() -> Void)?
  var onPrevious: (() -> Void)?
  var onSeek: ((Double) -> Void)?
  private let player = AVQueuePlayer()
  // Tracked here because the queue may already have advanced when an item's end is delivered.
  private var playingItem: AVPlayerItem?
  private var followingItem: AVPlayerItem?
  private var followingObservation: NSKeyValueObservation?
  // Keeps the failure observer of a segment alive after it advanced from following to playing.
  private var advancedObservation: NSKeyValueObservation?
  private var observation: NSKeyValueObservation?
  private var periodicObserver: Any?
  private var observers: [NSObjectProtocol] = []
  private var commands: [(MPRemoteCommand, Any)] = []
  private var revision = 0
  private var backgroundTask = UIBackgroundTaskIdentifier.invalid

  var positionMilliseconds: Double? {
    let seconds = player.currentTime().seconds
    return seconds.isFinite ? seconds * 1000 : nil
  }

  init() {
    periodicObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1, preferredTimescale: 1000), queue: .main
    ) { [weak self] _ in self?.onTick?() }
    observers.append(
      NotificationCenter.default.addObserver(
        forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
      ) { [weak self] notification in
        guard let self, let item = notification.object as? AVPlayerItem,
          item === self.playingItem
        else { return }
        // The queue player continues into the following item by itself.
        if let followingItem = self.followingItem {
          self.playingItem = followingItem
          self.followingItem = nil
          self.advancedObservation = self.followingObservation
          self.followingObservation = nil
          self.onAdvanced?()
        } else {
          self.onEnded?()
        }
      })
    observers.append(
      NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
      ) { [weak self] notification in
        if (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
          == AVAudioSession.InterruptionType.began.rawValue
        {
          self?.onPause?()
        }
      })
    observers.append(
      NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] notification in
        if (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
          == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
        {
          self?.onPause?()
        }
      })
    let remote = MPRemoteCommandCenter.shared()
    bind(remote.playCommand) { [weak self] in self?.onPlay?() }
    bind(remote.pauseCommand) { [weak self] in self?.onPause?() }
    bind(remote.nextTrackCommand) { [weak self] in self?.onNext?() }
    bind(remote.previousTrackCommand) { [weak self] in self?.onPrevious?() }
    let seekTarget = remote.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      DispatchQueue.main.async { self?.onSeek?(event.positionTime * 1000) }
      return .success
    }
    commands.append((remote.changePlaybackPositionCommand, seekTarget))
  }

  private func bind(_ command: MPRemoteCommand, action: @escaping () -> Void) {
    let target = command.addTarget { _ in
      DispatchQueue.main.async { action() }
      return .success
    }
    commands.append((command, target))
  }

  func activate() throws {
    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    try AVAudioSession.sharedInstance().setActive(true)
  }

  func load(
    _ url: URL, headers: [String: String], offset: Double,
    completion: @escaping (String?) -> Void
  ) {
    revision += 1
    let generation = revision
    let item = createItem(url, headers: headers)
    observation = item.observe(\.status, options: [.new, .initial]) { [weak self] item, _ in
      DispatchQueue.main.async {
        guard let self, generation == self.revision else { return }
        if item.status == .failed {
          completion(item.error?.localizedDescription ?? "Audio could not be played.")
        }
        if item.status == .readyToPlay {
          let duration = item.duration.seconds
          let position = min(
            offset / 1000, duration.isFinite ? max(0, duration - 0.01) : offset / 1000)
          self.player.seek(to: CMTime(seconds: position, preferredTimescale: 1000)) { _ in
            DispatchQueue.main.async {
              guard generation == self.revision else { return }
              self.player.play()
              completion(nil)
            }
          }
        }
      }
    }
    playingItem = item
    followingItem = nil
    followingObservation = nil
    advancedObservation = nil
    player.removeAllItems()
    player.insert(item, after: nil)
  }

  func enqueueNext(_ url: URL?, headers: [String: String]) {
    if let followingItem { player.remove(followingItem) }
    followingObservation = nil
    followingItem = url.map { createItem($0, headers: headers) }
    guard let item = followingItem, player.canInsert(item, after: playingItem) else { return }
    // The queue player would skip a failed item silently, so its failure is reported instead.
    followingObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
      DispatchQueue.main.async {
        guard let self, item.status == .failed else { return }
        if item === self.followingItem {
          self.player.remove(item)
          self.followingItem = nil
          self.onFollowingFailed?()
        } else if item === self.playingItem {
          self.onFailure?(item.error?.localizedDescription ?? "Audio could not be played.")
        }
      }
    }
    player.insert(item, after: playingItem)
  }

  private func createItem(_ url: URL, headers: [String: String]) -> AVPlayerItem {
    AVPlayerItem(asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers]))
  }

  func resume() { player.play() }
  func pause() {
    revision += 1
    observation = nil
    player.pause()
  }

  /// Publishes the whole-audiobook timeline, not the current segment's.
  func updateNowPlaying(title: String, position: Double, duration: Double, isPlaying: Bool) {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyPlaybackDuration: duration / 1000,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position / 1000,
      MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
    ]
  }

  func beginBufferingTask() {
    if backgroundTask == .invalid {
      backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in self?.onPause?() }
    }
  }
  func endBufferingTask() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }

  deinit {
    if let periodicObserver { player.removeTimeObserver(periodicObserver) }
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    for (command, target) in commands { command.removeTarget(target) }
    endBufferingTask()
  }
}

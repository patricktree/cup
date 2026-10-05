import AVFoundation
import MediaPlayer
import UIKit

/// Owns AVPlayer, interruptions, remote commands, and finite buffering background tasks.
final class NarrationAudioAdapter: NarrationAudioOutput {
  var onTick: (() -> Void)?
  var onEnded: (() -> Void)?
  var onPause: (() -> Void)?
  var onPlay: (() -> Void)?
  var onNext: (() -> Void)?
  var onPrevious: (() -> Void)?
  private let player = AVPlayer()
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
          item === self.player.currentItem
        else { return }
        self.onEnded?()
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
    let item = AVPlayerItem(
      asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers]))
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
    player.replaceCurrentItem(with: item)
  }

  func resume() { player.play() }
  func pause() {
    revision += 1
    observation = nil
    player.pause()
  }

  func updateNowPlaying(title: String, offset: Double, isPlaying: Bool) {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: title,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: offset / 1000,
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

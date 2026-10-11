import Foundation

protocol NarrationAudioOutput: AnyObject {
  var onTick: (() -> Void)? { get set }
  /// Playback continued into the segment given to `enqueueNext`.
  var onAdvanced: (() -> Void)? { get set }
  /// The current segment ended and no following segment was enqueued.
  var onEnded: (() -> Void)? { get set }
  /// The enqueued segment could not be loaded and was dropped, so the current one will end.
  var onFollowingFailed: (() -> Void)? { get set }
  /// The segment being played failed after it started.
  var onFailure: ((String) -> Void)? { get set }
  var onPause: (() -> Void)? { get set }
  var onPlay: (() -> Void)? { get set }
  var onNext: (() -> Void)? { get set }
  var onPrevious: (() -> Void)? { get set }
  /// A position on the whole-audiobook timeline chosen in the system media controls.
  var onSeek: ((Double) -> Void)? { get set }
  /// The position within the current segment.
  var positionMilliseconds: Double? { get }
  func activate() throws
  func load(
    _ url: URL, headers: [String: String], offset: Double, completion: @escaping (String?) -> Void)
  func enqueueNext(_ url: URL?, headers: [String: String])
  func resume()
  func pause()
  func updateNowPlaying(title: String, position: Double, duration: Double, isPlaying: Bool)
  func beginBufferingTask()
  func endBufferingTask()
}

protocol NarrationApi: AnyObject {
  var headers: [String: String] { get }
  func configure(token: String?, cookies: [HTTPCookie])
  func authorize(_ token: String?)
  func http(
    _ method: String, _ path: String, body: [String: Any]?, headers: [String: String],
    completion: @escaping (Result<[String: Any], Error>) -> Void)
}

protocol NarrationPositions: AnyObject {
  var onFailure: ((String) -> Void)? { get set }
  func restore(_ config: [String: Any], conversionId: String, isSignedIn: Bool) -> [String: Any]?
  func save(conversionId: String, unitId: String, offset: Double, isSignedIn: Bool)
}

import Foundation

protocol NarrationAudioOutput: AnyObject {
  var onTick: (() -> Void)? { get set }
  var onEnded: (() -> Void)? { get set }
  var onPause: (() -> Void)? { get set }
  var onPlay: (() -> Void)? { get set }
  var onNext: (() -> Void)? { get set }
  var onPrevious: (() -> Void)? { get set }
  var positionMilliseconds: Double? { get }
  func activate() throws
  func load(
    _ url: URL, headers: [String: String], offset: Double, completion: @escaping (String?) -> Void)
  func resume()
  func pause()
  func updateNowPlaying(title: String, offset: Double, isPlaying: Bool)
  func beginBufferingTask()
  func endBufferingTask()
}

protocol NarrationApi: AnyObject {
  var headers: [String: String] { get }
  func configure(token: String?, cookies: [HTTPCookie])
  func authorize(_ token: String?)
  func requestSegment(
    _ id: String, sequence: Int, retry: Bool,
    completion: @escaping (Result<[String: Any], Error>) -> Void)
  func http(
    _ method: String, _ path: String, body: [String: Any]?, headers: [String: String],
    completion: @escaping (Result<[String: Any], Error>) -> Void)
}

protocol NarrationPositions: AnyObject {
  var onFailure: ((String) -> Void)? { get set }
  func restore(_ config: [String: Any], conversionId: String, isSignedIn: Bool) -> [String: Any]?
  func save(conversionId: String, unitId: String, offset: Double, isSignedIn: Bool)
}

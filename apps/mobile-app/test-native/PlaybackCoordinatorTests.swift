import Foundation

private final class Audio: NarrationAudioOutput {
  var onTick: (() -> Void)?
  var onEnded: (() -> Void)?
  var onPause: (() -> Void)?
  var onPlay: (() -> Void)?
  var onNext: (() -> Void)?
  var onPrevious: (() -> Void)?
  var positionMilliseconds: Double?
  var loads: [(URL, Double)] = []
  func activate() throws {}
  func load(
    _ url: URL, headers: [String: String], offset: Double, completion: @escaping (String?) -> Void
  ) {
    loads.append((url, offset))
    positionMilliseconds = offset
    completion(nil)
  }
  func resume() {}
  func pause() {}
  func updateNowPlaying(title: String, offset: Double, isPlaying: Bool) {}
  func beginBufferingTask() {}
  func endBufferingTask() {}
}

private final class Api: NarrationApi {
  var headers: [String: String] = [:]
  var requests: [(String, Int, Bool, (Result<[String: Any], Error>) -> Void)] = []
  var writes: [(String, [String: Any], [String: String], (Result<[String: Any], Error>) -> Void)] =
    []
  func configure(token: String?, cookies: [HTTPCookie]) { authorize(token) }
  func authorize(_ token: String?) { headers = token.map { ["Authorization": $0] } ?? [:] }
  func requestSegment(
    _ id: String, sequence: Int, retry: Bool,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    requests.append((id, sequence, retry, completion))
  }
  func http(
    _ method: String, _ path: String, body: [String: Any]?, headers: [String: String],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    precondition(method == "PUT")
    writes.append((path, body!, headers, completion))
  }
  func complete(_ index: Int, duration: Double = 20000) {
    let (_, sequence, _, callback) = requests[index]
    callback(
      .success([
        "sequence": sequence, "status": "ready", "durationMilliseconds": duration,
        "url": "https://cup-audio.com/audio/\(sequence)",
      ]))
  }
}

private final class Positions: NarrationPositions {
  var onFailure: ((String) -> Void)?
  var position: [String: Any]?
  var restores = 0
  var saved: [(String, Double)] = []
  func restore(_ config: [String: Any], conversionId: String, isSignedIn: Bool) -> [String: Any]? {
    restores += 1
    return position
  }
  func save(conversionId: String, unitId: String, offset: Double, isSignedIn: Bool) {
    saved.append((unitId, offset))
  }
}

private func config(_ id: String = "article", canGenerate: Bool = true) -> [String: Any] {
  [
    "conversionId": id, "playerId": "player", "isSignedIn": true,
    "audiobook": [
      "title": "Article", "segments": [], "canGenerate": canGenerate,
      "narrationDocument": [
        "synchronizationUnits":
          (0..<8).map { ["id": "unit-\($0)", "narrationText": String(repeating: "a", count: 250)] }
      ],
    ],
  ]
}

@main
struct PlaybackCoordinatorTests {
  static func main() throws {
    try readOnlySelectionDoesNotSynthesize()
    try pausedSelectionGeneratesOnlyTheActiveUnit()
    try pauseKeepsCompletedAudioWithoutScheduling()
    try seekPrioritizesDestination()
    try restoreOnlyOnConfigure()
    try failureAndExplicitRetry()
    try staleArticleResultDoesNotMovePlayer()
    orderedPositionWritesCaptureAuthorization()
    print("8 native playback behavior tests passed")
  }

  private static func readOnlySelectionDoesNotSynthesize() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(canGenerate: false), cookies: [])
    player.seek(4)
    precondition(api.requests.isEmpty && audio.loads.isEmpty)
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
  }

  private static func pausedSelectionGeneratesOnlyTheActiveUnit() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(), cookies: [])
    precondition(api.requests.map { $0.1 } == [0])
    player.seek(4)
    precondition(api.requests.map { $0.1 } == [0, 4])
    api.complete(0)
    api.complete(1)
    precondition(audio.loads.isEmpty && player.snapshot()["isPlaying"] as? Bool == false)
    player.play()
    precondition(api.requests.map { $0.1 } == [0, 4, 5, 6])
    precondition(audio.loads.first?.0.lastPathComponent == "4")
  }

  private static func pauseKeepsCompletedAudioWithoutScheduling() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(), cookies: [])
    player.play()
    precondition(api.requests.map { $0.1 } == [0, 1, 2])
    player.pause()
    api.complete(0)
    precondition(api.requests.count == 3 && audio.loads.isEmpty)
    player.play()
    precondition(audio.loads.count == 1 && api.requests.map { $0.1 } == [0, 1, 2])
    audio.onTick?()
    precondition(api.requests.map { $0.1 } == [0, 1, 2])
    player.pause()
    api.complete(2)
    api.complete(1)
    precondition(api.requests.map { $0.1 } == [0, 1, 2])  // In-flight units finish without extending speech synthesis lookahead.
    player.play()
    precondition(api.requests.map { $0.1 } == [0, 1, 2])  // 60s of audio ends speech synthesis lookahead.
  }

  private static func seekPrioritizesDestination() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(), cookies: [])
    player.play()
    player.seek(4)
    precondition(api.requests.map { $0.1 } == [0, 1, 2, 4, 5, 6])
    api.complete(0)
    precondition(audio.loads.isEmpty)
    api.complete(3)
    precondition(audio.loads.first?.0.lastPathComponent == "4")
    precondition(api.requests.map { $0.1 } == [0, 1, 2, 4, 5, 6])
    player.pause()
    player.seek(2)
    precondition(api.requests.count == 6 && positions.saved.last?.0 == "unit-2")
  }

  private static func restoreOnlyOnConfigure() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    positions.position = ["synchronizationUnitId": "unit-2", "offsetMilliseconds": 1500.0]
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(), cookies: [])
    precondition(
      player.snapshot()["currentUnitIndex"] as? Int == 2 && player.snapshot()["isPlaying"] as? Bool == false
    )
    positions.position = ["synchronizationUnitId": "unit-4", "offsetMilliseconds": 0.0]
    player.play()
    api.complete(0)
    precondition(audio.loads.first?.1 == 1500 && positions.restores == 1)
    audio.positionMilliseconds = 2500
    player.pause()
    precondition(positions.saved.last?.0 == "unit-2" && positions.saved.last?.1 == 2500)
  }

  private static func failureAndExplicitRetry() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config(), cookies: [])
    player.play()
    api.requests[0].3(.success(["status": "failed", "explanation": "No allowance"]))
    precondition(
      player.snapshot()["isPlaying"] as? Bool == false
        && player.snapshot()["error"] as? String == "No allowance")
    player.play(retry: true)
    precondition(api.requests.count == 4 && api.requests[3].2)
    api.complete(3)
    precondition(audio.loads.count == 1 && player.snapshot()["error"] is NSNull)
  }

  private static func staleArticleResultDoesNotMovePlayer() throws {
    let api = Api()
    let audio = Audio()
    let positions = Positions()
    let player = NarrationPlaybackCoordinator(audio: audio, api: api, positions: positions)
    try player.configure(config("first"), cookies: [])
    player.play()
    try player.configure(config("second"), cookies: [])
    player.play()
    api.complete(0)
    precondition(audio.loads.isEmpty && api.requests.count == 6)
    api.complete(3)
    precondition(audio.loads.count == 1)
  }

  private static func orderedPositionWritesCaptureAuthorization() {
    let api = Api()
    // Use the actual store with a controllable API to verify serialized saves.
    let store = NarrationPositionStore(api: api)
    api.authorize("first-session")
    store.save(conversionId: "article", unitId: "unit-0", offset: 1000, isSignedIn: true)
    store.save(conversionId: "article", unitId: "unit-1", offset: 2000, isSignedIn: true)
    api.authorize("second-session")
    precondition(api.writes.count == 1)
    api.writes[0].3(.success([:]))
    precondition(api.writes.count == 2 && api.writes[1].2["Authorization"] == "first-session")
    precondition(api.writes[1].1["synchronizationUnitId"] as? String == "unit-1")
    api.writes[1].3(.success([:]))
  }
}

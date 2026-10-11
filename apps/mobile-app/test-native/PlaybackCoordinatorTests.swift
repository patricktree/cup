import Foundation

private final class Audio: NarrationAudioOutput {
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
  var positionMilliseconds: Double?
  var loads: [(URL, Double)] = []
  var enqueued: [URL?] = []
  var nowPlaying: (position: Double, duration: Double)?
  func activate() throws {}
  func load(
    _ url: URL, headers: [String: String], offset: Double, completion: @escaping (String?) -> Void
  ) {
    loads.append((url, offset))
    positionMilliseconds = offset
    completion(nil)
  }
  func enqueueNext(_ url: URL?, headers: [String: String]) { enqueued.append(url) }
  func resume() {}
  func pause() {}
  func updateNowPlaying(title: String, position: Double, duration: Double, isPlaying: Bool) {
    nowPlaying = (position, duration)
  }
  func beginBufferingTask() {}
  func endBufferingTask() {}

  /// The queue player continued into the enqueued segment.
  func advance() {
    positionMilliseconds = 0
    onAdvanced?()
  }
}

private final class Api: NarrationApi {
  var headers: [String: String] = [:]
  var writes: [(String, [String: Any], [String: String], (Result<[String: Any], Error>) -> Void)] =
    []
  func configure(token: String?, cookies: [HTTPCookie]) { authorize(token) }
  func authorize(_ token: String?) { headers = token.map { ["Authorization": $0] } ?? [:] }
  func http(
    _ method: String, _ path: String, body: [String: Any]?, headers: [String: String],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    precondition(method == "PUT")
    writes.append((path, body!, headers, completion))
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

/// Four units of 20 seconds each; units listed in `failed` have no audio.
private func config(failed: Set<Int> = []) -> [String: Any] {
  [
    "conversionId": "article", "playerId": "player", "isSignedIn": true,
    "audiobook": [
      "title": "Article", "canGenerate": true,
      "segments": (0..<4).map { sequence -> [String: Any] in
        failed.contains(sequence)
          ? ["sequence": sequence, "status": "failed", "explanation": "Rejected"]
          : [
            "sequence": sequence, "status": "ready", "durationMilliseconds": 20000.0,
            "url": "https://cup-audio.com/audio/\(sequence)",
          ]
      },
      "narrationDocument": [
        "synchronizationUnits": (0..<4).map { ["id": "unit-\($0)", "narrationText": "Text"] }
      ],
    ],
  ]
}

private func createPlayer(
  failed: Set<Int> = [], position: [String: Any]? = nil
) throws -> (NarrationPlaybackCoordinator, Audio, Positions) {
  let audio = Audio()
  let positions = Positions()
  positions.position = position
  let player = NarrationPlaybackCoordinator(audio: audio, api: Api(), positions: positions)
  try player.configure(config(failed: failed), cookies: [])
  return (player, audio, positions)
}

@main
struct PlaybackCoordinatorTests {
  static func main() throws {
    try reportsTheWholeAudiobookTimeline()
    try playEnqueuesTheFollowingSegment()
    try advancingContinuesTheTimelineWithoutReloading()
    try seekingByPositionSelectsSegmentAndOffset()
    try segmentsWithoutAudioAreSkipped()
    try restoreOnlyOnConfigure()
    try endingReturnsToTheStartPaused()
    try failedPreloadIsLoadedAgainAtTheBoundary()
    try seekingToTheEndStaysPlayable()
    try pauseJustBeforeABoundaryKeepsTheTimeline()
    orderedPositionWritesCaptureAuthorization()
    print("11 native playback behavior tests passed")
  }

  private static func reportsTheWholeAudiobookTimeline() throws {
    let (player, audio, _) = try createPlayer()
    precondition(player.snapshot()["durationMilliseconds"] as? Double == 80000)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 0)
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
    precondition(audio.loads.isEmpty && audio.nowPlaying?.duration == 80000)
  }

  private static func playEnqueuesTheFollowingSegment() throws {
    let (player, audio, _) = try createPlayer()
    player.play()
    precondition(audio.loads.map { $0.0.lastPathComponent } == ["0"])
    precondition(audio.enqueued.map { $0?.lastPathComponent } == ["1"])
    precondition(player.snapshot()["isPlaying"] as? Bool == true)
  }

  private static func advancingContinuesTheTimelineWithoutReloading() throws {
    let (player, audio, positions) = try createPlayer()
    player.play()
    audio.advance()
    precondition(audio.loads.count == 1)
    precondition(audio.enqueued.map { $0?.lastPathComponent } == ["1", "2"])
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 1)
    audio.positionMilliseconds = 5000
    audio.onTick?()
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 25000)
    precondition(audio.nowPlaying?.position == 25000)
    player.pause()
    precondition(positions.saved.last?.0 == "unit-1" && positions.saved.last?.1 == 5000)
  }

  private static func seekingByPositionSelectsSegmentAndOffset() throws {
    let (player, audio, positions) = try createPlayer()
    player.seek(toPosition: 47000)
    precondition(audio.loads.isEmpty && player.snapshot()["currentUnitIndex"] as? Int == 2)
    precondition(positions.saved.last?.0 == "unit-2" && positions.saved.last?.1 == 7000)
    player.play()
    precondition(audio.loads.last?.0.lastPathComponent == "2" && audio.loads.last?.1 == 7000)
    // A position chosen in the system media controls uses the same timeline.
    audio.onSeek?(61000)
    precondition(audio.loads.last?.0.lastPathComponent == "3" && audio.loads.last?.1 == 1000)
    precondition(audio.enqueued.last! == nil)
    player.seek(toUnit: 1)
    precondition(audio.loads.last?.0.lastPathComponent == "1" && audio.loads.last?.1 == 0)
  }

  private static func segmentsWithoutAudioAreSkipped() throws {
    let (player, audio, _) = try createPlayer(failed: [1])
    precondition(player.snapshot()["durationMilliseconds"] as? Double == 60000)
    player.play()
    precondition(audio.enqueued.map { $0?.lastPathComponent } == ["2"])
    audio.advance()
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 2)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 20000)
    player.seek(toUnit: 1)
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 2)
  }

  private static func restoreOnlyOnConfigure() throws {
    let (player, audio, positions) = try createPlayer(
      position: ["synchronizationUnitId": "unit-2", "offsetMilliseconds": 1500.0])
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 2)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 41500)
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
    positions.position = ["synchronizationUnitId": "unit-3", "offsetMilliseconds": 0.0]
    player.play()
    precondition(audio.loads.first?.1 == 1500 && positions.restores == 1)
    audio.positionMilliseconds = 2500
    player.pause()
    precondition(positions.saved.last?.0 == "unit-2" && positions.saved.last?.1 == 2500)
  }

  private static func endingReturnsToTheStartPaused() throws {
    let (player, audio, positions) = try createPlayer()
    player.seek(toUnit: 3)
    player.play()
    audio.onEnded?()
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 0)
    precondition(positions.saved.last?.0 == "unit-0" && positions.saved.last?.1 == 0)
  }

  private static func failedPreloadIsLoadedAgainAtTheBoundary() throws {
    let (player, audio, _) = try createPlayer()
    player.play()
    audio.onFollowingFailed?()
    // The adapter dropped the failed segment, so the current one ends with nothing enqueued.
    audio.onEnded?()
    precondition(audio.loads.map { $0.0.lastPathComponent } == ["0", "1"])
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 1)
    precondition(player.snapshot()["isPlaying"] as? Bool == true)
    audio.onFailure?("Network lost")
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
    precondition(player.snapshot()["error"] as? String == "Network lost")
  }

  private static func seekingToTheEndStaysPlayable() throws {
    let (player, audio, _) = try createPlayer()
    player.seek(toPosition: 80000)
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 3)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 79999)
    player.play()
    precondition(audio.loads.last?.0.lastPathComponent == "3" && audio.loads.last?.1 == 19999)
  }

  private static func pauseJustBeforeABoundaryKeepsTheTimeline() throws {
    let (player, audio, _) = try createPlayer()
    player.play()
    audio.positionMilliseconds = 19990
    player.pause()
    // The queue player had already continued into the following segment.
    audio.advance()
    precondition(player.snapshot()["currentUnitIndex"] as? Int == 1)
    precondition(player.snapshot()["positionMilliseconds"] as? Double == 20000)
    precondition(player.snapshot()["isPlaying"] as? Bool == false)
    player.play()
    precondition(audio.loads.count == 1)
    precondition(audio.enqueued.last??.lastPathComponent == "2")
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

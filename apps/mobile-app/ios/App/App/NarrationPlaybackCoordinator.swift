import Foundation

/// Owns passage selection, playback intent, and bounded generation independently of WebKit.
final class NarrationPlaybackCoordinator {
  var playerId = ""
  var publish: (([String: Any]) -> Void)?
  private let audio: NarrationAudioOutput
  private let api: NarrationApi
  private let positions: NarrationPositions
  private var conversionId = ""
  private var title = ""
  private var units: [[String: Any]] = []
  private var segments: [Int: [String: Any]] = [:]
  private var failures: [Int: String] = [:]
  private var canGenerate = false
  private var isSignedIn = false
  private var sequence = 0
  private var sourceSequence = -1
  private var offset = 0.0
  private var isPlaying = false
  private var isBuffering = false
  private var requests: Set<String> = []
  private var error: String?
  private var lastSaved = Date.distantPast

  init(audio: NarrationAudioOutput, api: NarrationApi, positions: NarrationPositions) {
    self.audio = audio
    self.api = api
    self.positions = positions
    audio.onTick = { [weak self] in self?.tick() }
    audio.onEnded = { [weak self] in
      if let self, self.isPlaying { self.seek(self.sequence + 1) }
    }
    audio.onPause = { [weak self] in self?.pause() }
    audio.onPlay = { [weak self] in self?.play() }
    audio.onNext = { [weak self] in if let self { self.seek(self.sequence + 1) } }
    audio.onPrevious = { [weak self] in if let self { self.seek(self.sequence - 1) } }
    positions.onFailure = { [weak self] message in
      self?.error = message
      self?.emit()
    }
  }

  func authorize(_ token: String?) { api.authorize(token) }

  func configure(_ config: [String: Any], cookies: [HTTPCookie]) throws {
    guard let id = config["conversionId"] as? String,
      let audiobook = config["audiobook"] as? [String: Any],
      let document = audiobook["narrationDocument"] as? [String: Any],
      let preparedUnits = document["synchronizationUnits"] as? [[String: Any]],
      !preparedUnits.isEmpty,
      let preparedTitle = audiobook["title"] as? String
    else { throw failure("Prepared narration is invalid.") }
    pause()
    playerId = config["playerId"] as? String ?? ""
    conversionId = id
    units = preparedUnits
    title = preparedTitle
    canGenerate = audiobook["canGenerate"] as? Bool ?? false
    segments.removeAll()
    failures.removeAll()
    isSignedIn = config["isSignedIn"] as? Bool ?? false
    api.configure(token: config["token"] as? String, cookies: cookies)
    let position = positions.restore(config, conversionId: id, isSignedIn: isSignedIn)
    sequence =
      units.firstIndex { ($0["id"] as? String) == (position?["synchronizationUnitId"] as? String) }
      ?? 0
    offset = position?["offsetMilliseconds"] as? Double ?? 0
    sourceSequence = -1
    for segment in audiobook["segments"] as? [[String: Any]] ?? [] {
      if segment["status"] as? String == "ready", let index = segment["sequence"] as? Int {
        segments[index] = segment
      }
    }
    error = nil
    emit()
    requestActiveSegment()
  }

  func snapshot() -> [String: Any] {
    [
      "sequence": sequence, "isPlaying": isPlaying, "isBuffering": isBuffering,
      "error": error as Any? ?? NSNull(),
    ]
  }
  private func emit() {
    publish?(snapshot())
    audio.updateNowPlaying(title: title, offset: offset, isPlaying: isPlaying && !isBuffering)
  }
  func play(retry: Bool = false) {
    guard !units.isEmpty else { return }
    do {
      try audio.activate()
    } catch {
      stop(error.localizedDescription)
      return
    }
    if retry {
      sourceSequence = -1
      failures.removeValue(forKey: sequence)
      segments.removeValue(forKey: sequence)
    }
    isPlaying = true
    isBuffering = true
    error = nil
    audio.beginBufferingTask()
    emit()
    advance(retry: retry)
  }
  func pause() {
    if sourceSequence == sequence && !isBuffering, let position = audio.positionMilliseconds {
      offset = position
    }
    if isBuffering { sourceSequence = -1 }
    isPlaying = false
    isBuffering = false
    audio.pause()
    save()
    audio.endBufferingTask()
    emit()
  }
  func seek(_ target: Int) {
    guard target >= 0 else { return }
    if target >= units.count {
      sourceSequence = -1
      sequence = 0
      offset = 0
      pause()
      return
    }
    audio.pause()
    sourceSequence = -1
    sequence = target
    error = nil
    offset = 0
    isBuffering = isPlaying
    save()
    emit()
    if isPlaying { advance() } else { requestActiveSegment() }
  }
  private func advance(retry: Bool = false) {
    guard isPlaying else { return }
    audio.beginBufferingTask()
    guard let segment = segments[sequence], let urlString = segment["url"] as? String,
      let url = URL(string: urlString)
    else {
      if let message = failures[sequence], !retry {
        stop(message)
        return
      }
      request(sequence, retry: retry)
      requestAudioAhead()
      return
    }
    if sourceSequence != sequence {
      sourceSequence = sequence
      audio.load(url, headers: api.headers, offset: offset) { [weak self] message in
        guard let self else { return }
        if let message {
          self.stop(message)
          return
        }
        self.didStartAudio()
      }
    } else {
      audio.resume()
      didStartAudio()
    }
  }

  private func didStartAudio() {
    audio.endBufferingTask()
    isBuffering = false
    emit()
    requestAudioAhead()
  }
  private func requestActiveSegment() {
    guard canGenerate else { return }
    if let message = failures[sequence] {
      error = message
      emit()
      return
    }
    guard segments[sequence] == nil else { return }
    request(sequence)
  }

  private func requestAudioAhead() {
    guard isPlaying && canGenerate else { return }
    var duration = -offset
    for index in sequence..<units.count {
      if duration >= 60000 { return }
      let segment = segments[index]
      duration +=
        segment?["durationMilliseconds"] as? Double
        ?? max(1000, Double((units[index]["narrationText"] as? String ?? "").count) * 80)
      if failures[index] != nil { return }
      if segment == nil { request(index) }
    }
  }
  private func request(_ target: Int, retry: Bool = false) {
    let id = conversionId
    let requestId = "\(id):\(target)"
    guard requests.insert(requestId).inserted else { return }
    api.requestSegment(id, sequence: target, retry: retry) { [weak self] result in
      guard let self else { return }
      self.requests.remove(requestId)
      guard id == self.conversionId else {
        if self.isPlaying { self.advance() }
        return
      }
      switch result {
      case .success(let segment):
        if segment["status"] as? String == "ready" {
          self.segments[target] = segment
        } else {
          self.failures[target] =
            segment["explanation"] as? String ?? "Speech generation failed. Retry this passage."
        }
      case .failure(let failure): self.failures[target] = failure.localizedDescription
      }
      if self.isPlaying && target == self.sequence {
        self.advance()
      } else {
        if target == self.sequence, let message = self.failures[target] {
          self.error = message
          self.emit()
        }
        self.requestAudioAhead()
      }
    }
  }

  private func tick() {
    guard isPlaying else { return }
    if sourceSequence == sequence, let position = audio.positionMilliseconds { offset = position }
    if Date().timeIntervalSince(lastSaved) >= 5 { save() }
    requestAudioAhead()
    emit()
  }

  private func save() {
    guard !units.isEmpty else { return }
    lastSaved = Date()
    positions.save(
      conversionId: conversionId, unitId: units[sequence]["id"] as! String,
      offset: offset, isSignedIn: isSignedIn)
  }
  private func stop(_ message: String) {
    pause()
    error = message
    emit()
  }
  private func failure(_ message: String) -> Error {
    NSError(domain: "CupNarration", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

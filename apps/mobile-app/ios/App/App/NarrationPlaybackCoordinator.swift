import Foundation

/// Owns segment selection, playback intent, and bounded generation independently of WebKit.
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
  private var currentUnitIndex = 0
  private var sourceUnitIndex = -1
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
      if let self, self.isPlaying { self.seek(self.currentUnitIndex + 1) }
    }
    audio.onPause = { [weak self] in self?.pause() }
    audio.onPlay = { [weak self] in self?.play() }
    audio.onNext = { [weak self] in if let self { self.seek(self.currentUnitIndex + 1) } }
    audio.onPrevious = { [weak self] in if let self { self.seek(self.currentUnitIndex - 1) } }
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
    currentUnitIndex =
      units.firstIndex { ($0["id"] as? String) == (position?["synchronizationUnitId"] as? String) }
      ?? 0
    offset = position?["offsetMilliseconds"] as? Double ?? 0
    sourceUnitIndex = -1
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
      "currentUnitIndex": currentUnitIndex, "isPlaying": isPlaying, "isBuffering": isBuffering,
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
      sourceUnitIndex = -1
      failures.removeValue(forKey: currentUnitIndex)
      segments.removeValue(forKey: currentUnitIndex)
    }
    isPlaying = true
    isBuffering = true
    error = nil
    audio.beginBufferingTask()
    emit()
    advance(retry: retry)
  }
  func pause() {
    if sourceUnitIndex == currentUnitIndex && !isBuffering, let position = audio.positionMilliseconds {
      offset = position
    }
    if isBuffering { sourceUnitIndex = -1 }
    isPlaying = false
    isBuffering = false
    audio.pause()
    save()
    audio.endBufferingTask()
    emit()
  }
  func seek(_ unitIndex: Int) {
    guard unitIndex >= 0 else { return }
    if unitIndex >= units.count {
      sourceUnitIndex = -1
      currentUnitIndex = 0
      offset = 0
      pause()
      return
    }
    audio.pause()
    sourceUnitIndex = -1
    currentUnitIndex = unitIndex
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
    guard let segment = segments[currentUnitIndex], let urlString = segment["url"] as? String,
      let url = URL(string: urlString)
    else {
      if let message = failures[currentUnitIndex], !retry {
        stop(message)
        return
      }
      request(currentUnitIndex, retry: retry)
      requestAudioAhead()
      return
    }
    if sourceUnitIndex != currentUnitIndex {
      sourceUnitIndex = currentUnitIndex
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
    if let message = failures[currentUnitIndex] {
      error = message
      emit()
      return
    }
    guard segments[currentUnitIndex] == nil else { return }
    request(currentUnitIndex)
  }

  private func requestAudioAhead() {
    guard isPlaying && canGenerate else { return }
    var duration = -offset
    for index in currentUnitIndex..<units.count {
      if duration >= 60000 { return }
      let segment = segments[index]
      duration +=
        segment?["durationMilliseconds"] as? Double
        ?? max(1000, Double((units[index]["narrationText"] as? String ?? "").count) * 80)
      if failures[index] != nil { return }
      if segment == nil { request(index) }
    }
  }
  private func request(_ unitIndex: Int, retry: Bool = false) {
    let id = conversionId
    let requestId = "\(id):\(unitIndex)"
    guard requests.insert(requestId).inserted else { return }
    api.requestSegment(id, sequence: unitIndex, retry: retry) { [weak self] result in
      guard let self else { return }
      self.requests.remove(requestId)
      guard id == self.conversionId else {
        if self.isPlaying { self.advance() }
        return
      }
      switch result {
      case .success(let segment):
        if segment["status"] as? String == "ready" {
          self.segments[unitIndex] = segment
        } else {
          self.failures[unitIndex] =
            segment["explanation"] as? String ?? "Speech generation failed. Retry this segment."
        }
      case .failure(let failure): self.failures[unitIndex] = failure.localizedDescription
      }
      if self.isPlaying && unitIndex == self.currentUnitIndex {
        self.advance()
      } else {
        if unitIndex == self.currentUnitIndex, let message = self.failures[unitIndex] {
          self.error = message
          self.emit()
        }
        self.requestAudioAhead()
      }
    }
  }

  private func tick() {
    guard isPlaying else { return }
    if sourceUnitIndex == currentUnitIndex, let position = audio.positionMilliseconds { offset = position }
    if Date().timeIntervalSince(lastSaved) >= 5 { save() }
    requestAudioAhead()
    emit()
  }

  private func save() {
    guard !units.isEmpty else { return }
    lastSaved = Date()
    positions.save(
      conversionId: conversionId, unitId: units[currentUnitIndex]["id"] as! String,
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

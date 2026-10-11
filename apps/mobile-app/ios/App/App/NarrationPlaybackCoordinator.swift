import Foundation

/// Owns playback intent and the whole-audiobook timeline independently of WebKit.
///
/// Every segment has audio or a final failure before playback starts, so the timeline is exact.
/// Segments without audio are skipped and take no time. See ADR 0008.
final class NarrationPlaybackCoordinator {
  /// One audio segment's interval on the whole-audiobook timeline.
  private struct Entry {
    let unitIndex: Int
    let unitId: String
    let start: Double
    let duration: Double
    let url: URL
  }

  var playerId = ""
  var publish: (([String: Any]) -> Void)?
  private let audio: NarrationAudioOutput
  private let api: NarrationApi
  private let positions: NarrationPositions
  private var conversionId = ""
  private var title = ""
  private var entries: [Entry] = []
  private var totalDuration = 0.0
  private var isSignedIn = false
  private var entryIndex = 0
  private var sourceEntryIndex = -1
  // The following segment failed to preload and must be loaded again when playback reaches it.
  private var shouldReloadFollowingEntry = false
  private var offset = 0.0
  private var isPlaying = false
  private var isBuffering = false
  private var error: String?
  private var lastSaved = Date.distantPast

  init(audio: NarrationAudioOutput, api: NarrationApi, positions: NarrationPositions) {
    self.audio = audio
    self.api = api
    self.positions = positions
    audio.onTick = { [weak self] in self?.tick() }
    audio.onAdvanced = { [weak self] in self?.didAdvance() }
    audio.onEnded = { [weak self] in self?.didEnd() }
    audio.onFollowingFailed = { [weak self] in self?.shouldReloadFollowingEntry = true }
    audio.onFailure = { [weak self] message in self?.stop(message) }
    audio.onPause = { [weak self] in self?.pause() }
    audio.onPlay = { [weak self] in self?.play() }
    audio.onNext = { [weak self] in if let self { self.move(to: self.entryIndex + 1, offset: 0) } }
    audio.onPrevious = { [weak self] in
      if let self { self.move(to: self.entryIndex - 1, offset: 0) }
    }
    audio.onSeek = { [weak self] position in self?.seek(toPosition: position) }
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
      let units = document["synchronizationUnits"] as? [[String: Any]],
      !units.isEmpty,
      let preparedTitle = audiobook["title"] as? String
    else { throw failure("Prepared narration is invalid.") }
    pause()
    playerId = config["playerId"] as? String ?? ""
    conversionId = id
    title = preparedTitle
    isSignedIn = config["isSignedIn"] as? Bool ?? false
    api.configure(token: config["token"] as? String, cookies: cookies)

    entries.removeAll()
    totalDuration = 0
    let segments = (audiobook["segments"] as? [[String: Any]] ?? []).sorted {
      ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0)
    }
    for segment in segments where segment["status"] as? String == "ready" {
      guard let unitIndex = segment["sequence"] as? Int, units.indices.contains(unitIndex),
        let unitId = units[unitIndex]["id"] as? String,
        let duration = segment["durationMilliseconds"] as? Double,
        let urlString = segment["url"] as? String, let url = URL(string: urlString)
      else { throw failure("Prepared narration is invalid.") }
      entries.append(
        Entry(
          unitIndex: unitIndex, unitId: unitId, start: totalDuration, duration: duration, url: url))
      totalDuration += duration
    }

    let position = positions.restore(config, conversionId: id, isSignedIn: isSignedIn)
    let restoredUnitIndex =
      units.firstIndex { ($0["id"] as? String) == (position?["synchronizationUnitId"] as? String) }
      ?? 0
    entryIndex = entries.firstIndex { $0.unitIndex >= restoredUnitIndex } ?? 0
    // A skipped unit resumes at the start of the next one with audio.
    offset =
      entries.indices.contains(entryIndex) && entries[entryIndex].unitIndex == restoredUnitIndex
      ? position?["offsetMilliseconds"] as? Double ?? 0 : 0
    sourceEntryIndex = -1
    error = nil
    emit()
  }

  func snapshot() -> [String: Any] {
    let entry = entries.indices.contains(entryIndex) ? entries[entryIndex] : nil
    return [
      "currentUnitIndex": entry?.unitIndex ?? 0,
      "positionMilliseconds": (entry?.start ?? 0) + offset,
      "durationMilliseconds": totalDuration,
      "isPlaying": isPlaying, "isBuffering": isBuffering,
      "error": error as Any? ?? NSNull(),
    ]
  }

  func play() {
    guard !entries.isEmpty else { return }
    do {
      try audio.activate()
    } catch {
      stop(error.localizedDescription)
      return
    }
    isPlaying = true
    error = nil
    start()
  }

  func pause() {
    if sourceEntryIndex == entryIndex && !isBuffering, let position = audio.positionMilliseconds {
      offset = position
    }
    if isBuffering { sourceEntryIndex = -1 }
    isPlaying = false
    isBuffering = false
    audio.pause()
    save()
    audio.endBufferingTask()
    emit()
  }

  /// Seeks to the start of a unit, or of the next unit with audio when it was skipped.
  func seek(toUnit unitIndex: Int) {
    guard let index = entries.firstIndex(where: { $0.unitIndex >= unitIndex }) else { return }
    move(to: index, offset: 0)
  }

  /// Seeks to a position on the whole-audiobook timeline.
  func seek(toPosition position: Double) {
    guard !entries.isEmpty else { return }
    // Stop just short of the end so the destination is always a playable position.
    let clamped = min(max(0, position), max(0, totalDuration - 1))
    let index = entries.lastIndex { $0.start <= clamped } ?? 0
    move(to: index, offset: min(clamped - entries[index].start, entries[index].duration))
  }

  private func move(to index: Int, offset newOffset: Double) {
    guard entries.indices.contains(index) else { return }
    audio.pause()
    sourceEntryIndex = -1
    entryIndex = index
    offset = newOffset
    error = nil
    save()
    if isPlaying { start() } else { emit() }
  }

  private func start() {
    isBuffering = true
    audio.beginBufferingTask()
    emit()
    if sourceEntryIndex == entryIndex {
      audio.resume()
      didStartAudio()
      return
    }
    sourceEntryIndex = entryIndex
    shouldReloadFollowingEntry = false
    audio.load(entries[entryIndex].url, headers: api.headers, offset: offset) { [weak self] message in
      guard let self else { return }
      if let message {
        self.stop(message)
        return
      }
      self.didStartAudio()
    }
    enqueueFollowingEntry()
  }

  private func didStartAudio() {
    audio.endBufferingTask()
    isBuffering = false
    emit()
  }

  /// Hands the player the following segment ahead of the boundary so no loading pause occurs.
  private func enqueueFollowingEntry() {
    let following = entryIndex + 1
    audio.enqueueNext(
      entries.indices.contains(following) ? entries[following].url : nil, headers: api.headers)
  }

  private func didAdvance() {
    // Also applies while paused: a pause can land just before the boundary, after which the
    // player already holds the following segment.
    guard entries.indices.contains(entryIndex + 1) else { return }
    entryIndex += 1
    sourceEntryIndex = entryIndex
    offset = 0
    save()
    enqueueFollowingEntry()
    emit()
  }

  private func didEnd() {
    guard isPlaying else { return }
    if shouldReloadFollowingEntry, entries.indices.contains(entryIndex + 1) {
      entryIndex += 1
      offset = 0
      sourceEntryIndex = -1
      save()
      start()
      return
    }
    sourceEntryIndex = -1
    entryIndex = 0
    offset = 0
    pause()
  }

  private func tick() {
    guard isPlaying else { return }
    if sourceEntryIndex == entryIndex, !isBuffering, let position = audio.positionMilliseconds {
      offset = position
    }
    if Date().timeIntervalSince(lastSaved) >= 5 { save() }
    emit()
  }

  private func emit() {
    let state = snapshot()
    publish?(state)
    audio.updateNowPlaying(
      title: title, position: state["positionMilliseconds"] as? Double ?? 0,
      duration: totalDuration, isPlaying: isPlaying && !isBuffering)
  }

  private func save() {
    guard entries.indices.contains(entryIndex) else { return }
    lastSaved = Date()
    positions.save(
      conversionId: conversionId, unitId: entries[entryIndex].unitId, offset: offset,
      isSignedIn: isSignedIn)
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

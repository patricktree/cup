import Foundation

/// Anonymous listening positions stay local; account writes drain in arrival order.
final class NarrationPositionStore: NarrationPositions {
  var onFailure: ((String) -> Void)?
  private let api: NarrationApi
  private var saves: [(String, [String: Any], [String: String])] = []
  private var isSaving = false

  init(api: NarrationApi) { self.api = api }

  func restore(_ config: [String: Any], conversionId: String, isSignedIn: Bool) -> [String: Any]? {
    if !isSignedIn,
      let stored = UserDefaults.standard.dictionary(forKey: "cup:position:\(conversionId)")
    {
      return stored
    }
    return config["position"] as? [String: Any]
  }

  func save(conversionId: String, unitId: String, offset: Double, isSignedIn: Bool) {
    let position: [String: Any] = ["synchronizationUnitId": unitId, "offsetMilliseconds": offset]
    if !isSignedIn {
      UserDefaults.standard.set(position, forKey: "cup:position:\(conversionId)")
      return
    }
    saves.append((conversionId, position, api.headers))
    drainSaves()
  }

  private func drainSaves() {
    guard !isSaving, let (id, position, auth) = saves.first else { return }
    isSaving = true
    api.http("PUT", "/api/audiobooks/\(id)/position", body: position, headers: auth) { result in
      self.saves.removeFirst()
      self.isSaving = false
      if case .failure(let failure) = result {
        self.onFailure?("Listening position could not be saved: \(failure.localizedDescription)")
      }
      self.drainSaves()
    }
  }
}

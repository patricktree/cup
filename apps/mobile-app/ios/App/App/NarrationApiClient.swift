import Foundation

/// Captures authorization per request so an old article cannot inherit a later session.
final class NarrationApiClient: NarrationApi {
  private let session = URLSession(configuration: .default)
  private let origin = "https://cup-audio.com"
  private(set) var headers: [String: String] = [:]

  func configure(token: String?, cookies: [HTTPCookie]) {
    headers = ["Content-Type": "application/json", "X-Create-Audiobook-From-URL-Request": "1"]
    authorize(token)
    let apiURL = URL(string: origin + "/api")!
    let matching = cookies.filter {
      apiURL.host?.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
        == true
        && apiURL.path.hasPrefix($0.path)
    }
    for (name, value) in HTTPCookie.requestHeaderFields(with: matching) { headers[name] = value }
  }

  func authorize(_ token: String?) {
    if let token {
      headers["Authorization"] = "Bearer \(token)"
    } else {
      headers.removeValue(forKey: "Authorization")
    }
  }

  func requestSegment(
    _ id: String, sequence: Int, retry: Bool,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    let auth = headers
    let path = "/api/audiobooks/\(id)/segments/\(sequence)"
    func receive(_ result: Result<[String: Any], Error>) {
      if case .success(let segment) = result, segment["status"] as? String == "generating" {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
          self.http("GET", path, headers: auth, completion: receive)
        }
      } else {
        completion(result)
      }
    }
    http("POST", path, body: ["retry": retry], headers: auth, completion: receive)
  }

  func http(
    _ method: String, _ path: String, body: [String: Any]? = nil, headers: [String: String],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    let receive = completion
    let completion: (Result<[String: Any], Error>) -> Void = { result in
      DispatchQueue.main.async { receive(result) }
    }
    var request = URLRequest(url: URL(string: origin + path)!)
    request.httpMethod = method
    request.allHTTPHeaderFields = headers
    do { if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) } } catch
    {
      completion(.failure(error))
      return
    }
    session.dataTask(with: request) { data, response, error in
      if let error {
        completion(.failure(error))
        return
      }
      guard let response = response as? HTTPURLResponse else {
        completion(.failure(self.failure("Server response missing.")))
        return
      }
      if response.statusCode == 204 {
        completion(.success([:]))
        return
      }
      do {
        guard let data, let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw self.failure("Server response invalid.") }
        if response.statusCode >= 400 {
          throw self.failure(
            (result["error"] as? [String: Any])?["message"] as? String ?? "The request failed.")
        }
        completion(.success(result))
      } catch { completion(.failure(error)) }
    }.resume()
  }

  private func failure(_ message: String) -> Error {
    NSError(domain: "CupNarration", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

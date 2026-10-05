import Capacitor
import WebKit

class CupBridgeViewController: CAPBridgeViewController {
  override func capacitorDidLoad() {
    bridge?.registerPluginInstance(NarrationPlayerPlugin())
  }
}

@objc(NarrationPlayerPlugin)
class NarrationPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
  let identifier = "NarrationPlayerPlugin"
  let jsName = "NarrationPlayer"
  let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
  ]
  private let engine: NarrationPlaybackCoordinator = {
    let api = NarrationApiClient()
    return NarrationPlaybackCoordinator(
      audio: NarrationAudioAdapter(), api: api, positions: NarrationPositionStore(api: api))
  }()

  @objc func configure(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.engine.publish = { [weak self] state in self?.notifyListeners("state", data: state) }
      self.webView?.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
        do {
          let nativeCookies = HTTPCookieStorage.shared.cookies ?? []
          try self.engine.configure(
            call.options as? [String: Any] ?? [:], cookies: nativeCookies + cookies)
          call.resolve(self.engine.snapshot())
        } catch { call.reject(error.localizedDescription) }
      }
    }
  }

  @objc func command(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      if let playerId = call.getString("playerId"), playerId != self.engine.playerId {
        call.resolve()
        return
      }
      if call.options["token"] != nil { self.engine.authorize(call.getString("token")) }
      switch call.getString("action") {
      case "play": self.engine.play()
      case "retry": self.engine.play(retry: true)
      case "seek": self.engine.seek(call.getInt("sequence") ?? 0)
      default: self.engine.pause()
      }
      call.resolve()
    }
  }
}

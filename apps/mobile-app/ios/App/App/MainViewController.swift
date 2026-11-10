import Capacitor
import UIKit
import WebKit

/// Cup's only view controller: Capacitor's bridge with the app's own plugins.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // The app's own plugins are not npm packages, so Capacitor does not find them by itself.
        bridge?.registerPluginInstance(WebAuthenticationPlugin())
        #if DEBUG
        applyTestApiOrigin()
        #endif
    }

    #if DEBUG
    /// Points the web app at the test Worker: before the page loads, sets the global that
    /// `apiOrigin()` reads. ATS's built-in exemption for `localhost` allows the plain HTTP. Capacitor
    /// replaces the configuration's content controller while preparing the WebView, so the script is
    /// added here, after the bridge exists and before `viewDidLoad` loads the page.
    private func applyTestApiOrigin() {
        // Stops the app on a malformed origin, before it can reach production.
        guard let origin = TestApiOrigin.fromDefaults(UserDefaults.standard) else {
            return
        }
        guard let contentController = webView?.configuration.userContentController else {
            fatalError("Capacitor created no WebView to apply the test API origin to.")
        }
        // The origin is validated to contain no characters that need escaping in a string literal.
        contentController.addUserScript(WKUserScript(
            source: "window.cupTestApiOrigin = \"\(origin)\";",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }
    #endif
}

#if DEBUG
/// Debug builds only: the test Worker origin the mobile E2E suite sets as the defaults key
/// `cupTestApiOrigin`. The process arguments `-cupTestApiOrigin <origin>` set it for one launch,
/// through the defaults' arguments domain. A launch without arguments, such as one a shared URL
/// starts, reads the value the suite wrote into Cup's own defaults with
/// `xcrun simctl spawn <simulator> defaults write audio.cup.app cupTestApiOrigin <origin>`.
enum TestApiOrigin {
    static let key = "cupTestApiOrigin"

    /// Returns the origin, or nil when the defaults hold none. Stops the app when the value is
    /// anything but `http://localhost:<port>`.
    static func fromDefaults(_ defaults: UserDefaults) -> String? {
        guard let stored = defaults.object(forKey: key) else {
            return nil
        }
        guard let value = stored as? String, isLocalhostOrigin(value) else {
            fatalError("The \(key) default must be exactly http://localhost:<port>, got \"\(stored)\".")
        }
        return value
    }

    private static func isLocalhostOrigin(_ value: String) -> Bool {
        let prefix = "http://localhost:"
        guard value.hasPrefix(prefix) else {
            return false
        }
        let port = value.dropFirst(prefix.count)
        guard (1...5).contains(port.count),
              port.first != "0",
              port.allSatisfy({ ("0"..."9").contains($0) }),
              let number = Int(port) else {
            return false
        }
        return number <= 65535
    }
}
#endif

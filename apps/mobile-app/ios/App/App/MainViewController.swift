import Capacitor
import UIKit
import WebKit

/// Cup's only view controller. Release builds use Capacitor's bridge unchanged.
class MainViewController: CAPBridgeViewController {
    #if DEBUG
    /// Points the web app at the test Worker: before the page loads, sets the global that
    /// `apiOrigin()` reads. ATS's built-in exemption for `localhost` allows the plain HTTP. Capacitor
    /// replaces the configuration's content controller while preparing the WebView, so the script is
    /// added here, after the bridge exists and before `viewDidLoad` loads the page.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Stops the app on a malformed argument, before it can reach production.
        guard let origin = TestApiOrigin.fromArguments(ProcessInfo.processInfo.arguments) else {
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
/// Debug builds only: the test Worker origin the mobile E2E suite passes as the process arguments
/// `-cupTestApiOrigin <origin>`.
enum TestApiOrigin {
    static let argument = "-cupTestApiOrigin"

    /// Returns the origin, or nil when the launch carries none. Stops the app when the value is
    /// anything but `http://localhost:<port>`.
    static func fromArguments(_ arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: argument) else {
            return nil
        }
        let value = arguments.indices.contains(index + 1) ? arguments[index + 1] : ""
        guard isLocalhostOrigin(value) else {
            fatalError("The \(argument) launch argument must be exactly http://localhost:<port>, got \"\(value)\".")
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

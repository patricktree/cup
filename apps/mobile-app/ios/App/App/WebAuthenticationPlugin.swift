import AuthenticationServices
import Capacitor
import UIKit

/// Runs a browser sign-in in an `ASWebAuthenticationSession`: a system browser sheet over Cup that
/// shares Safari's cookies and hands the URL the sign-in ends at back to Cup, instead of opening it
/// in the WebView, where Google refuses sign-in, or in Safari, which cannot return to
/// `capacitor://localhost`. The web app's iOS sign-in adapter calls `authenticate`.
@objc(WebAuthenticationPlugin)
public class WebAuthenticationPlugin: CAPPlugin, CAPBridgedPlugin,
    ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthenticationPlugin"
    public let jsName = "WebAuthentication"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    /// The scheme of the callback URL the session ends at, Cup's own; see the web app's
    /// `IOS_AUTH_CALLBACK_URL`.
    private static let callbackScheme = "audio.cup.app"

    /// The running session; the session ends when nothing holds it.
    private var session: ASWebAuthenticationSession?

    /// Opens the `url` option and resolves with `{ url }`, the callback URL. Rejects with the code
    /// `CANCELED` when the listener closes the sheet.
    @objc func authenticate(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value),
              Self.isAllowedSignInUrl(url) else {
            call.reject("The sign-in URL is not one Cup opens.", "INVALID_URL")
            return
        }
        DispatchQueue.main.async {
            guard self.session == nil else {
                call.reject("Another sign-in is in progress.", "IN_PROGRESS")
                return
            }
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: Self.callbackScheme
            ) { [weak self] callbackUrl, error in
                self?.session = nil
                if let callbackUrl {
                    call.resolve(["url": callbackUrl.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError,
                          error.code == .canceledLogin {
                    call.reject("Sign-in was cancelled.", "CANCELED")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed.", "FAILED", error)
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Sign-in could not start.", "FAILED")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    /// HTTPS only, except that a debug build also signs in at the mobile E2E suite's fake auth
    /// provider on `http://localhost`.
    private static func isAllowedSignInUrl(_ url: URL) -> Bool {
        if url.scheme == "https" {
            return true
        }
        #if DEBUG
        return url.scheme == "http" && url.host == "localhost"
        #else
        return false
        #endif
    }
}

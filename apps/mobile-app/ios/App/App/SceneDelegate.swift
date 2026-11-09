import Capacitor
import UIKit

/// Cup's only window scene. UIKit creates its window and `MainViewController` from `Main.storyboard`,
/// named in `Info.plist`'s scene manifest. Incoming URLs, such as the Share Extension's
/// `audio.cup.app://share` links, arrive here and reach Capacitor's App plugin through its proxy,
/// which delivers a cold start's URL once the bridge has loaded its plugins.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

import UIKit

/// Adds a blurring overlay to every UIWindowScene when the app transitions
/// to an inactive/background state — preventing the OS screenshot thumbnail
/// and App Switcher preview from exposing sensitive content.
///
/// Automatically tracks all scenes added after initialization via
/// UIScene.willConnectNotification so new scenes in multi-window apps
/// receive the same protection.
@MainActor
public final class SceneAwareScreenProtector {

    private var observers: [NSObjectProtocol] = []
    private var overlays: [ObjectIdentifier: UIView] = [:]

    public init() {}

    public func start() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.willResignActiveNotification,
                                        object: nil, queue: .main) { [weak self] _ in
            self?.addOverlaysToAllScenes()
        })
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                        object: nil, queue: .main) { [weak self] _ in
            self?.removeAllOverlays()
        })
        observers.append(nc.addObserver(forName: UIScene.willConnectNotification,
                                        object: nil, queue: .main) { [weak self] _ in
            // New scene connected while app was already in background
            self?.addOverlaysToAllScenes()
        })
    }

    public func stop() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        removeAllOverlays()
    }

    private func addOverlaysToAllScenes() {
        guard let scenes = UIApplication.shared.connectedScenes as? Set<UIWindowScene> else { return }
        for scene in scenes {
            for window in scene.windows where window.isKeyWindow || scene.windows.count == 1 {
                addOverlay(to: window)
            }
        }
    }

    private func addOverlay(to window: UIWindow) {
        let key = ObjectIdentifier(window)
        guard overlays[key] == nil else { return }

        let blur = UIBlurEffect(style: .systemMaterial)
        let overlay = UIVisualEffectView(effect: blur)
        overlay.frame = window.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.tag = 0xBABE_CAFE
        window.addSubview(overlay)
        overlays[key] = overlay
    }

    private func removeAllOverlays() {
        for overlay in overlays.values {
            overlay.removeFromSuperview()
        }
        overlays.removeAll()
    }
}

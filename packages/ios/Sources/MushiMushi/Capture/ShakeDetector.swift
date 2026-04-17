#if os(iOS)
import UIKit

/// Method-swizzles `UIWindow.motionEnded` so we can intercept shake gestures
/// without forcing the host app to subclass UIWindow. Idempotent — calling
/// `install` multiple times is a no-op after the first.
enum ShakeDetector {
    private static var installed = false
    static var onShake: (() -> Void)?

    static func install() {
        guard !installed else { return }
        installed = true

        let original = #selector(UIWindow.motionEnded(_:with:))
        let swizzled = #selector(UIWindow.mushi_motionEnded(_:with:))

        guard let cls = UIWindow.self as AnyClass? else { return }
        if let originalMethod = class_getInstanceMethod(cls, original),
           let swizzledMethod = class_getInstanceMethod(cls, swizzled) {
            method_exchangeImplementations(originalMethod, swizzledMethod)
        }
    }
}

private extension UIWindow {
    @objc func mushi_motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        // Call back into the original (now swizzled) implementation.
        self.mushi_motionEnded(motion, with: event)
        if motion == .motionShake {
            ShakeDetector.onShake?()
        }
    }
}
#endif

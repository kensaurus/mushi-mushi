#if os(iOS)
import UIKit
import QuartzCore

/// Proactive trigger detection for iOS. Mirrors `proactive-triggers.ts`
/// from the web SDK adapted for UIKit/SwiftUI:
///
/// - **Rage-tap**: ≥3 taps on the same view within 500 ms.
/// - **Slow-screen**: a main-thread frame that takes >200 ms to render,
///   detected via a `CADisplayLink` monitoring the vsync budget.
///
/// Call `install(in:onTrigger:)` once in `Mushi.configure()`. The detector
/// holds a weak reference to the root window so it doesn't keep the scene
/// alive.
public final class ProactiveDetector: NSObject {

    public struct Config {
        /// Enable rage-tap detection (≥3 taps on same view in 500 ms).
        public var rageTap: Bool
        /// Enable slow-screen detection (frame render >200 ms).
        public var slowScreen: Bool
        /// Threshold in ms to flag a frame as slow. Default 200.
        public var slowScreenThresholdMs: Double
        /// Maximum proactive triggers to fire per session before silencing.
        public var maxPerSession: Int

        public init(
            rageTap: Bool = true,
            slowScreen: Bool = true,
            slowScreenThresholdMs: Double = 200,
            maxPerSession: Int = 3
        ) {
            self.rageTap = rageTap
            self.slowScreen = slowScreen
            self.slowScreenThresholdMs = slowScreenThresholdMs
            self.maxPerSession = maxPerSession
        }
    }

    public typealias TriggerCallback = (_ type: String, _ context: [String: Any]) -> Void

    private let config: Config
    private var onTrigger: TriggerCallback?
    private var fired = 0

    // Rage-tap state
    private var tapTimes: [TimeInterval] = []
    private var lastTapView: UIView?
    private var tapGR: UITapGestureRecognizer?

    // Slow-screen state
    private var displayLink: CADisplayLink?
    private var lastTimestamp: CFTimeInterval = 0

    public init(config: Config = Config()) {
        self.config = config
    }

    /// Install the detector on a `UIWindow`. Safe to call from any thread;
    /// UIKit mutations are dispatched to the main queue.
    public func install(in window: UIWindow, onTrigger: @escaping TriggerCallback) {
        self.onTrigger = onTrigger

        DispatchQueue.main.async { [weak self, weak window] in
            guard let self, let window else { return }
            if self.config.rageTap {
                let gr = UITapGestureRecognizer(target: self, action: #selector(self.handleTap(_:)))
                gr.cancelsTouchesInView = false
                window.addGestureRecognizer(gr)
                self.tapGR = gr
            }
            if self.config.slowScreen {
                let dl = CADisplayLink(target: self, selector: #selector(self.displayLinkFired(_:)))
                dl.add(to: .main, forMode: .common)
                self.displayLink = dl
            }
        }
    }

    public func destroy() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let gr = self.tapGR {
                gr.view?.removeGestureRecognizer(gr)
                self.tapGR = nil
            }
            self.displayLink?.invalidate()
            self.displayLink = nil
        }
    }

    // MARK: - Rage-tap

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        guard fired < config.maxPerSession else { return }
        let point = gr.location(in: gr.view)
        let tapped = gr.view?.hitTest(point, with: nil)

        let now = Date().timeIntervalSince1970 * 1000
        if tapped === lastTapView {
            tapTimes.append(now)
            tapTimes = tapTimes.filter { now - $0 < 500 }
            if tapTimes.count >= 3 {
                fire("rage_tap", context: [
                    "tapCount": tapTimes.count,
                    "viewClass": String(describing: type(of: tapped as AnyObject)),
                    "accessibilityLabel": tapped?.accessibilityLabel ?? "",
                ])
                tapTimes = []
            }
        } else {
            lastTapView = tapped
            tapTimes = [now]
        }
    }

    // MARK: - Slow screen

    @objc private func displayLinkFired(_ link: CADisplayLink) {
        guard fired < config.maxPerSession else { return }
        let ts = link.timestamp
        if lastTimestamp > 0 {
            let deltaMs = (ts - lastTimestamp) * 1000
            if deltaMs > config.slowScreenThresholdMs {
                fire("slow_screen", context: ["frameMs": Int(deltaMs)])
            }
        }
        lastTimestamp = ts
    }

    private func fire(_ type: String, context: [String: Any]) {
        fired += 1
        onTrigger?(type, context)
    }
}
#endif

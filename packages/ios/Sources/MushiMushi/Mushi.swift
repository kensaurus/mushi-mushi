import Foundation
#if os(iOS)
import UIKit
#endif

/// Public entry point for the iOS SDK. Mirrors the surface of
/// `@mushi-mushi/core` `Mushi` so cross-platform docs stay accurate.
///
/// Usage:
/// ```swift
/// import MushiMushi
///
/// @main struct MyApp: App {
///   init() {
///     Mushi.shared.configure(with: MushiConfig(projectId: "...", apiKey: "..."))
///   }
///   var body: some Scene { ... }
/// }
/// ```
public final class Mushi {
    public static let shared = Mushi()

    private var config: MushiConfig?
    private var apiClient: ApiClient?
    private var queue: OfflineQueue?
    private var flushTimer: Timer?

    private init() {}

    public func configure(with config: MushiConfig) {
        self.config = config
        let q = OfflineQueue(maxBytes: config.offlineQueueMaxBytes)
        self.queue = q
        self.apiClient = ApiClient(config: config, queue: q)
        installTriggers()
        startFlushTimer()
    }

    /// Submit a report with the given description and optional category.
    /// Captures device context and (if enabled) a screenshot automatically.
    public func report(
        description: String,
        category: String = "bug",
        metadata: [String: Any]? = nil
    ) {
        guard let client = apiClient, let config else { return }

        var payload: [String: Any] = [
            "description": description,
            "category": category,
            "context": DeviceContext.capture()
        ]
        if let metadata { payload["metadata"] = metadata }

        #if os(iOS)
        if config.captureScreenshot {
            let submit: ([String: Any]) -> Void = { client.submitReport($0) }
            if Thread.isMainThread {
                MainActor.assumeIsolated {
                    var p = payload
                    if let s = ScreenshotCapture.captureBase64() {
                        p["screenshot"] = s
                    }
                    submit(p)
                }
            } else {
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        var p = payload
                        if let s = ScreenshotCapture.captureBase64() {
                            p["screenshot"] = s
                        }
                        submit(p)
                    }
                }
            }
            return
        }
        #endif
        client.submitReport(payload)
    }

    /// Capture a Swift `Error`. The error description is used as the report
    /// body; full type info is forwarded via metadata.
    public func captureError(_ error: Error, context: [String: Any]? = nil) {
        var meta = context ?? [:]
        meta["errorType"] = String(reflecting: type(of: error))
        report(
            description: String(describing: error),
            category: "bug",
            metadata: meta
        )
    }

    /// Programmatically present the bottom sheet widget.
    public func showWidget() {
        #if os(iOS)
        guard let config, let client = apiClient else { return }
        DispatchQueue.main.async { @MainActor in
            guard let topVC = Self.topViewController() else { return }
            let screenshot = config.captureScreenshot
                ? ScreenshotCapture.captureBase64()
                : nil
            let widget = MushiWidgetController(config: config, screenshot: screenshot) { payload in
                client.submitReport(payload)
            }
            let nav = UINavigationController(rootViewController: widget)
            topVC.present(nav, animated: true)
        }
        #endif
    }

    /// Trigger an immediate offline queue flush. Reports the number of
    /// successfully delivered items via the optional completion handler.
    public func flushOfflineQueueNow(completion: ((Int) -> Void)? = nil) {
        DispatchQueue.global().async { [weak self] in
            self?.apiClient?.flushQueue()
            completion?(0)
        }
    }

    // MARK: - Private

    private func installTriggers() {
        #if os(iOS)
        guard let config else { return }
        if config.triggerMode == .shake || config.triggerMode == .both {
            ShakeDetector.install()
            ShakeDetector.onShake = { [weak self] in self?.showWidget() }
        }
        #endif
    }

    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.apiClient?.flushQueue()
        }
        // Also try once immediately, in case the app was opened with stale queued reports.
        DispatchQueue.global().async { [weak self] in self?.apiClient?.flushQueue() }
    }

    #if os(iOS)
    private static func topViewController(base: UIViewController? = nil) -> UIViewController? {
        let root = base ?? UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?.rootViewController

        if let nav = root as? UINavigationController { return topViewController(base: nav.visibleViewController) }
        if let tab = root as? UITabBarController { return topViewController(base: tab.selectedViewController) }
        if let presented = root?.presentedViewController { return topViewController(base: presented) }
        return root
    }
    #endif
}

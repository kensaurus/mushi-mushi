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
    private var user: [String: Any]?
    private var globalMetadata: [String: Any] = [:]
    #if os(iOS)
    private weak var floatingButton: UIButton?
    private var foregroundObserver: NSObjectProtocol?
    #endif

    private init() {}

    public func configure(with config: MushiConfig) {
        self.config = config
        let q = OfflineQueue(maxBytes: config.offlineQueueMaxBytes)
        self.queue = q
        self.apiClient = ApiClient(config: config, queue: q)
        #if os(iOS)
        removeFloatingButton()
        if let foregroundObserver {
            NotificationCenter.default.removeObserver(foregroundObserver)
            self.foregroundObserver = nil
        }
        #endif
        installTriggers()
        startFlushTimer()
    }

    /// Attach app/user identity to subsequent native reports.
    public func setUser(_ user: [String: Any]?) {
        self.user = user
    }

    /// Attach or clear a metadata key that should be sent with subsequent
    /// native reports.
    public func setMetadata(_ key: String, value: Any?) {
        if let value {
            globalMetadata[key] = value
        } else {
            globalMetadata.removeValue(forKey: key)
        }
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
        let mergedMetadata = mergeMetadata(metadata)
        if !mergedMetadata.isEmpty { payload["metadata"] = mergedMetadata }

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
    public func showWidget(category: String? = nil, metadata: [String: Any]? = nil) {
        #if os(iOS)
        guard let config, let client = apiClient else { return }
        DispatchQueue.main.async { @MainActor in
            guard let topVC = Self.topViewController() else { return }
            let screenshot = config.captureScreenshot
                ? ScreenshotCapture.captureBase64()
                : nil
            let widget = MushiWidgetController(config: config, screenshot: screenshot, initialCategory: category) { [weak self] payload in
                var report = payload
                let mergedMetadata = self?.mergeMetadata(metadata) ?? [:]
                if !mergedMetadata.isEmpty { report["metadata"] = mergedMetadata }
                client.submitReport(report)
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
        ShakeDetector.onShake = nil
        if config.triggerMode == .shake || config.triggerMode == .both {
            ShakeDetector.install()
            ShakeDetector.onShake = { [weak self] in self?.showWidget() }
        }
        if config.triggerMode == .button || config.triggerMode == .both {
            foregroundObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.installFloatingButtonIfNeeded() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.installFloatingButtonIfNeeded()
            }
        } else {
            removeFloatingButton()
        }
        #endif
    }

    private func mergeMetadata(_ metadata: [String: Any]?) -> [String: Any] {
        var merged = globalMetadata
        metadata?.forEach { merged[$0.key] = $0.value }
        if let user { merged["user"] = user }
        return merged
    }

    #if os(iOS)
    private func installFloatingButtonIfNeeded() {
        guard floatingButton == nil, let config else { return }
        guard config.triggerMode == .button || config.triggerMode == .both else { return }
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) else { return }

        let button = UIButton(type: .system)
        button.setTitle("🐛", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 24)
        button.accessibilityLabel = "Report a bug"
        button.backgroundColor = config.theme.dark ? .black : .systemBackground
        button.tintColor = UIColor(hex: config.theme.accentColor) ?? .systemBlue
        button.layer.cornerRadius = 28
        button.layer.borderWidth = 1
        button.layer.borderColor = button.tintColor.cgColor
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.18
        button.layer.shadowRadius = 12
        button.layer.shadowOffset = CGSize(width: 0, height: 6)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(showWidgetFromButton), for: .touchUpInside)
        window.addSubview(button)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 56),
            button.heightAnchor.constraint(equalToConstant: 56),
            button.trailingAnchor.constraint(equalTo: window.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            button.bottomAnchor.constraint(equalTo: window.safeAreaLayoutGuide.bottomAnchor, constant: -96)
        ])
        floatingButton = button
    }

    @objc private func showWidgetFromButton() {
        showWidget()
    }

    private func removeFloatingButton() {
        floatingButton?.removeFromSuperview()
        floatingButton = nil
    }
    #endif

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

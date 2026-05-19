import Foundation
import Network
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

    // All `_*` state is read/written under `stateLock`. Mirrors the
    // `synchronized(this)` pattern in the Android `Mushi` object so
    // a host that calls `configure(...)` from a non-main thread while
    // a background `report(...)` is in flight can't observe a torn
    // snapshot (e.g. new `apiClient` paired with old `config`).
    private let stateLock = NSLock()
    private var _config: MushiConfig?
    private var _apiClient: ApiClient?
    private var _queue: OfflineQueue?
    private var _flushTimer: Timer?
    private var _user: [String: Any]?
    private var _globalMetadata: [String: Any] = [:]
    private var _breadcrumbs = BreadcrumbCollector()
    private var _piiScrubber = PIIScrubber()
    // Added: network-aware delivery (Phase 2.4)
    private var _networkMonitor: NWPathMonitor?
    private let networkMonitorQueue = DispatchQueue(label: "mushi.network-monitor")
    #if os(iOS)
    private var _proactiveDetector: ProactiveDetector?
    private weak var _floatingButton: UIButton?
    private var _foregroundObserver: NSObjectProtocol?
    private var _proactiveForegroundObserver: NSObjectProtocol?
    private var _proactiveKeyWindowObserver: NSObjectProtocol?
    #endif

    private init() {}

    // MARK: - Locked accessors
    //
    // Trivial single-property getters that take the lock for the read.
    // Reads that need to span multiple properties go through `snapshot()`
    // below so the bundle is consistent.
    private func withLock<T>(_ body: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return body()
    }

    private struct ReportSnapshot {
        let config: MushiConfig
        let apiClient: ApiClient
        let breadcrumbs: BreadcrumbCollector
        let piiScrubber: PIIScrubber
        let mergedMetadata: [String: Any]
    }

    /// Snapshot every mutable property `report(...)` reads, in one critical
    /// section. Merging metadata also happens under the lock so `setUser` /
    /// `setMetadata` / `configure` mid-report can't slip in a half-applied
    /// edit.
    private func reportSnapshot(extraMetadata: [String: Any]?) -> ReportSnapshot? {
        withLock {
            guard let config = _config, let apiClient = _apiClient else { return nil }
            var merged = _globalMetadata
            extraMetadata?.forEach { merged[$0.key] = $0.value }
            if let user = _user { merged["user"] = user }
            return ReportSnapshot(
                config: config,
                apiClient: apiClient,
                breadcrumbs: _breadcrumbs,
                piiScrubber: _piiScrubber,
                mergedMetadata: merged
            )
        }
    }

    public func configure(with config: MushiConfig) {
        // Phase 1: take the lock and apply every reassignment atomically.
        // Side-effecting setup (timer / network monitor / triggers) runs
        // *outside* the lock so the host's notification observers — which
        // may call back into `addBreadcrumb` — never deadlock.
        let breadcrumbsRef = withLock { () -> BreadcrumbCollector in
            self._config = config
            self._piiScrubber = PIIScrubber(config: config.pii)
            if config.captureBreadcrumbs {
                self._breadcrumbs = BreadcrumbCollector()
            }
            let q = OfflineQueue(maxBytes: config.offlineQueueMaxBytes)
            self._queue = q
            self._apiClient = ApiClient(config: config, queue: q)
            return self._breadcrumbs
        }
        #if os(iOS)
        // Tear down any prior session — these operations take the lock
        // internally where they need to read the current detector / observer.
        teardownProactiveSession()
        removeFloatingButton()
        clearForegroundObservers()
        #endif
        installTriggers()
        startFlushTimer()
        startNetworkMonitor()
        breadcrumbsRef.add(category: .lifecycle, message: "Mushi configured")
    }

    /// Append a breadcrumb to the ring buffer. Included automatically on the
    /// next `report()` call. Mirrors `Mushi.addBreadcrumb()` in the web SDK.
    public func addBreadcrumb(
        category: MushiBreadcrumb.Category,
        level: MushiBreadcrumb.Level = .info,
        message: String,
        data: [String: String]? = nil
    ) {
        withLock { _breadcrumbs }.add(
            category: category, level: level, message: message, data: data
        )
    }

    /// Snapshot of the current breadcrumb ring buffer, oldest first.
    public func getBreadcrumbs() -> [MushiBreadcrumb] {
        withLock { _breadcrumbs }.getAll()
    }

    /// Attach app/user identity to subsequent native reports.
    public func setUser(_ user: [String: Any]?) {
        withLock { _user = user }
    }

    /// Attach or clear a metadata key that should be sent with subsequent
    /// native reports.
    public func setMetadata(_ key: String, value: Any?) {
        withLock {
            if let value {
                _globalMetadata[key] = value
            } else {
                _globalMetadata.removeValue(forKey: key)
            }
        }
    }

    #if os(iOS)
    public func setHidden(_ hidden: Bool) {
        hidden ? removeFloatingButton() : installFloatingButtonIfNeeded()
    }

    public func attachTo(_ control: UIControl) {
        control.addTarget(self, action: #selector(showWidgetFromButton), for: .touchUpInside)
    }
    #endif

    /// Submit a report with the given description and optional category.
    /// Captures device context and (if enabled) a screenshot automatically.
    /// Attaches the breadcrumb ring buffer (PII-scrubbed) to the payload.
    public func report(
        description: String,
        category: String = "bug",
        metadata: [String: Any]? = nil
    ) {
        guard let snapshot = reportSnapshot(extraMetadata: metadata) else { return }

        let scrubbedDescription = snapshot.piiScrubber.scrub(description)
        var payload: [String: Any] = [
            "description": scrubbedDescription,
            "category": category,
            "context": DeviceContext.capture()
        ]
        if !snapshot.mergedMetadata.isEmpty { payload["metadata"] = snapshot.mergedMetadata }

        if snapshot.config.captureBreadcrumbs {
            let crumbs = snapshot.breadcrumbs.getAll().map { crumb -> [String: Any] in
                var d: [String: Any] = [
                    "timestamp": crumb.timestamp,
                    "category": crumb.category.rawValue,
                    "level": crumb.level.rawValue,
                    "message": snapshot.piiScrubber.scrub(crumb.message),
                ]
                if let data = crumb.data {
                    d["data"] = data.mapValues { snapshot.piiScrubber.scrub($0) }
                }
                return d
            }
            if !crumbs.isEmpty { payload["breadcrumbs"] = crumbs }
        }

        snapshot.breadcrumbs.add(category: .lifecycle, message: "report submitted: \(category)")

        #if os(iOS)
        if snapshot.config.captureScreenshot {
            let submit: ([String: Any]) -> Void = { snapshot.apiClient.submitReport($0) }
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
        snapshot.apiClient.submitReport(payload)
    }

    /// Capture a Swift `Error`. Normalises the error (name/message/stack/cause)
    /// and files a report with structured metadata — mirrors `captureException`
    /// in the web SDK.
    public func captureError(_ error: Error, context: [String: Any]? = nil) {
        let norm = normaliseError(error)
        var meta = context ?? [:]
        meta["error"] = normaliseExceptionToMetadata(norm)
        report(
            description: norm.message,
            category: "bug",
            metadata: meta
        )
    }

    /// Programmatically present the bottom sheet widget.
    public func showWidget(category: String? = nil, metadata: [String: Any]? = nil) {
        #if os(iOS)
        // Snapshot config + apiClient atomically so a concurrent reconfigure
        // can't pair the old config with a new client (or vice versa) when
        // the user finally taps "Submit" inside the widget.
        let snapshot: (config: MushiConfig, apiClient: ApiClient)? = withLock {
            guard let c = _config, let a = _apiClient else { return nil }
            return (config: c, apiClient: a)
        }
        guard let snapshot else { return }
        DispatchQueue.main.async { @MainActor in
            guard let topVC = Self.topViewController() else { return }
            let screenshot = snapshot.config.captureScreenshot
                ? ScreenshotCapture.captureBase64()
                : nil
            let widget = MushiWidgetController(config: snapshot.config, screenshot: screenshot, initialCategory: category) { [weak self] payload in
                var report = payload
                let mergedMetadata = self?.mergeMetadata(metadata) ?? [:]
                if !mergedMetadata.isEmpty { report["metadata"] = mergedMetadata }
                snapshot.apiClient.submitReport(report)
            }
            let nav = UINavigationController(rootViewController: widget)
            topVC.present(nav, animated: true)
        }
        #endif
    }

    /// Trigger an immediate offline queue flush. Reports the number of
    /// successfully delivered items via the optional completion handler.
    public func flushOfflineQueueNow(completion: ((Int) -> Void)? = nil) {
        let client = withLock { _apiClient }
        DispatchQueue.global().async {
            client?.flushQueue()
            completion?(0)
        }
    }

    // MARK: - Private

    private func installTriggers() {
        #if os(iOS)
        guard let config = withLock({ _config }) else { return }
        ShakeDetector.onShake = nil
        if config.triggerMode == .shake || config.triggerMode == .both {
            ShakeDetector.install()
            ShakeDetector.onShake = { [weak self] in self?.showWidget() }
        }
        if config.triggerMode == .button || config.triggerMode == .both {
            let observer = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.installFloatingButtonIfNeeded() }
            withLock { _foregroundObserver = observer }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.installFloatingButtonIfNeeded()
            }
        } else {
            removeFloatingButton()
        }

        // Proactive triggers (rage-tap, slow-screen)
        let proactiveConfig = ProactiveDetector.Config(
            rageTap: config.proactive.rageTap,
            slowScreen: config.proactive.slowScreen,
            slowScreenThresholdMs: config.proactive.slowScreenThresholdMs,
            maxPerSession: config.proactive.maxPerSession
        )
        let detector = ProactiveDetector(config: proactiveConfig)
        // Capture the breadcrumb collector reference now so the proactive
        // callback hot path doesn't have to take `stateLock` per event. The
        // collector itself is independently thread-safe.
        let crumbsRef = withLock { () -> BreadcrumbCollector in
            self._proactiveDetector = detector
            return self._breadcrumbs
        }

        // Reset the slow-screen frame clock when the app foregrounds, so
        // the multi-second pause while backgrounded doesn't fire as a
        // false-positive slow_screen on the first post-resume frame.
        let foregroundObs = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak detector] _ in detector?.resetFrameClock() }
        withLock { _proactiveForegroundObserver = foregroundObs }

        // Install on the first key window we can find. Try at +0.5 / +2 / +5 s
        // (covers slow splash + multi-window scene promotion); also listen for
        // the first didBecomeKey notification as a belt-and-braces fallback.
        let installIfPossible: () -> Bool = { [weak self, weak detector] in
            guard let self, let detector else { return true }
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) else { return false }
            detector.install(in: window) { [weak self, weak crumbsRef] type, context in
                crumbsRef?.add(category: .lifecycle, level: .warning, message: "proactive:\(type)")
                self?.showWidget(category: "bug", metadata: ["proactiveTrigger": type, "proactiveContext": context])
            }
            return true
        }
        for delay in [0.5, 2.0, 5.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { _ = installIfPossible() }
        }
        let keyWindowObs = NotificationCenter.default.addObserver(
            forName: UIWindow.didBecomeKeyNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if installIfPossible() {
                let toRemove = self.withLock { () -> NSObjectProtocol? in
                    let obs = self._proactiveKeyWindowObserver
                    self._proactiveKeyWindowObserver = nil
                    return obs
                }
                if let toRemove { NotificationCenter.default.removeObserver(toRemove) }
            }
        }
        withLock { _proactiveKeyWindowObserver = keyWindowObs }
        #endif
    }

    /// Build the metadata bundle for `showWidget`'s submit callback. Read
    /// lock-protected so a concurrent `setUser` / `setMetadata` mid-submit
    /// doesn't tear the merged map.
    private func mergeMetadata(_ metadata: [String: Any]?) -> [String: Any] {
        withLock {
            var merged = _globalMetadata
            metadata?.forEach { merged[$0.key] = $0.value }
            if let user = _user { merged["user"] = user }
            return merged
        }
    }

    #if os(iOS)
    /// Tear down the previous proactive detector. Called from `configure`
    /// to make reconfigure idempotent.
    private func teardownProactiveSession() {
        let prior = withLock { () -> ProactiveDetector? in
            let d = _proactiveDetector
            _proactiveDetector = nil
            return d
        }
        prior?.destroy()
    }

    /// Detach the foreground / key-window / proactive-foreground notification
    /// observers (if any). Safe to call from `configure` repeatedly.
    private func clearForegroundObservers() {
        let observers: [NSObjectProtocol] = withLock {
            let bundle: [NSObjectProtocol?] = [
                _foregroundObserver,
                _proactiveForegroundObserver,
                _proactiveKeyWindowObserver,
            ]
            _foregroundObserver = nil
            _proactiveForegroundObserver = nil
            _proactiveKeyWindowObserver = nil
            return bundle.compactMap { $0 }
        }
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }
    #endif

    #if os(iOS)
    private func installFloatingButtonIfNeeded() {
        // UIKit views are main-thread only, but we still need atomic reads
        // of `_config` + `_floatingButton` so a concurrent reconfigure
        // doesn't leave us with a button bound to the previous theme.
        guard let config = withLock({ _config }) else { return }
        guard withLock({ _floatingButton }) == nil else { return }
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
        let inset = config.triggerInset
        var constraints = [
            button.widthAnchor.constraint(equalToConstant: 56),
            button.heightAnchor.constraint(equalToConstant: 56),
            button.bottomAnchor.constraint(equalTo: window.safeAreaLayoutGuide.bottomAnchor, constant: -inset.bottom)
        ]
        if let leading = inset.leading {
            constraints.append(button.leadingAnchor.constraint(equalTo: window.safeAreaLayoutGuide.leadingAnchor, constant: leading))
        } else {
            constraints.append(button.trailingAnchor.constraint(equalTo: window.safeAreaLayoutGuide.trailingAnchor, constant: -(inset.trailing ?? 20)))
        }
        NSLayoutConstraint.activate(constraints)
        withLock { _floatingButton = button }
    }

    @objc private func showWidgetFromButton() {
        showWidget()
    }

    private func removeFloatingButton() {
        let prior = withLock { () -> UIButton? in
            let b = _floatingButton
            _floatingButton = nil
            return b
        }
        prior?.removeFromSuperview()
    }
    #endif

    private func startFlushTimer() {
        let oldTimer = withLock { () -> Timer? in
            let t = _flushTimer
            _flushTimer = nil
            return t
        }
        oldTimer?.invalidate()
        let timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.withLock { self?._apiClient }?.flushQueue()
        }
        withLock { _flushTimer = timer }
        // Also try once immediately, in case the app was opened with stale queued reports.
        let client = withLock { _apiClient }
        DispatchQueue.global().async { client?.flushQueue() }
    }

    // Added: network-aware delivery (Phase 2.4)
    private func startNetworkMonitor() {
        let oldMonitor = withLock { () -> NWPathMonitor? in
            let m = _networkMonitor
            _networkMonitor = nil
            return m
        }
        oldMonitor?.cancel()
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            // `withLock` returns `ApiClient?`; through a weak `self?.` it
            // becomes `ApiClient??` so flatten before scheduling the flush.
            let client: ApiClient? = self?.withLock { self?._apiClient } ?? nil
            DispatchQueue.global().async { client?.flushQueue() }
        }
        // Reuse a single monitor queue across reconfigure calls — no per-call
        // queue allocation.
        monitor.start(queue: networkMonitorQueue)
        withLock { _networkMonitor = monitor }
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

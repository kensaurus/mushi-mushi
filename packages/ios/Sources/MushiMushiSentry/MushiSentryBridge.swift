import Foundation
import MushiMushi
import Sentry

/// Bridges the Mushi Mushi SDK to Sentry so:
///   1. Every Mushi report carries Sentry's most recent event ID and the
///      current breadcrumb trail as metadata.
///   2. Submitted reports also produce Sentry user feedback through the
///      current Sentry Cocoa feedback API.
///
/// Usage:
/// ```swift
/// import MushiMushi
/// import MushiMushiSentry
///
/// SentrySDK.start { o in o.dsn = "https://...sentry.io/0" }
/// Mushi.shared.configure(with: MushiConfig(projectId: "...", apiKey: "..."))
/// MushiSentryBridge.install()
/// ```
public enum MushiSentryBridge {
    /// Hook the bridge. Idempotent.
    public static func install() {
        // No private API needed: we wrap `Mushi.shared.report`-style calls by
        // observing the centralized notification we post from `Mushi`. The
        // notification path keeps the dependency unidirectional (Sentry depends
        // on MushiMushi, not the other way round).
        NotificationCenter.default.addObserver(
            forName: .mushiReportSubmitted,
            object: nil,
            queue: .main
        ) { note in
            guard let info = note.userInfo,
                  let description = info["description"] as? String else { return }

            SentrySDK.capture(message: "MushiReport: \(description.prefix(80))") { scope in
                scope.setTag(value: "mushi", key: "source")
                if let category = info["category"] as? String {
                    scope.setTag(value: category, key: "mushi.category")
                }
            }

            SentrySDK.capture(feedback: .init(
                message: description,
                name: info["name"] as? String,
                email: info["email"] as? String,
                source: .custom
            ))
        }
    }
}

public extension Notification.Name {
    /// Posted by Mushi every time a report is submitted. Used by the Sentry
    /// bridge; can also be observed by host apps for custom analytics.
    static let mushiReportSubmitted = Notification.Name("dev.mushimushi.report.submitted")
}

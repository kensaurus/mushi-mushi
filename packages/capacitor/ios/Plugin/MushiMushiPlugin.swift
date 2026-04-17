import Capacitor
import Foundation
import UIKit

/// Capacitor iOS plugin. Delegates to the native `MushiMushi` SDK so behaviour
/// is identical to the standalone iOS package — single code path = single
/// audit surface.
@objc(MushiMushiPlugin)
public class MushiMushiPlugin: CAPPlugin {

    private var configured = false

    @objc func configure(_ call: CAPPluginCall) {
        guard let projectId = call.getString("projectId"),
              let apiKey = call.getString("apiKey") else {
            call.reject("projectId and apiKey are required")
            return
        }

        let endpoint = call.getString("endpoint") ?? "https://api.mushimushi.dev"
        let captureScreenshot = call.getBool("captureScreenshot") ?? true
        let minDescriptionLength = call.getInt("minDescriptionLength") ?? 20
        let triggerStr = call.getString("triggerMode") ?? "shake"

        // Cross-platform parity: unknown strings fall back to `.shake` (the
        // documented default and the native SDK default), matching the Android
        // Capacitor plugin. A typo must never silently disable all triggers.
        let trigger: TriggerMode = {
            switch triggerStr {
            case "shake": return .shake
            case "button": return .button
            case "both": return .both
            case "none": return .none
            default: return .shake
            }
        }()

        // Reuse the native SDK so the offline queue / shake / API client
        // are exactly one implementation across native + Capacitor apps.
        let config = MushiConfig(
            projectId: projectId,
            apiKey: apiKey,
            endpoint: endpoint,
            triggerMode: trigger,
            captureScreenshot: captureScreenshot,
            minDescriptionLength: minDescriptionLength
        )
        Mushi.shared.configure(with: config)

        // Bridge native report-submitted callbacks to the JS layer.
        NotificationCenter.default.addObserver(
            forName: Notification.Name("dev.mushimushi.report.submitted"),
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let info = note.userInfo as? [String: Any] else { return }
            self?.notifyListeners("reportSubmitted", data: info)
        }

        configured = true
        call.resolve()
    }

    @objc func report(_ call: CAPPluginCall) {
        guard configured else { call.reject("Not configured"); return }
        guard let description = call.getString("description") else {
            call.reject("description is required"); return
        }
        let category = call.getString("category") ?? "bug"
        let metadata = call.getObject("metadata") as? [String: Any]
        Mushi.shared.report(description: description, category: category, metadata: metadata)
        call.resolve(["accepted": true])
    }

    @objc func captureScreenshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let img = ScreenshotCapture.captureBase64()
            call.resolve(["image": img as Any])
        }
    }

    @objc func showWidget(_ call: CAPPluginCall) {
        Mushi.shared.showWidget()
        call.resolve()
    }

    @objc func flushQueue(_ call: CAPPluginCall) {
        // The native SDK auto-flushes on a 30s timer; we expose a manual
        // trigger so JS callers can force a flush after coming online.
        Mushi.shared.flushOfflineQueueNow { delivered in
            call.resolve(["delivered": delivered])
        }
    }
}

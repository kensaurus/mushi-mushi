import Foundation
#if os(iOS) || os(tvOS)
import UIKit
#endif

/// Captures the runtime context Stage-1 classification needs. Mirrors the
/// `MushiContext` shape from `@mushi-mushi/core`.
enum DeviceContext {
    static func capture() -> [String: Any] {
        var ctx: [String: Any] = [
            "platform": "ios-native",
            "sdkName": "@mushi-mushi/ios",
            "sdkVersion": MushiInfo.sdkVersion,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "locale": Locale.current.identifier
        ]
        ctx["app"] = appInfo()
        ctx["device"] = deviceInfo()
        return ctx
    }

    private static func appInfo() -> [String: Any] {
        let bundle = Bundle.main
        return [
            "bundleId": bundle.bundleIdentifier ?? "unknown",
            "version": bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "build": bundle.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        ]
    }

    private static func deviceInfo() -> [String: Any] {
        var info: [String: Any] = [
            "osName": "iOS",
            "osVersion": ProcessInfo.processInfo.operatingSystemVersionString
        ]
        #if os(iOS) || os(tvOS)
        info["model"] = UIDevice.current.model
        info["systemName"] = UIDevice.current.systemName
        info["systemVersion"] = UIDevice.current.systemVersion
        let scale = UIScreen.main.scale
        let bounds = UIScreen.main.bounds
        info["screen"] = [
            "width": Int(bounds.width * scale),
            "height": Int(bounds.height * scale),
            "scale": scale
        ]
        #endif
        return info
    }
}

enum MushiInfo {
    /// Bumped automatically by the release script. Do not hand-edit.
    public static let sdkVersion = "0.2.0"
}

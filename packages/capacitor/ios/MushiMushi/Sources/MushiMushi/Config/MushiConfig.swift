import CoreGraphics
import Foundation

/// Top-level Mushi Mushi configuration. Mirrors the shape of
/// `@mushi-mushi/core` `MushiConfig` so cross-platform behaviour stays
/// consistent between web, React Native, and native iOS.
public struct MushiConfig {
    /// Default cloud endpoint. Self-hosters override this to point at their
    /// own Supabase Edge Function URL.
    public static let defaultEndpoint =
        "https://YOUR-PROJECT.supabase.co/functions/v1/api"

    public let projectId: String
    public let apiKey: String
    public var endpoint: String
    public var triggerMode: TriggerMode
    public var captureConsole: Bool
    public var captureNetwork: Bool
    public var captureScreenshot: Bool
    public var captureBreadcrumbs: Bool
    public var minDescriptionLength: Int
    public var offlineQueueMaxBytes: Int
    public var theme: Theme
    public var triggerInset: TriggerInset

    public enum TriggerMode {
        case shake
        case button
        case both
        case none
    }

    public struct Theme {
        public var accentColor: String
        public var dark: Bool
        public init(accentColor: String = "#6366f1", dark: Bool = false) {
            self.accentColor = accentColor
            self.dark = dark
        }
    }

    public struct TriggerInset {
        public var bottom: CGFloat
        public var leading: CGFloat?
        public var trailing: CGFloat?

        public init(bottom: CGFloat = 96, leading: CGFloat? = nil, trailing: CGFloat? = 20) {
            self.bottom = bottom
            self.leading = leading
            self.trailing = trailing
        }
    }

    public init(
        projectId: String,
        apiKey: String,
        endpoint: String = MushiConfig.defaultEndpoint,
        triggerMode: TriggerMode = .shake,
        captureConsole: Bool = true,
        captureNetwork: Bool = true,
        captureScreenshot: Bool = true,
        captureBreadcrumbs: Bool = true,
        minDescriptionLength: Int = 20,
        offlineQueueMaxBytes: Int = 1_000_000,
        theme: Theme = Theme(),
        triggerInset: TriggerInset = TriggerInset()
    ) {
        self.projectId = projectId
        self.apiKey = apiKey
        self.endpoint = endpoint
        self.triggerMode = triggerMode
        self.captureConsole = captureConsole
        self.captureNetwork = captureNetwork
        self.captureScreenshot = captureScreenshot
        self.captureBreadcrumbs = captureBreadcrumbs
        self.minDescriptionLength = minDescriptionLength
        self.offlineQueueMaxBytes = offlineQueueMaxBytes
        self.theme = theme
        self.triggerInset = triggerInset
    }
}

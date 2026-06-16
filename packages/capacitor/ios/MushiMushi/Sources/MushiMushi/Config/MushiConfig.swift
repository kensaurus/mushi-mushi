import CoreGraphics
import Foundation

/// Top-level Mushi Mushi configuration. Mirrors the shape of
/// `@mushi-mushi/core` `MushiConfig` so cross-platform behaviour stays
/// consistent between web, React Native, and native iOS.
public struct MushiConfig {
    public let projectId: String
    public let apiKey: String
    /// Required. Set to your Supabase Edge Function URL,
    /// e.g. "https://xyz.supabase.co/functions/v1/api".
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
    public var proactive: ProactiveConfig
    public var pii: PIIScrubberConfig
    public var draggable: DraggableConfig?

    public struct ProactiveConfig {
        /// Detect ≥3 rapid taps on the same view. Default true.
        public var rageTap: Bool
        /// Detect frames taking >200 ms to render. Default true.
        public var slowScreen: Bool
        /// Slow-screen threshold in ms. Default 200.
        public var slowScreenThresholdMs: Double
        /// Max proactive triggers filed per session before silencing. Default 3.
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

    public enum TriggerMode {
        case shake
        case button
        case both
        case none
    }

    public struct Theme {
        public var accentColor: String
        public var dark: Bool
        /// When true, the SDK reads UITraitCollection.userInterfaceStyle
        /// from the host app and ignores the `dark` field.
        public var inherit: Bool
        public init(accentColor: String = "#6366f1", dark: Bool = false, inherit: Bool = false) {
            self.accentColor = accentColor
            self.dark = dark
            self.inherit = inherit
        }
    }

    /// Draggable FAB configuration.
    public struct DraggableConfig {
        /// Allow the FAB to be dragged to a new position.
        public var enabled: Bool
        /// Snap FAB to the nearest vertical edge after dragging.
        public var snapToEdge: Bool
        /// Persist FAB position across sessions via UserDefaults.
        public var persist: Bool
        public init(enabled: Bool = true, snapToEdge: Bool = true, persist: Bool = true) {
            self.enabled = enabled
            self.snapToEdge = snapToEdge
            self.persist = persist
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

    // BREAKING CHANGE: `endpoint` is now required — there is no safe default.
    // Pass your Supabase Edge Function URL: "https://xyz.supabase.co/functions/v1/api".
    public init(
        projectId: String,
        apiKey: String,
        endpoint: String,
        triggerMode: TriggerMode = .shake,
        captureConsole: Bool = true,
        captureNetwork: Bool = true,
        captureScreenshot: Bool = true,
        captureBreadcrumbs: Bool = true,
        minDescriptionLength: Int = 20,
        offlineQueueMaxBytes: Int = 1_000_000,
        theme: Theme = Theme(),
        triggerInset: TriggerInset = TriggerInset(),
        proactive: ProactiveConfig = ProactiveConfig(),
        pii: PIIScrubberConfig = PIIScrubberConfig(),
        draggable: DraggableConfig? = nil
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
        self.proactive = proactive
        self.pii = pii
        self.draggable = draggable
    }
}

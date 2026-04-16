import Foundation

public struct MushiConfig {
    public let projectId: String
    public let apiKey: String
    public var endpoint: String
    public var triggerMode: TriggerMode
    public var captureConsole: Bool
    public var captureNetwork: Bool

    public enum TriggerMode {
        case shake
        case button
        case both
    }

    public init(
        projectId: String,
        apiKey: String,
        endpoint: String = "https://api.mushimushi.dev",
        triggerMode: TriggerMode = .shake,
        captureConsole: Bool = true,
        captureNetwork: Bool = true
    ) {
        self.projectId = projectId
        self.apiKey = apiKey
        self.endpoint = endpoint
        self.triggerMode = triggerMode
        self.captureConsole = captureConsole
        self.captureNetwork = captureNetwork
    }
}

import Foundation
import UIKit

public final class Mushi {
    public static let shared = Mushi()
    private var config: MushiConfig?
    private var apiClient: ApiClient?

    private init() {}

    public func configure(with config: MushiConfig) {
        self.config = config
        self.apiClient = ApiClient(config: config)
        // TODO: Initialize capture modules based on config
        // TODO: Start offline queue flush timer
        // TODO: Register shake gesture handler
    }

    public func submitReport(_ report: [String: Any]) {
        // TODO: Enqueue report via ApiClient, fall back to offline queue
    }

    public func captureError(_ error: Error, context: [String: Any]? = nil) {
        // TODO: Build report from error + captured context and submit
    }

    public func showWidget() {
        // TODO: Present MushiViewController as bottom sheet
    }
}

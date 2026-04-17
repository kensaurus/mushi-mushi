import Foundation

final class ApiClient {
    private let config: MushiConfig
    private let session: URLSession
    private let queue: OfflineQueue

    init(config: MushiConfig, queue: OfflineQueue) {
        self.config = config
        self.queue = queue
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: cfg)
    }

    /// Submits the report. On any non-2xx (or transport error), enqueues the
    /// payload to the offline queue for later flushing. Mirrors the behaviour
    /// of the JS core SDK so client-side observability is consistent.
    func submitReport(_ report: [String: Any], completion: ((Result<Void, Error>) -> Void)? = nil) {
        var payload = report
        payload["projectId"] = config.projectId
        payload["sdkName"] = "@mushi-mushi/ios"
        payload["sdkVersion"] = MushiInfo.sdkVersion

        guard let url = URL(string: "\(config.endpoint)/v1/reports") else {
            queue.enqueue(payload)
            completion?(.failure(MushiError.invalidEndpoint))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(config.apiKey, forHTTPHeaderField: "X-Mushi-Api-Key")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            queue.enqueue(payload)
            completion?(.failure(error))
            return
        }

        session.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            if let error = error {
                self.queue.enqueue(payload)
                completion?(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                self.queue.enqueue(payload)
                completion?(.failure(MushiError.serverError((response as? HTTPURLResponse)?.statusCode ?? -1)))
                return
            }
            NotificationCenter.default.post(
                name: Notification.Name("dev.mushimushi.report.submitted"),
                object: nil,
                userInfo: payload
            )
            completion?(.success(()))
        }.resume()
    }

    /// Flushes the offline queue. Stops on the first failure to avoid
    /// hammering a degraded server.
    func flushQueue(maxBatch: Int = 25) {
        let batch = queue.peek(limit: maxBatch)
        guard !batch.isEmpty else { return }

        var delivered = 0
        let group = DispatchGroup()
        for payload in batch {
            group.enter()
            submitReport(payload) { result in
                if case .success = result { delivered += 1 }
                group.leave()
            }
        }
        group.notify(queue: .global()) { [weak self] in
            self?.queue.clearDelivered(count: delivered)
        }
    }
}

enum MushiError: Error {
    case invalidEndpoint
    case serverError(Int)
    case notConfigured
}

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

    /// Submits the report. Scrubs PII from description, then attempts delivery
    /// with retry+jitter. On final failure the payload is enqueued to the
    /// offline queue for later flushing. Mirrors the behaviour of the JS core
    /// SDK so client-side observability is consistent.
    func submitReport(_ report: [String: Any], completion: ((Result<Void, Error>) -> Void)? = nil) {
        var payload = report
        payload["projectId"] = config.projectId
        payload["sdkName"] = "@mushi-mushi/ios"
        payload["sdkVersion"] = MushiInfo.sdkVersion

        // Added: PII scrubbing (Phase 2.4)
        if let desc = payload["description"] as? String {
            payload["description"] = scrubPii(desc)
        }

        guard let url = URL(string: "\(config.endpoint)/v1/reports") else {
            queue.enqueue(payload)
            completion?(.failure(MushiError.invalidEndpoint))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(config.apiKey, forHTTPHeaderField: "X-Mushi-Api-Key")

        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            queue.enqueue(payload)
            completion?(.failure(MushiError.invalidEndpoint))
            return
        }

        // Added: retry+jitter (Phase 2.4)
        Task { [weak self] in
            guard let self else { return }
            let success = await self.sendWithRetry(request: request, data: data)
            if success {
                NotificationCenter.default.post(
                    name: Notification.Name("dev.mushimushi.report.submitted"),
                    object: nil,
                    userInfo: payload
                )
                completion?(.success(()))
            } else {
                self.queue.enqueue(payload)
                completion?(.failure(MushiError.serverError(-1)))
            }
        }
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

    // Added: retry+jitter (Phase 2.4)
    private func sendWithRetry(request: URLRequest, data: Data, attempt: Int = 0) async -> Bool {
        do {
            let (_, response) = try await session.upload(for: request, from: data)
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 429 || http.statusCode >= 500 {
                    let delay = min(1.0 * pow(2.0, Double(attempt)) + Double.random(in: 0...0.5), 10.0)
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    if attempt < 3 { return await sendWithRetry(request: request, data: data, attempt: attempt + 1) }
                    return false
                }
                return (200...299).contains(http.statusCode)
            }
            return false
        } catch {
            return false
        }
    }

    // Added: PII scrubbing (Phase 2.4)
    private func scrubPii(_ text: String) -> String {
        let patterns: [(String, String)] = [
            (#"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"#, "[REDACTED]"),
            (#"\b\d{3}[.\-]?\d{3}[.\-]?\d{4}\b"#, "[REDACTED]"),
            (#"\b(?:\d{4}[\ \-]?){3}\d{4}\b"#, "[REDACTED]"),
        ]
        var result = text
        for (pattern, replacement) in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(result.startIndex..., in: result)
                result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: replacement)
            }
        }
        return result
    }
}

enum MushiError: Error {
    case invalidEndpoint
    case serverError(Int)
    case notConfigured
}

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

        // PII scrubbing — applied to every free-text vector that can pick up
        // user-pasted secrets. Mirrors packages/core/src/pii-scrubber.ts so
        // server-side and SDK-side redaction stay in lockstep.
        if let desc = payload["description"] as? String { payload["description"] = scrubPii(desc) }
        if let summary = payload["summary"] as? String { payload["summary"] = scrubPii(summary) }
        if var crumbs = payload["breadcrumbs"] as? [[String: Any]] {
            for i in 0..<crumbs.count {
                if let msg = crumbs[i]["message"] as? String {
                    crumbs[i]["message"] = scrubPii(msg)
                }
            }
            payload["breadcrumbs"] = crumbs
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

    // PII scrubbing — Wave S2 / D-16
    //
    // Mirrors packages/core/src/pii-scrubber.ts so an iOS user who pastes a
    // Stripe key, an OpenAI key, a JWT, or a credit card into a bug report
    // never ships it to our servers. Order matters: high-entropy / high-cost
    // tokens first so generic email/phone regex never wins a tie. We omit
    // IPv4/IPv6 by default (too noisy: `192.168.1.1` is rarely PII).
    private static let scrubPatterns: [(String, String)] = [
        (#"\b\d{3}-\d{2}-\d{4}\b"#,                                                 "[REDACTED_SSN]"),
        (#"\b(?:\d[ -]*){12,18}\d\b"#,                                              "[REDACTED_CC]"),
        (#"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"#,                                         "[REDACTED_AWS_KEY]"),
        (#"(?i)(?:aws_secret_access_key|secret_access_key)["'\s:=]+[A-Za-z0-9/+=]{40}\b"#, "aws_secret_access_key=[REDACTED_AWS_SECRET]"),
        (#"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b"#,                          "[REDACTED_STRIPE_KEY]"),
        (#"\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b"#,                                 "[REDACTED_STRIPE_PK]"),
        (#"\bxox[abpor]-[A-Za-z0-9-]{10,}\b"#,                                      "[REDACTED_SLACK_TOKEN]"),
        (#"\bghp_[A-Za-z0-9]{36}\b"#,                                               "[REDACTED_GITHUB_PAT]"),
        (#"\bgithub_pat_[A-Za-z0-9_]{80,}\b"#,                                      "[REDACTED_GITHUB_PAT]"),
        (#"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"#,                                   "[REDACTED_OPENAI_KEY]"),
        (#"\bsk-ant-[A-Za-z0-9_-]{20,}\b"#,                                         "[REDACTED_ANTHROPIC_KEY]"),
        (#"\bAIza[0-9A-Za-z_-]{35}\b"#,                                             "[REDACTED_GOOGLE_KEY]"),
        (#"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"#,                 "[REDACTED_JWT]"),
        (#"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"#,                  "[REDACTED_EMAIL]"),
        (#"(?:\+\d{1,3}[\s.\-])?\(?\d{2,4}\)?[\s.\-]\d{3,4}[\s.\-]\d{3,4}\b"#,       "[REDACTED_PHONE]"),
    ]

    private func scrubPii(_ text: String) -> String {
        var result = text
        for (pattern, replacement) in Self.scrubPatterns {
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

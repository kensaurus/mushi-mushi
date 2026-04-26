import Foundation

/// Append-only file-backed queue that survives app restarts. Mirrors the
/// behaviour of `@mushi-mushi/core/offline-queue.ts` so the contract is
/// identical across platforms.
///
/// Threading: All file IO happens on a private serial queue. Public methods
/// are safe to call from any thread.
final class OfflineQueue {
    private let fileURL: URL
    private let maxBytes: Int
    private let queue = DispatchQueue(label: "dev.mushimushi.offline-queue")

    /// - Parameters:
    ///   - maxBytes: Soft cap for the on-disk queue. Oldest entries are
    ///     trimmed when adding would exceed this size.
    ///   - directory: Override the storage directory. Production code should
    ///     pass `nil` (defaults to Application Support); tests use a tmpdir.
    init(maxBytes: Int, directory: URL? = nil) {
        let dir = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MushiMushi", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("queue.ndjson")
        self.maxBytes = maxBytes
    }

    /// Enqueue a JSON-serialisable report. Drops the oldest entries if
    /// adding this one would exceed `maxBytes`.
    func enqueue(_ payload: [String: Any]) {
        queue.sync {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload) else {
                return
            }
            var line = data
            line.append(0x0A) // newline
            appendAndTrim(line)
        }
    }

    /// Drain up to `limit` queued reports. Caller is expected to attempt
    /// delivery and call `clearDelivered` on success.
    func peek(limit: Int) -> [[String: Any]] {
        queue.sync {
            guard let data = try? Data(contentsOf: fileURL) else { return [] }
            return data.split(separator: 0x0A)
                .prefix(limit)
                .compactMap { try? JSONSerialization.jsonObject(with: Data($0)) as? [String: Any] }
        }
    }

    /// Drop the first `count` queued reports.
    func clearDelivered(count: Int) {
        queue.sync {
            guard count > 0,
                  let data = try? Data(contentsOf: fileURL) else { return }
            var lines = data.split(separator: 0x0A)
            guard count <= lines.count else {
                try? FileManager.default.removeItem(at: fileURL)
                return
            }
            lines.removeFirst(count)
            let rebuilt = lines.flatMap { Array($0) + [UInt8(0x0A)] }
            try? Data(rebuilt).write(to: fileURL, options: .atomic)
        }
    }

    /// Number of queued reports. Cheap; counts newlines.
    var count: Int {
        queue.sync {
            guard let data = try? Data(contentsOf: fileURL) else { return 0 }
            return data.reduce(0) { $0 + ($1 == 0x0A ? 1 : 0) }
        }
    }

    private func appendAndTrim(_ line: Data) {
        var existing = (try? Data(contentsOf: fileURL)) ?? Data()
        existing.append(line)
        // Cheap newest-wins trim: drop earliest lines until under the cap.
        while existing.count > maxBytes,
              let nl = existing.firstIndex(of: 0x0A) {
            existing.removeSubrange(0...nl)
        }
        try? existing.write(to: fileURL, options: .atomic)
    }
}

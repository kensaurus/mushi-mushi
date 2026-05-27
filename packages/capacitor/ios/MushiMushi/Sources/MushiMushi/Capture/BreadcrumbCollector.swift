import Foundation

/// Single breadcrumb entry. Shape mirrors `MushiBreadcrumb` from `@mushi-mushi/core`
/// so the server and admin tools can treat iOS and web breadcrumbs identically.
public struct MushiBreadcrumb: Codable {
    /// Unix epoch milliseconds when the breadcrumb fired.
    public let timestamp: TimeInterval
    /// Coarse bucket for filtering.
    public let category: Category
    /// Severity. Defaults to `.info`.
    public let level: Level
    /// Free-form short summary, capped at 500 chars at insert time.
    public let message: String
    /// Optional structured payload.
    public let data: [String: String]?

    public enum Category: String, Codable {
        case navigation, uiTap = "ui.tap", console, network, lifecycle, custom
    }

    public enum Level: String, Codable {
        case debug, info, warning, error
    }

    public init(
        timestamp: TimeInterval = Date().timeIntervalSince1970 * 1000,
        category: Category,
        level: Level = .info,
        message: String,
        data: [String: String]? = nil
    ) {
        self.timestamp = timestamp
        self.category = category
        self.level = level
        self.message = message
        self.data = data
    }
}

/// Ring-buffer breadcrumb store. Capped at `max` entries (default 50);
/// once full, every new `add` evicts the oldest. Thread-safe.
///
/// PII note: the buffer stores values verbatim. PIIScrubber is applied at
/// *snapshot time* in `Mushi.report()` — same contract as the web SDK.
public final class BreadcrumbCollector {
    private let max: Int
    private let maxMessageLength: Int
    private var entries: [MushiBreadcrumb] = []
    private let lock = NSLock()

    public init(max: Int = 50, maxMessageLength: Int = 500) {
        self.max = Swift.max(1, max)
        self.maxMessageLength = Swift.max(50, maxMessageLength)
    }

    /// Append a breadcrumb to the ring buffer.
    public func add(
        category: MushiBreadcrumb.Category,
        level: MushiBreadcrumb.Level = .info,
        message: String,
        data: [String: String]? = nil,
        timestamp: TimeInterval? = nil
    ) {
        let ts = timestamp ?? Date().timeIntervalSince1970 * 1000
        let msg = message.count > maxMessageLength
            ? String(message.prefix(maxMessageLength)) + "…"
            : message
        let crumb = MushiBreadcrumb(timestamp: ts, category: category, level: level, message: msg, data: data)
        lock.lock()
        defer { lock.unlock() }
        entries.append(crumb)
        while entries.count > max { entries.removeFirst() }
    }

    /// Return a copy of all retained breadcrumbs, oldest first.
    public func getAll() -> [MushiBreadcrumb] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    /// Drop all entries.
    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        entries.removeAll()
    }

    /// Number of currently retained entries.
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }
}

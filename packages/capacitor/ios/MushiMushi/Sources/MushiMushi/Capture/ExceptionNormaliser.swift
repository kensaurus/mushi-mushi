import Foundation

/// Normalised form of anything that might be thrown.
/// Mirrors `NormalisedException` from `packages/core/src/exception-normaliser.ts`.
public struct NormalisedException {
    public let name: String
    public let message: String
    public let stack: String?
    public let cause: String?

    public init(name: String, message: String, stack: String? = nil, cause: String? = nil) {
        self.name = name
        self.message = message
        self.stack = stack
        self.cause = cause
    }
}

private let stackLimit = 8 * 1024

/// Normalise any Swift `Error` (or `NSError`) into the shape Mushi reports use.
/// Mirrors `normaliseThrown` from `packages/core/src/exception-normaliser.ts`:
/// same field names, same 8 KB stack cap, same cause-unwinding.
public func normaliseError(_ error: Error) -> NormalisedException {
    let nsErr = error as NSError
    let name = String(reflecting: type(of: error))

    // Use localizedDescription for the message — most informative for the
    // admin UI. Full type info is retained in `name`.
    let message = error.localizedDescription.isEmpty
        ? nsErr.debugDescription
        : error.localizedDescription

    // Build a compact stack trace from Thread.callStackSymbols. This is a
    // snapshot of the *current* call stack (the normaliser call site), not
    // the original throw site — Swift doesn't retain throw-site stacks unless
    // the host uses a crash reporter. We prefix it with the error description
    // so the admin can see the error context without expanding.
    let rawStack = Thread.callStackSymbols.joined(separator: "\n")
    let stack = rawStack.isEmpty ? nil : String(rawStack.prefix(stackLimit))

    // Unwrap NSError.userInfo[NSUnderlyingErrorKey] as the cause, matching
    // the JS `error.cause` behaviour in the TS normaliser.
    let causeError = nsErr.userInfo[NSUnderlyingErrorKey] as? Error
    let cause = causeError?.localizedDescription

    return NormalisedException(name: name, message: message, stack: stack, cause: cause)
}

/// Convert a `NormalisedException` to the `[String: Any]` shape that
/// `Mushi.report()` embeds in `metadata["error"]`.
public func normaliseExceptionToMetadata(_ norm: NormalisedException) -> [String: Any] {
    var d: [String: Any] = [
        "type": norm.name,
        "message": norm.message,
    ]
    if let stack = norm.stack { d["stack"] = stack }
    if let cause = norm.cause { d["cause"] = cause }
    return d
}

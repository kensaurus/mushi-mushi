import Foundation

/// Regex-based PII scrubber. Mirrors `packages/core/src/pii-scrubber.ts`
/// exactly: same regex set, same replacement tokens, same default-on/off flags.
///
/// Used at *report-snapshot time* in `Mushi.report()` so PII in breadcrumb
/// messages or the description field never leaves the device.
public struct PIIScrubberConfig {
    public var emails: Bool
    public var phones: Bool
    public var creditCards: Bool
    public var ssns: Bool
    public var ipAddresses: Bool
    /// Vendor-shaped secret tokens: AWS, Stripe, Slack, GitHub PATs, OpenAI,
    /// Anthropic, Google keys, JWTs. Default ON — if a key leaks into a bug
    /// report there is no good reason to ship it to the server.
    public var secretTokens: Bool
    public var ipv6: Bool

    public init(
        emails: Bool = true,
        phones: Bool = true,
        creditCards: Bool = true,
        ssns: Bool = true,
        ipAddresses: Bool = false,
        secretTokens: Bool = true,
        ipv6: Bool = false
    ) {
        self.emails = emails
        self.phones = phones
        self.creditCards = creditCards
        self.ssns = ssns
        self.ipAddresses = ipAddresses
        self.secretTokens = secretTokens
        self.ipv6 = ipv6
    }
}

private struct PiiPattern {
    let enabled: (PIIScrubberConfig) -> Bool
    let pattern: String
    let replacement: String
    /// Mirrors `packages/core/src/pii-scrubber.ts` flags: only the
    /// `aws_secret_access_key` pattern is case-insensitive (keeps lowercase
    /// `aws_secret_access_key` and uppercase variants in scope) — every
    /// other pattern is anchored to its real-world casing.
    let caseInsensitive: Bool

    init(enabled: @escaping (PIIScrubberConfig) -> Bool,
         pattern: String,
         replacement: String,
         caseInsensitive: Bool = false) {
        self.enabled = enabled
        self.pattern = pattern
        self.replacement = replacement
        self.caseInsensitive = caseInsensitive
    }
}

// Order mirrors the TS source: SSN → CC → vendor secrets → email → phone → IP.
private let orderedPatterns: [PiiPattern] = [
    PiiPattern(enabled: { $0.ssns },        pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",                        replacement: "[REDACTED_SSN]"),
    PiiPattern(enabled: { $0.creditCards }, pattern: "\\b(?:\\d[ -]*){12,18}\\d\\b",                       replacement: "[REDACTED_CC]"),

    // Vendor tokens
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",                    replacement: "[REDACTED_AWS_KEY]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "(?:aws_secret_access_key|secret_access_key)[\"'\\s:=]+[A-Za-z0-9/+=]{40}\\b", replacement: "aws_secret_access_key=[REDACTED_AWS_SECRET]", caseInsensitive: true),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\\b",    replacement: "[REDACTED_STRIPE_KEY]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bpk_(?:live|test)_[A-Za-z0-9]{24,}\\b",           replacement: "[REDACTED_STRIPE_PK]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bxox[abpor]-[A-Za-z0-9-]{10,}\\b",                replacement: "[REDACTED_SLACK_TOKEN]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bghp_[A-Za-z0-9]{36}\\b",                         replacement: "[REDACTED_GITHUB_PAT]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bgithub_pat_[A-Za-z0-9_]{80,}\\b",                replacement: "[REDACTED_GITHUB_PAT]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",             replacement: "[REDACTED_OPENAI_KEY]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b",                   replacement: "[REDACTED_ANTHROPIC_KEY]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\bAIza[0-9A-Za-z_-]{35}\\b",                       replacement: "[REDACTED_GOOGLE_KEY]"),
    PiiPattern(enabled: { $0.secretTokens }, pattern: "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b", replacement: "[REDACTED_JWT]"),

    PiiPattern(enabled: { $0.emails },       pattern: "\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b", replacement: "[REDACTED_EMAIL]"),
    PiiPattern(enabled: { $0.phones },       pattern: "(?:\\+\\d{1,3}[\\s.-])?\\(?\\d{2,4}\\)?[\\s.-]\\d{3,4}[\\s.-]\\d{3,4}\\b", replacement: "[REDACTED_PHONE]"),
    PiiPattern(enabled: { $0.ipAddresses },  pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",                  replacement: "[REDACTED_IP]"),
    PiiPattern(enabled: { $0.ipv6 },         pattern: "\\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\\b", replacement: "[REDACTED_IPV6]"),
]

/// A compiled PII scrubber. Create once; call `scrub(_:)` on every string
/// that might leave the device.
public final class PIIScrubber {
    private let active: [(regex: NSRegularExpression, replacement: String)]

    public init(config: PIIScrubberConfig = PIIScrubberConfig()) {
        active = orderedPatterns.compactMap { p -> (NSRegularExpression, String)? in
            guard p.enabled(config) else { return nil }
            let options: NSRegularExpression.Options = p.caseInsensitive ? [.caseInsensitive] : []
            guard let re = try? NSRegularExpression(pattern: p.pattern, options: options) else { return nil }
            return (re, p.replacement)
        }
    }

    /// Replace all recognised PII patterns in `text` with redaction tokens.
    public func scrub(_ text: String) -> String {
        guard !text.isEmpty else { return text }
        var result = text
        for (re, replacement) in active {
            result = re.stringByReplacingMatches(
                in: result,
                range: NSRange(result.startIndex..., in: result),
                withTemplate: replacement
            )
        }
        return result
    }

    /// Scrub specified string-typed keys inside a dictionary without touching
    /// other keys.
    public func scrubKeys(_ keys: [String], in dict: [String: Any]) -> [String: Any] {
        var copy = dict
        for key in keys {
            if let s = copy[key] as? String {
                copy[key] = scrub(s)
            }
        }
        return copy
    }
}

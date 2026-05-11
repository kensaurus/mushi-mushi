package dev.mushimushi.sdk.pii

/**
 * Regex-based PII scrubber. Mirrors `packages/core/src/pii-scrubber.ts`
 * exactly: same regex set, same replacement tokens, same default-on/off flags.
 *
 * Thread-safe (all state is immutable after construction).
 * Used at *report-snapshot time* in [dev.mushimushi.sdk.Mushi.report].
 */
data class PIIScrubberConfig(
    val emails: Boolean = true,
    val phones: Boolean = true,
    val creditCards: Boolean = true,
    val ssns: Boolean = true,
    val ipAddresses: Boolean = false,
    /** Vendor-shaped secret tokens. Default ON. */
    val secretTokens: Boolean = true,
    val ipv6: Boolean = false,
)

private data class PiiPattern(
    val enabled: (PIIScrubberConfig) -> Boolean,
    val pattern: String,
    val replacement: String,
    val caseInsensitive: Boolean = false,
)

private val ORDERED_PATTERNS = listOf(
    PiiPattern({ it.ssns },        """\b\d{3}-\d{2}-\d{4}\b""",                       "[REDACTED_SSN]"),
    PiiPattern({ it.creditCards }, """\b(?:\d[ -]*){12,18}\d\b""",                    "[REDACTED_CC]"),

    // Vendor secrets
    PiiPattern({ it.secretTokens }, """\b(?:AKIA|ASIA)[0-9A-Z]{16}\b""",              "[REDACTED_AWS_KEY]"),
    PiiPattern({ it.secretTokens }, """(?:aws_secret_access_key|secret_access_key)["'\s:=]+[A-Za-z0-9/+=]{40}\b""",
        "aws_secret_access_key=[REDACTED_AWS_SECRET]", caseInsensitive = true),
    PiiPattern({ it.secretTokens }, """\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b""","[REDACTED_STRIPE_KEY]"),
    PiiPattern({ it.secretTokens }, """\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b""",      "[REDACTED_STRIPE_PK]"),
    PiiPattern({ it.secretTokens }, """\bxox[abpor]-[A-Za-z0-9-]{10,}\b""",           "[REDACTED_SLACK_TOKEN]"),
    PiiPattern({ it.secretTokens }, """\bghp_[A-Za-z0-9]{36}\b""",                    "[REDACTED_GITHUB_PAT]"),
    PiiPattern({ it.secretTokens }, """\bgithub_pat_[A-Za-z0-9_]{80,}\b""",           "[REDACTED_GITHUB_PAT]"),
    PiiPattern({ it.secretTokens }, """\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b""",        "[REDACTED_OPENAI_KEY]"),
    PiiPattern({ it.secretTokens }, """\bsk-ant-[A-Za-z0-9_-]{20,}\b""",              "[REDACTED_ANTHROPIC_KEY]"),
    PiiPattern({ it.secretTokens }, """\bAIza[0-9A-Za-z_-]{35}\b""",                  "[REDACTED_GOOGLE_KEY]"),
    PiiPattern({ it.secretTokens }, """\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b""", "[REDACTED_JWT]"),

    PiiPattern({ it.emails },       """\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b""", "[REDACTED_EMAIL]"),
    PiiPattern({ it.phones },       """(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b""", "[REDACTED_PHONE]"),
    PiiPattern({ it.ipAddresses },  """\b(?:\d{1,3}\.){3}\d{1,3}\b""",                "[REDACTED_IP]"),
    PiiPattern({ it.ipv6 },         """\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\b""", "[REDACTED_IPV6]"),
)

/** A compiled PII scrubber. Create once; [scrub] is thread-safe. */
class PIIScrubber(config: PIIScrubberConfig = PIIScrubberConfig()) {
    private val active: List<Pair<Regex, String>> = ORDERED_PATTERNS.mapNotNull { p ->
        if (!p.enabled(config)) return@mapNotNull null
        val opts = if (p.caseInsensitive) setOf(RegexOption.IGNORE_CASE) else emptySet()
        Regex(p.pattern, opts) to p.replacement
    }

    /** Replace all recognised PII patterns in [text] with redaction tokens. */
    fun scrub(text: String): String {
        if (text.isEmpty()) return text
        var result = text
        for ((re, replacement) in active) {
            result = re.replace(result, replacement)
        }
        return result
    }

    /** Scrub the string value of specific [keys] in a map without touching other keys. */
    fun scrubKeys(keys: List<String>, map: Map<String, Any?>): Map<String, Any?> =
        map.mapValues { (k, v) -> if (k in keys && v is String) scrub(v) else v }
}

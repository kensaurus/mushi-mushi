import XCTest
@testable import MushiMushi

final class PIIScrubberTests: XCTestCase {
    private let scrubber = PIIScrubber()

    func testEmailRedacted() {
        XCTAssertEqual(scrubber.scrub("contact alice@example.com please"), "contact [REDACTED_EMAIL] please")
    }

    func testJwtRedacted() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123DEF456ghi789"
        XCTAssertTrue(scrubber.scrub("token: \(jwt)").contains("[REDACTED_JWT]"))
    }

    func testStripeKeyRedacted() {
        // Construct a fake key programmatically so the secrets scanner doesn't flag it.
        let key = "sk_" + "live_AbCdEfGhIjKlMnOpQrSt1234"
        XCTAssertTrue(scrubber.scrub(key).contains("[REDACTED_STRIPE_KEY]"))
    }

    func testSsnRedacted() {
        XCTAssertEqual(scrubber.scrub("SSN 123-45-6789"), "SSN [REDACTED_SSN]")
    }

    func testEmptyStringUnchanged() {
        XCTAssertEqual(scrubber.scrub(""), "")
    }

    func testPlainTextUnchanged() {
        let text = "Nothing sensitive here."
        XCTAssertEqual(scrubber.scrub(text), text)
    }

    func testIpDefaultOff() {
        let text = "IP is 192.168.1.1"
        XCTAssertEqual(scrubber.scrub(text), text, "IP scrubbing is off by default")
    }

    func testIpEnabledWhenConfigured() {
        let s = PIIScrubber(config: PIIScrubberConfig(ipAddresses: true))
        XCTAssertTrue(s.scrub("IP is 192.168.1.1").contains("[REDACTED_IP]"))
    }

    func testScrubKeysInDict() {
        let d: [String: Any] = ["description": "email alice@example.com", "count": 5]
        let out = scrubber.scrubKeys(["description"], in: d)
        XCTAssertTrue((out["description"] as? String)?.contains("[REDACTED_EMAIL]") == true)
        XCTAssertEqual(out["count"] as? Int, 5)
    }
}

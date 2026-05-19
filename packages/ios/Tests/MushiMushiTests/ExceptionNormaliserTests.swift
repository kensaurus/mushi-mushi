import XCTest
@testable import MushiMushi

final class ExceptionNormaliserTests: XCTestCase {
    private struct TestError: LocalizedError {
        let errorDescription: String?
        init(_ msg: String) { self.errorDescription = msg }
    }

    func testNormalisesLocalizedError() {
        let err = TestError("connection timed out")
        let norm = normaliseError(err)
        XCTAssertEqual(norm.message, "connection timed out")
        XCTAssertFalse(norm.name.isEmpty)
    }

    func testStackIsPresent() {
        let norm = normaliseError(TestError("oops"))
        XCTAssertNotNil(norm.stack, "Stack trace should be captured at normalisation call site")
    }

    func testNormalisesNSError() {
        let err = NSError(domain: "TestDomain", code: 42, userInfo: [NSLocalizedDescriptionKey: "disk full"])
        let norm = normaliseError(err)
        XCTAssertEqual(norm.message, "disk full")
    }

    func testMetadataShape() {
        let norm = NormalisedException(name: "MyError", message: "bad state", stack: "at Foo.bar()")
        let meta = normaliseExceptionToMetadata(norm)
        XCTAssertEqual(meta["type"] as? String, "MyError")
        XCTAssertEqual(meta["message"] as? String, "bad state")
        XCTAssertEqual(meta["stack"] as? String, "at Foo.bar()")
    }

    func testMetadataNilStackOmitted() {
        let norm = NormalisedException(name: "Err", message: "msg")
        let meta = normaliseExceptionToMetadata(norm)
        XCTAssertNil(meta["stack"])
        XCTAssertNil(meta["cause"])
    }
}

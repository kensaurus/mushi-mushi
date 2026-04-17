import XCTest
@testable import MushiMushi

final class OfflineQueueTests: XCTestCase {
    private var tmpDir: URL!

    override func setUp() {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("mushi-tests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    func testEnqueuePeekClear() {
        let q = OfflineQueue(maxBytes: 100_000, directory: tmpDir)
        q.enqueue(["description": "hello", "category": "bug"])
        q.enqueue(["description": "world", "category": "slow"])
        XCTAssertEqual(q.count, 2)

        let peeked = q.peek(limit: 10)
        XCTAssertEqual(peeked.count, 2)
        XCTAssertEqual(peeked.first?["description"] as? String, "hello")

        q.clearDelivered(count: 1)
        XCTAssertEqual(q.count, 1)
        XCTAssertEqual(q.peek(limit: 10).first?["description"] as? String, "world")
    }

    func testTrimsOldestWhenOverBudget() {
        // Cap at ~250 bytes; each report serialized is roughly ~80 bytes.
        let q = OfflineQueue(maxBytes: 250, directory: tmpDir)
        for i in 0..<10 {
            q.enqueue(["description": "report-\(i)", "category": "bug"])
        }
        XCTAssertLessThanOrEqual(q.count, 4)
    }
}

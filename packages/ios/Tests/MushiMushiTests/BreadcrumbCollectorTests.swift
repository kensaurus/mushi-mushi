import XCTest
@testable import MushiMushi

final class BreadcrumbCollectorTests: XCTestCase {
    func testAddAndGetAll() {
        let bc = BreadcrumbCollector(max: 5)
        bc.add(category: .lifecycle, message: "init")
        bc.add(category: .uiTap, message: "button tap")
        let all = bc.getAll()
        XCTAssertEqual(all.count, 2)
        XCTAssertEqual(all[0].message, "init")
        XCTAssertEqual(all[1].category, .uiTap)
    }

    func testRingBufferEvictsOldest() {
        let bc = BreadcrumbCollector(max: 3)
        bc.add(category: .custom, message: "a")
        bc.add(category: .custom, message: "b")
        bc.add(category: .custom, message: "c")
        bc.add(category: .custom, message: "d")
        let all = bc.getAll()
        XCTAssertEqual(all.count, 3)
        XCTAssertEqual(all[0].message, "b")
        XCTAssertEqual(all[2].message, "d")
    }

    func testMessageTruncatedAtMaxLength() {
        let bc = BreadcrumbCollector(max: 50, maxMessageLength: 10)
        bc.add(category: .console, message: "12345678901234567890")
        XCTAssertEqual(bc.getAll().first?.message, "1234567890…")
    }

    func testClearEmptiesBuffer() {
        let bc = BreadcrumbCollector(max: 50)
        bc.add(category: .navigation, message: "nav")
        bc.clear()
        XCTAssertEqual(bc.count, 0)
    }

    func testGetAllReturnsACopy() {
        let bc = BreadcrumbCollector(max: 50)
        bc.add(category: .lifecycle, message: "one")
        var snapshot = bc.getAll()
        snapshot.removeAll()
        XCTAssertEqual(bc.count, 1, "Mutating the snapshot must not affect the internal buffer")
    }

    func testLevelDefaultsToInfo() {
        let bc = BreadcrumbCollector()
        bc.add(category: .custom, message: "x")
        XCTAssertEqual(bc.getAll().first?.level, .info)
    }
}

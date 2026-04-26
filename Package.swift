// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MushiMushi",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
        .tvOS(.v15)
    ],
    products: [
        .library(name: "MushiMushi", targets: ["MushiMushi"])
    ],
    targets: [
        .target(
            name: "MushiMushi",
            path: "packages/ios/Sources/MushiMushi"
        ),
        .testTarget(
            name: "MushiMushiTests",
            dependencies: ["MushiMushi"],
            path: "packages/ios/Tests/MushiMushiTests"
        )
    ]
)

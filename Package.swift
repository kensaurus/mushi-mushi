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
        .library(name: "MushiMushi", targets: ["MushiMushi"]),
        .library(name: "MushiMushiSentry", targets: ["MushiMushiSentry"])
    ],
    dependencies: [
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "MushiMushi",
            path: "packages/ios/Sources/MushiMushi"
        ),
        .target(
            name: "MushiMushiSentry",
            dependencies: [
                "MushiMushi",
                .product(name: "Sentry", package: "sentry-cocoa")
            ],
            path: "packages/ios/Sources/MushiMushiSentry"
        ),
        .testTarget(
            name: "MushiMushiTests",
            dependencies: ["MushiMushi"],
            path: "packages/ios/Tests/MushiMushiTests"
        )
    ]
)

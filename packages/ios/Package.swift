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
        // Optional Sentry bridge — pulls in `sentry-cocoa` so reports captured
        // by Mushi are also routed to Sentry's UserFeedback channel and the
        // Sentry breadcrumb trail is attached to every Mushi report. Consumers
        // who don't use Sentry should keep depending on `MushiMushi` only.
        .library(name: "MushiMushiSentry", targets: ["MushiMushiSentry"])
    ],
    dependencies: [
        // Pinned to a major; Sentry follows SemVer and ships breaking changes
        // only on majors. Bumping the upper bound is a Wave-D housekeeping task.
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "MushiMushi",
            path: "Sources/MushiMushi"
        ),
        .target(
            name: "MushiMushiSentry",
            dependencies: [
                "MushiMushi",
                .product(name: "Sentry", package: "sentry-cocoa")
            ],
            path: "Sources/MushiMushiSentry"
        ),
        .testTarget(
            name: "MushiMushiTests",
            dependencies: ["MushiMushi"],
            path: "Tests/MushiMushiTests"
        )
    ]
)

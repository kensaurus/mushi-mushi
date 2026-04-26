// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MushiMushiCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "MushiMushiCapacitor", targets: ["MushiMushiCapacitor"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "MushiMushi",
            path: "ios/MushiMushi/Sources/MushiMushi"
        ),
        .target(
            name: "MushiMushiCapacitor",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                "MushiMushi"
            ],
            path: "ios/Plugin",
            sources: ["MushiMushiPlugin.swift"]
        )
    ]
)

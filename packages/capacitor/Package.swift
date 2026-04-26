// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MushiMushiCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "MushiMushiCapacitor", targets: ["MushiMushiCapacitor"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.0.0"),
        .package(url: "https://github.com/kensaurus/mushi-mushi.git", branch: "main")
    ],
    targets: [
        .target(
            name: "MushiMushiCapacitor",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "MushiMushi", package: "mushi-mushi")
            ],
            path: "ios/Plugin",
            sources: ["MushiMushiPlugin.swift"]
        )
    ]
)

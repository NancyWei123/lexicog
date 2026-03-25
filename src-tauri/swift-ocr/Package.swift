// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SwiftOCR",
    platforms: [.macOS(.v10_15)],
    products: [
        .library(name: "SwiftOCR", type: .static, targets: ["SwiftOCR"]),
    ],
    targets: [
        .target(
            name: "SwiftOCR",
            path: "Sources/SwiftOCR",
            publicHeadersPath: "include"   // 相对于 Sources/SwiftOCR
        ),
    ]
)

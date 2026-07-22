// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexMicroVirtualLab",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "CodexMicroVirtualLab", targets: ["CodexMicroVirtualLab"]),
    ],
    targets: [
        .target(name: "CodexMicroVirtualLabCore"),
        .executableTarget(
            name: "CodexMicroVirtualLab",
            dependencies: ["CodexMicroVirtualLabCore"]
        ),
        .testTarget(
            name: "CodexMicroVirtualLabCoreTests",
            dependencies: ["CodexMicroVirtualLabCore"]
        ),
    ]
)

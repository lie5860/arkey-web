// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ArkeyMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ArkeyMac", targets: ["ArkeyMac"])],
    dependencies: [
        .package(url: "https://github.com/MrKai77/DynamicNotchKit", revision: "cd0b3e52d537db115ad3a9d89601f20e0bee8d27")
    ],
    targets: [
        .executableTarget(
            name: "ArkeyMac",
            dependencies: ["DynamicNotchKit"],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "ArkeyMacTests",
            dependencies: ["ArkeyMac"]
        )
    ]
)

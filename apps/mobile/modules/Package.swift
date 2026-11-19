// swift-tools-version:6.0
// Plain-Swift logic of the native modules, tested on the Mac with `swift test` (no simulator needed).
// The pods compile the same Core files; Tests are excluded from the pods.
import PackageDescription

let package = Package(
  name: "WaypointNativeCore",
  platforms: [.macOS(.v15)],
  targets: [
    .target(name: "AudioCore", path: "waypoint-audio/ios/Core"),
    .testTarget(name: "AudioCoreTests", dependencies: ["AudioCore"], path: "waypoint-audio/ios/Tests"),
  ]
)

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
    .target(name: "PagesCore", path: "waypoint-pages/ios/Core"),
    .testTarget(name: "PagesCoreTests", dependencies: ["PagesCore"], path: "waypoint-pages/ios/Tests"),
    .target(name: "KeysCore", path: "waypoint-keys/ios/Core"),
    .testTarget(name: "KeysCoreTests", dependencies: ["KeysCore"], path: "waypoint-keys/ios/Tests"),
    .target(name: "VoicesCore", path: "waypoint-voices/ios/Core"),
    .testTarget(name: "VoicesCoreTests", dependencies: ["VoicesCore"], path: "waypoint-voices/ios/Tests"),
    .target(name: "VideoCore", path: "waypoint-video/ios/Core"),
    .testTarget(name: "VideoCoreTests", dependencies: ["VideoCore"], path: "waypoint-video/ios/Tests"),
  ]
)

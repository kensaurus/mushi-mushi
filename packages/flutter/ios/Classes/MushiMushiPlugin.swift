import Flutter
import UIKit

/// Flutter plugin scaffolding for iOS. Mirrors the Android plugin: the Dart
/// side does the heavy lifting today, this channel exists for future
/// native-only capabilities (e.g. native screenshot capture, share sheet
/// integration) without breaking the pub.dev contract.
public class MushiMushiPlugin: NSObject, FlutterPlugin {
    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(
            name: "dev.mushimushi.flutter",
            binaryMessenger: registrar.messenger())
        let instance = MushiMushiPlugin()
        registrar.addMethodCallDelegate(instance, channel: channel)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "ping":
            result("pong")
        default:
            result(FlutterMethodNotImplemented)
        }
    }
}

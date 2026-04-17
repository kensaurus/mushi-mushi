package dev.mushimushi.flutter

import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result

/**
 * Flutter plugin scaffolding. The Dart side currently does all the heavy
 * lifting (HTTP, queue, screenshot via RepaintBoundary, shake via
 * sensors_plus). This plugin reserves the `dev.mushimushi.flutter` channel
 * for future native-only capabilities (eg. native screenshot capture, share
 * sheet integration, or native widgets) without breaking the published
 * pub.dev contract.
 */
class MushiMushiPlugin : FlutterPlugin, MethodCallHandler {
    private lateinit var channel: MethodChannel

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel = MethodChannel(binding.binaryMessenger, "dev.mushimushi.flutter")
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        when (call.method) {
            "ping" -> result.success("pong")
            else -> result.notImplemented()
        }
    }
}

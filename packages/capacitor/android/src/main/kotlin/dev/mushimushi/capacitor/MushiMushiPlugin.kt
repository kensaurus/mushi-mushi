package dev.mushimushi.capacitor

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import dev.mushimushi.sdk.Mushi
import dev.mushimushi.sdk.config.MushiConfig
import dev.mushimushi.sdk.config.Theme
import dev.mushimushi.sdk.config.TriggerMode

/**
 * Capacitor Android plugin. Delegates to the standalone `mushi-android`
 * library so behaviour, queue, and shake handling are shared with native
 * consumers — single code path = single audit surface.
 */
@CapacitorPlugin(name = "MushiMushi")
class MushiMushiPlugin : Plugin() {

    private var configured = false

    @PluginMethod
    fun configure(call: PluginCall) {
        val projectId = call.getString("projectId")
        val apiKey = call.getString("apiKey")
        if (projectId.isNullOrBlank() || apiKey.isNullOrBlank()) {
            call.reject("projectId and apiKey are required"); return
        }
        val themeObj = call.getObject("theme")
        val theme = Theme(
            accentColor = themeObj?.optString("accentColor", "#22C55E") ?: "#22C55E",
            dark = themeObj?.optBoolean("dark", false) ?: false
        )
        val triggerMode = when (call.getString("triggerMode", "shake")) {
            "button" -> TriggerMode.BUTTON
            "both" -> TriggerMode.BOTH
            "none" -> TriggerMode.NONE
            else -> TriggerMode.SHAKE
        }

        val config = MushiConfig(
            projectId = projectId,
            apiKey = apiKey,
            endpoint = call.getString("endpoint", MushiConfig.DEFAULT_ENDPOINT)
                ?: MushiConfig.DEFAULT_ENDPOINT,
            triggerMode = triggerMode,
            captureScreenshot = call.getBoolean("captureScreenshot", true) ?: true,
            minDescriptionLength = call.getInt("minDescriptionLength", 20) ?: 20,
            theme = theme
        )
        Mushi.init(activity.application, config)

        Mushi.onReportSubmitted = { payload ->
            val data = JSObject()
            payload.forEach { (k, v) -> data.put(k, v) }
            notifyListeners("reportSubmitted", data)
        }
        configured = true
        call.resolve()
    }

    @PluginMethod
    fun report(call: PluginCall) {
        if (!configured) { call.reject("Not configured"); return }
        val description = call.getString("description")
            ?: return call.reject("description is required")
        val category = call.getString("category", "bug") ?: "bug"
        val metadataJs = call.getObject("metadata")
        val metadata = metadataJs?.let { js ->
            buildMap<String, Any?> {
                js.keys().forEachRemaining { k -> put(k, js.opt(k)) }
            }
        }
        Mushi.report(description = description, category = category, metadata = metadata)
        val res = JSObject().apply { put("accepted", true) }
        call.resolve(res)
    }

    @PluginMethod
    fun captureScreenshot(call: PluginCall) {
        // Native screenshot capture is performed implicitly when a report is
        // submitted; we don't expose a direct capture call from Java because
        // Activity context isn't safe to leak.
        val res = JSObject().apply { put("image", JSObject.NULL) }
        call.resolve(res)
    }

    @PluginMethod
    fun showWidget(call: PluginCall) {
        Mushi.showWidget(
            category = call.getString("category"),
            metadata = call.getObject("metadata")?.toMap()
        )
        call.resolve()
    }

    @PluginMethod
    fun setUser(call: PluginCall) {
        Mushi.setUser(call.getObject("user")?.toMap())
        call.resolve()
    }

    @PluginMethod
    fun setMetadata(call: PluginCall) {
        val key = call.getString("key")
            ?: return call.reject("key is required")
        Mushi.setMetadata(key, call.data.opt("value"))
        call.resolve()
    }

    @PluginMethod
    fun flushQueue(call: PluginCall) {
        // Native SDK auto-flushes on a 30s timer; this stub keeps the JS
        // contract symmetric across iOS/Android.
        val res = JSObject().apply { put("delivered", 0) }
        call.resolve(res)
    }

    private fun JSObject.toMap(): Map<String, Any?> = buildMap {
        keys().forEachRemaining { key -> put(key, opt(key)) }
    }
}

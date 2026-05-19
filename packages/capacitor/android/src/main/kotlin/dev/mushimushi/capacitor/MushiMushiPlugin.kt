package dev.mushimushi.capacitor

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import dev.mushimushi.sdk.Mushi
import dev.mushimushi.sdk.config.MushiConfig
import dev.mushimushi.sdk.config.Theme
import dev.mushimushi.sdk.config.TriggerInset
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
        val triggerInsetObj = call.getObject("triggerInset")
        val presetBottom = if (call.getString("triggerInsetPreset") == "tabBarSafe") 72 else 96
        val triggerInset = TriggerInset(
            bottomDp = triggerInsetObj?.optInt("bottom", presetBottom) ?: presetBottom,
            startDp = triggerInsetObj?.takeIf { it.has("start") }?.optInt("start"),
            endDp = triggerInsetObj?.takeIf { it.has("end") }?.optInt("end", 20) ?: 20
        )

        val config = MushiConfig(
            projectId = projectId,
            apiKey = apiKey,
            endpoint = call.getString("endpoint", MushiConfig.DEFAULT_ENDPOINT)
                ?: MushiConfig.DEFAULT_ENDPOINT,
            triggerMode = triggerMode,
            captureScreenshot = call.getBoolean("captureScreenshot", true) ?: true,
            minDescriptionLength = call.getInt("minDescriptionLength", 20) ?: 20,
            theme = theme,
            triggerInset = triggerInset
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

    @PluginMethod
    fun addBreadcrumb(call: PluginCall) {
        val message = call.getString("message")
            ?: return call.reject("message is required")
        val category = when (call.getString("category", "custom")) {
            "navigation" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.NAVIGATION
            "ui.tap" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.UI_TAP
            "console" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.CONSOLE
            "network" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.NETWORK
            "lifecycle" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.LIFECYCLE
            else -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Category.CUSTOM
        }
        val level = when (call.getString("level", "info")) {
            "debug" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Level.DEBUG
            "warning" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Level.WARNING
            "error" -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Level.ERROR
            else -> dev.mushimushi.sdk.capture.MushiBreadcrumb.Level.INFO
        }
        val dataJs = call.getObject("data")
        val data: Map<String, String>? = dataJs?.let { js ->
            buildMap { js.keys().forEachRemaining { k -> put(k, js.optString(k)) } }
        }
        Mushi.addBreadcrumb(category = category, level = level, message = message, data = data)
        call.resolve()
    }

    @PluginMethod
    fun getBreadcrumbs(call: PluginCall) {
        val arr = com.getcapacitor.JSArray()
        Mushi.getBreadcrumbs().forEach { crumb ->
            val obj = JSObject().apply {
                put("timestamp", crumb.timestamp)
                put("category", crumb.category.wire)
                put("level", crumb.level.wire)
                put("message", crumb.message)
                crumb.data?.let { data ->
                    val dataObj = JSObject()
                    data.forEach { (k, v) -> dataObj.put(k, v) }
                    put("data", dataObj)
                }
            }
            arr.put(obj)
        }
        val res = JSObject().apply { put("breadcrumbs", arr) }
        call.resolve(res)
    }

    private fun JSObject.toMap(): Map<String, Any?> = buildMap {
        keys().forEachRemaining { key -> put(key, opt(key)) }
    }
}

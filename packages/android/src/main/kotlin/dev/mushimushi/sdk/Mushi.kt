package dev.mushimushi.sdk

import android.app.Activity
import android.app.Application
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import dev.mushimushi.sdk.capture.DeviceContext
import dev.mushimushi.sdk.capture.ScreenshotCapture
import dev.mushimushi.sdk.capture.ShakeDetector
import dev.mushimushi.sdk.config.MushiConfig
import dev.mushimushi.sdk.config.TriggerMode
import dev.mushimushi.sdk.network.ApiClient
import dev.mushimushi.sdk.storage.OfflineQueue
import dev.mushimushi.sdk.widget.MushiBottomSheet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Public entry point for the Android SDK. Mirrors the surface of the iOS
 * `Mushi` and the JS `@mushi-mushi/core` SDK so cross-platform docs stay
 * accurate. Thread-safe; safe to call from any thread.
 */
object Mushi {
    @Volatile private var initialized = false
    @Volatile private var config: MushiConfig? = null
    private var queue: OfflineQueue? = null
    private var apiClient: ApiClient? = null
    private var shakeDetector: ShakeDetector? = null
    private var currentActivity: Activity? = null
    private var floatingButton: View? = null
    private var floatingButtonOwner: Activity? = null
    private var flushExecutor: ScheduledExecutorService? = null
    private var lifecycleRegistered = false
    private var user: Map<String, Any?>? = null
    private val globalMetadata = mutableMapOf<String, Any?>()

    /** Listener fired after every successful report submission. Used by the
     *  optional Sentry bridge to mirror reports into Sentry's UserFeedback. */
    @Volatile var onReportSubmitted: ((Map<String, Any?>) -> Unit)? = null

    fun init(app: Application, config: MushiConfig) {
        synchronized(this) {
            this.config = config
            val q = queue ?: OfflineQueue(app, config.offlineQueueMaxBytes)
            this.queue = q
            this.apiClient = ApiClient(config, q) { payload ->
                onReportSubmitted?.invoke(payload)
            }

            if (!lifecycleRegistered) {
                app.registerActivityLifecycleCallbacks(LifecycleTracker())
                lifecycleRegistered = true
            }
            refreshTriggers(app)
            refreshFloatingButton()
            if (!initialized) startFlushTimer()
            initialized = true
        }
    }

    fun setUser(user: Map<String, Any?>?) {
        synchronized(this) {
            this.user = user
        }
    }

    fun setMetadata(key: String, value: Any?) {
        synchronized(this) {
            if (value == null) {
                globalMetadata.remove(key)
            } else {
                globalMetadata[key] = value
            }
        }
    }

    fun setHidden(hidden: Boolean) {
        if (hidden) removeFloatingButton() else refreshFloatingButton()
    }

    fun attachTo(view: View) {
        view.setOnClickListener { showWidget() }
    }

    /** Submit a report. Auto-attaches device context and (if enabled) a screenshot. */
    fun report(
        description: String,
        category: String = "bug",
        metadata: Map<String, Any?>? = null
    ) {
        val cfg = config ?: return
        val client = apiClient ?: return
        val ctx = currentActivity?.applicationContext ?: return

        val payload = mutableMapOf<String, Any?>(
            "description" to description,
            "category" to category,
            "context" to DeviceContext.capture(ctx)
        )
        mergeMetadata(metadata).takeIf { it.isNotEmpty() }?.let { payload["metadata"] = it }

        if (cfg.captureScreenshot) {
            currentActivity?.let { act ->
                ScreenshotCapture.captureBase64(act)?.let { payload["screenshot"] = it }
            }
        }
        client.submitReport(payload)
    }

    fun captureError(throwable: Throwable, metadata: Map<String, Any?>? = null) {
        val meta = (metadata ?: emptyMap()).toMutableMap()
        meta["errorType"] = throwable.javaClass.name
        meta["stackTrace"] = throwable.stackTraceToString().take(8_000)
        report(
            description = throwable.message ?: throwable.javaClass.simpleName,
            category = "bug",
            metadata = meta
        )
    }

    /** Programmatically present the bottom-sheet widget. */
    fun showWidget(category: String? = null, metadata: Map<String, Any?>? = null) {
        val cfg = config ?: return
        val act = currentActivity as? FragmentActivity ?: return
        val screenshot = if (cfg.captureScreenshot) ScreenshotCapture.captureBase64(act) else null
        MushiBottomSheet().apply {
            this.config = cfg
            this.attachedScreenshot = screenshot
            this.initialCategory = category
            this.onSubmit = { payload ->
                val full = payload.toMutableMap().apply {
                    put("context", DeviceContext.capture(act.applicationContext))
                    mergeMetadata(metadata).takeIf { it.isNotEmpty() }?.let { put("metadata", it) }
                }
                apiClient?.submitReport(full)
            }
        }.show(act.supportFragmentManager, "mushi-bottom-sheet")
    }

    private fun mergeMetadata(metadata: Map<String, Any?>?): Map<String, Any?> = synchronized(this) {
        buildMap {
            putAll(globalMetadata)
            metadata?.let { putAll(it) }
            user?.let { put("user", it) }
        }
    }

    private fun refreshTriggers(app: Application) {
        val cfg = config ?: return
        shakeDetector?.stop()
        shakeDetector = null
        if (cfg.triggerMode == TriggerMode.SHAKE || cfg.triggerMode == TriggerMode.BOTH) {
            shakeDetector = ShakeDetector(app) { showWidget() }.also { it.start() }
        }
    }

    private fun refreshFloatingButton() {
        removeFloatingButton()
        currentActivity?.let { installButtonIfNeeded(it) }
    }

    private fun installButtonIfNeeded(activity: Activity) {
        val cfg = config ?: return
        if (cfg.triggerMode != TriggerMode.BUTTON && cfg.triggerMode != TriggerMode.BOTH) return
        if (floatingButton?.parent != null && floatingButtonOwner === activity) return
        removeFloatingButton()

        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        val accent = runCatching { Color.parseColor(cfg.theme.accentColor) }.getOrDefault(Color.parseColor("#22C55E"))
        val button = TextView(activity).apply {
            text = "\uD83D\uDC1B"
            textSize = 22f
            gravity = Gravity.CENTER
            contentDescription = "Report a bug"
            elevation = 18f
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = 28f
                setColor(if (cfg.theme.dark) Color.BLACK else Color.WHITE)
                setStroke(2, accent)
            }
            setOnClickListener { showWidget() }
        }
        val density = activity.resources.displayMetrics.density
        val size = (56 * density).toInt()
        val inset = cfg.triggerInset
        val marginStart = ((inset.startDp ?: 20) * density).toInt()
        val marginEnd = ((inset.endDp ?: 20) * density).toInt()
        val bottom = (inset.bottomDp * density).toInt()
        root.addView(button, FrameLayout.LayoutParams(size, size).apply {
            gravity = Gravity.BOTTOM or if (inset.startDp != null) Gravity.START else Gravity.END
            setMargins(marginStart, marginStart, marginEnd, bottom)
        })
        floatingButton = button
        floatingButtonOwner = activity
    }

    private fun removeFloatingButton() {
        (floatingButton?.parent as? ViewGroup)?.removeView(floatingButton)
        floatingButton = null
        floatingButtonOwner = null
    }

    private fun startFlushTimer() {
        flushExecutor?.shutdownNow()
        flushExecutor = Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "mushi-flush").apply { isDaemon = true }
        }.also { ex ->
            ex.scheduleWithFixedDelay({
                runCatching { apiClient?.flushQueue() }
            }, 5, 30, TimeUnit.SECONDS)
        }
    }

    private class LifecycleTracker : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) {
            currentActivity = activity
            installButtonIfNeeded(activity)
        }
        override fun onActivityResumed(activity: Activity) {
            currentActivity = activity
            installButtonIfNeeded(activity)
        }
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) {
            if (floatingButtonOwner === activity) removeFloatingButton()
            if (currentActivity === activity) currentActivity = null
        }
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}

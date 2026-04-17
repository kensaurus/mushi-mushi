package dev.mushimushi.sdk

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
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
    private var flushExecutor: ScheduledExecutorService? = null

    /** Listener fired after every successful report submission. Used by the
     *  optional Sentry bridge to mirror reports into Sentry's UserFeedback. */
    @Volatile var onReportSubmitted: ((Map<String, Any?>) -> Unit)? = null

    fun init(app: Application, config: MushiConfig) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            this.config = config
            val q = OfflineQueue(app, config.offlineQueueMaxBytes)
            this.queue = q
            this.apiClient = ApiClient(config, q) { payload ->
                onReportSubmitted?.invoke(payload)
            }

            app.registerActivityLifecycleCallbacks(LifecycleTracker())
            installShakeIfNeeded(app)
            startFlushTimer()
            initialized = true
        }
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
        metadata?.let { payload["metadata"] = it }

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
    fun showWidget() {
        val cfg = config ?: return
        val act = currentActivity as? FragmentActivity ?: return
        val screenshot = if (cfg.captureScreenshot) ScreenshotCapture.captureBase64(act) else null
        MushiBottomSheet().apply {
            this.config = cfg
            this.attachedScreenshot = screenshot
            this.onSubmit = { payload ->
                val full = payload.toMutableMap().apply {
                    put("context", DeviceContext.capture(act.applicationContext))
                }
                apiClient?.submitReport(full)
            }
        }.show(act.supportFragmentManager, "mushi-bottom-sheet")
    }

    private fun installShakeIfNeeded(app: Application) {
        val cfg = config ?: return
        if (cfg.triggerMode == TriggerMode.SHAKE || cfg.triggerMode == TriggerMode.BOTH) {
            shakeDetector = ShakeDetector(app) { showWidget() }.also { it.start() }
        }
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
        override fun onActivityStarted(activity: Activity) { currentActivity = activity }
        override fun onActivityResumed(activity: Activity) { currentActivity = activity }
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) {
            if (currentActivity === activity) currentActivity = null
        }
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}

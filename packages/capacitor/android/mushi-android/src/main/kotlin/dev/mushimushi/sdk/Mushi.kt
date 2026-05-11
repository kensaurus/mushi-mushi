package dev.mushimushi.sdk

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import dev.mushimushi.sdk.capture.BreadcrumbCollector
import dev.mushimushi.sdk.capture.DeviceContext
import dev.mushimushi.sdk.capture.MushiBreadcrumb
import dev.mushimushi.sdk.capture.ScreenshotCapture
import dev.mushimushi.sdk.capture.ShakeDetector
import dev.mushimushi.sdk.capture.ExceptionNormaliser
import dev.mushimushi.sdk.capture.normaliseThrowable
import dev.mushimushi.sdk.capture.ProactiveDetector
import dev.mushimushi.sdk.config.MushiConfig
import dev.mushimushi.sdk.config.TriggerMode
import dev.mushimushi.sdk.network.ApiClient
import dev.mushimushi.sdk.pii.PIIScrubber
import dev.mushimushi.sdk.pii.PIIScrubberConfig
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
    private var proactiveDetector: ProactiveDetector? = null
    private var breadcrumbs = BreadcrumbCollector()
    private var piiScrubber = PIIScrubber()
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
            this.piiScrubber = PIIScrubber(PIIScrubberConfig(
                emails = config.pii.emails,
                phones = config.pii.phones,
                creditCards = config.pii.creditCards,
                ssns = config.pii.ssns,
                ipAddresses = config.pii.ipAddresses,
                secretTokens = config.pii.secretTokens,
                ipv6 = config.pii.ipv6,
            ))
            if (config.captureBreadcrumbs) breadcrumbs = BreadcrumbCollector()
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
            if (!initialized) {
                startFlushTimer()
                // Added: network-aware delivery (Phase 2.4)
                startNetworkMonitor(app)
            }
            initialized = true
            breadcrumbs.add(MushiBreadcrumb.Category.LIFECYCLE, message = "Mushi configured")
        }
    }

    fun setUser(user: Map<String, Any?>?) {
        synchronized(this) { this.user = user }
    }

    fun setMetadata(key: String, value: Any?) {
        synchronized(this) {
            if (value == null) globalMetadata.remove(key) else globalMetadata[key] = value
        }
    }

    /** Append a breadcrumb to the ring buffer. Mirrors `Mushi.addBreadcrumb()` in the web SDK. */
    fun addBreadcrumb(
        category: MushiBreadcrumb.Category,
        level: MushiBreadcrumb.Level = MushiBreadcrumb.Level.INFO,
        message: String,
        data: Map<String, String>? = null,
    ) = breadcrumbs.add(category, level, message, data)

    /** Snapshot of the current breadcrumb ring buffer, oldest first. */
    fun getBreadcrumbs(): List<MushiBreadcrumb> = breadcrumbs.getAll()

    fun setHidden(hidden: Boolean) {
        if (hidden) removeFloatingButton() else refreshFloatingButton()
    }

    fun attachTo(view: View) {
        view.setOnClickListener { showWidget() }
    }

    /** Submit a report. Auto-attaches device context, breadcrumbs (PII-scrubbed), and screenshot. */
    fun report(
        description: String,
        category: String = "bug",
        metadata: Map<String, Any?>? = null
    ) {
        val cfg = config ?: return
        val client = apiClient ?: return
        val ctx = currentActivity?.applicationContext ?: return

        val scrubbedDescription = piiScrubber.scrub(description)
        val payload = mutableMapOf<String, Any?>(
            "description" to scrubbedDescription,
            "category" to category,
            "context" to DeviceContext.capture(ctx)
        )
        mergeMetadata(metadata).takeIf { it.isNotEmpty() }?.let { payload["metadata"] = it }

        if (cfg.captureBreadcrumbs) {
            val crumbs = breadcrumbs.getAll().map { crumb ->
                crumb.toMap().toMutableMap().apply {
                    put("message", piiScrubber.scrub(crumb.message))
                    crumb.data?.let { put("data", it.mapValues { (_, v) -> piiScrubber.scrub(v) }) }
                }
            }
            if (crumbs.isNotEmpty()) payload["breadcrumbs"] = crumbs
        }

        breadcrumbs.add(MushiBreadcrumb.Category.LIFECYCLE, message = "report submitted: $category")

        if (cfg.captureScreenshot) {
            currentActivity?.let { act ->
                ScreenshotCapture.captureBase64(act)?.let { payload["screenshot"] = it }
            }
        }
        client.submitReport(payload)
    }

    fun captureError(throwable: Throwable, metadata: Map<String, Any?>? = null) {
        val norm = normaliseThrowable(throwable)
        val meta = (metadata ?: emptyMap()).toMutableMap()
        meta["error"] = norm.toMap()
        report(description = norm.message, category = "bug", metadata = meta)
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
        proactiveDetector?.destroy()
        proactiveDetector = null
        val pdConfig = ProactiveDetector.Config(
            rageTap = cfg.proactive.rageTap,
            slowScreen = cfg.proactive.slowScreen,
            slowScreenThresholdMs = cfg.proactive.slowScreenThresholdMs,
            maxPerSession = cfg.proactive.maxPerSession,
        )
        proactiveDetector = ProactiveDetector(pdConfig)
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

    // Added: network-aware delivery (Phase 2.4)
    private fun startNetworkMonitor(app: Application) {
        val connectivityManager =
            app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                flushExecutor?.execute { runCatching { apiClient?.flushQueue() } }
            }
        }
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
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
            proactiveDetector?.let { detector ->
                val window = activity.window ?: return@let
                detector.resetFrameClock()
                detector.install(window) { type, context ->
                    breadcrumbs.add(MushiBreadcrumb.Category.LIFECYCLE, MushiBreadcrumb.Level.WARNING,
                        "proactive:$type")
                    showWidget(category = "bug", metadata = mapOf(
                        "proactiveTrigger" to type,
                        "proactiveContext" to context,
                    ))
                }
            }
        }
        override fun onActivityPaused(activity: Activity) {
            if (currentActivity === activity) {
                proactiveDetector?.uninstall()
            }
        }
        override fun onActivityStopped(activity: Activity) {
            if (floatingButtonOwner === activity) removeFloatingButton()
            if (currentActivity === activity) currentActivity = null
        }
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}

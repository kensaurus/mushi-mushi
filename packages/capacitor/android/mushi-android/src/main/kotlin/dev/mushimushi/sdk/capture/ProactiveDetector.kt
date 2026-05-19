package dev.mushimushi.sdk.capture

import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.Window
import java.lang.ref.WeakReference

/**
 * Proactive trigger detection for Android. Mirrors `proactive-triggers.ts`
 * from the web SDK adapted for Android touch and frame budget:
 *
 * - **Rage-tap**: ≥3 `ACTION_DOWN` events on the same view within 500 ms.
 * - **Slow-screen**: a vsync frame that takes >200 ms, detected via
 *   [Choreographer.FrameCallback].
 *
 * Usage: call [install] once per resumed [android.app.Activity], passing the
 * activity's [Window]. Touch dispatch is observed via a [Window.Callback]
 * wrapper, leaving the host's `View.OnTouchListener` chain untouched. Always
 * call [uninstall] (or [destroy]) on `onPause`/`onDestroy` to drop the window
 * reference and stop the frame callback.
 */
class ProactiveDetector(private val config: Config = Config()) {

    data class Config(
        /** Enable rage-tap detection (≥3 taps on same view in 500 ms). */
        val rageTap: Boolean = true,
        /** Enable slow-screen detection (frame >200 ms). */
        val slowScreen: Boolean = true,
        /** Threshold in ms to flag a frame as slow. */
        val slowScreenThresholdMs: Long = 200L,
        /**
         * Frame deltas above this are discarded as "app was backgrounded";
         * Choreographer pauses while the app isn't visible and the first
         * resumed frame would otherwise look like a multi-second slow screen.
         */
        val maxRealFrameDeltaMs: Long = 2_000L,
        /** Max proactive triggers fired per session. */
        val maxPerSession: Int = 3,
    )

    fun interface TriggerCallback {
        fun onTrigger(type: String, context: Map<String, Any>)
    }

    private var callback: TriggerCallback? = null
    private var fired = 0

    // Rage-tap state — weak so we don't pin a destroyed Activity / View tree.
    private val tapTimes = mutableListOf<Long>()
    private var lastTapView: WeakReference<View>? = null

    // Slow-screen state
    private var choreographer: Choreographer? = null
    private var lastFrameNano: Long = 0L
    private var frameCallbackInstalled = false

    // Window-callback wrapper (chained, never replaces a host listener)
    private var windowRef: WeakReference<Window>? = null
    private var hostWindowCallback: Window.Callback? = null
    private var installedWindowCallback: Window.Callback? = null

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!frameCallbackInstalled) return
            if (fired < config.maxPerSession) {
                if (lastFrameNano > 0L) {
                    val deltaMs = (frameTimeNanos - lastFrameNano) / 1_000_000L
                    // Drop background-resumption deltas: Choreographer pauses
                    // off-screen and the first frame after foreground always
                    // looks like a slow screen otherwise.
                    if (deltaMs in (config.slowScreenThresholdMs + 1)..config.maxRealFrameDeltaMs) {
                        fire("slow_screen", mapOf("frameMs" to deltaMs))
                    }
                }
                lastFrameNano = frameTimeNanos
            }
            choreographer?.postFrameCallback(this)
        }
    }

    /**
     * Install on the given [Window]. Touches are observed by chaining the
     * window's existing [Window.Callback] (no `View.OnTouchListener` is
     * replaced). Idempotent per window — re-installing on the same window
     * is a no-op.
     *
     * Must be called on the main thread.
     */
    fun install(window: Window, callback: TriggerCallback) {
        this.callback = callback
        if (config.rageTap && windowRef?.get() !== window) {
            uninstallWindowCallback()
            val host = window.callback
            hostWindowCallback = host
            val wrapper = TouchObservingWindowCallback(host) { ev -> onDispatchTouch(ev) }
            window.callback = wrapper
            installedWindowCallback = wrapper
            windowRef = WeakReference(window)
        }
        if (config.slowScreen && !frameCallbackInstalled) {
            choreographer = Choreographer.getInstance()
            frameCallbackInstalled = true
            lastFrameNano = 0L
            choreographer?.postFrameCallback(frameCallback)
        }
    }

    /**
     * Drop the window reference and remove our chained callback if the host
     * hasn't already replaced it. Safe to call from `onPause`/`onStop`.
     */
    fun uninstall() {
        uninstallWindowCallback()
        windowRef = null
        lastTapView = null
        tapTimes.clear()
    }

    /**
     * Reset the slow-screen frame clock. Call from `onActivityResumed` so
     * the first post-foreground frame doesn't look like a multi-second
     * slow screen — Choreographer pauses while the app is backgrounded.
     */
    fun resetFrameClock() {
        lastFrameNano = 0L
    }

    fun destroy() {
        uninstall()
        callback = null
        choreographer?.removeFrameCallback(frameCallback)
        choreographer = null
        lastFrameNano = 0L
        frameCallbackInstalled = false
    }

    private fun uninstallWindowCallback() {
        val window = windowRef?.get() ?: return
        if (window.callback === installedWindowCallback) {
            window.callback = hostWindowCallback
        }
        installedWindowCallback = null
        hostWindowCallback = null
    }

    /** Called for every touch the host window dispatches. */
    private fun onDispatchTouch(event: MotionEvent) {
        if (event.action != MotionEvent.ACTION_DOWN) return
        if (fired >= config.maxPerSession) return
        val window = windowRef?.get() ?: return
        // Hit-test against the decor view to identify which view received the tap.
        val decor = window.decorView
        val hit = findHitView(decor, event.rawX.toInt(), event.rawY.toInt()) ?: decor
        recordTap(hit)
    }

    /** Internal hook used by the dispatch path AND by tests. */
    internal fun recordTap(view: View, now: Long = System.currentTimeMillis()) {
        if (fired >= config.maxPerSession) return
        val previous = lastTapView?.get()
        if (previous === view) {
            tapTimes.add(now)
            tapTimes.removeAll { now - it > 500L }
            if (tapTimes.size >= 3) {
                fire("rage_tap", mapOf(
                    "tapCount" to tapTimes.size,
                    "viewClass" to view.javaClass.simpleName,
                    "contentDescription" to (view.contentDescription?.toString() ?: ""),
                ))
                tapTimes.clear()
            }
        } else {
            lastTapView = WeakReference(view)
            tapTimes.clear()
            tapTimes.add(now)
        }
    }

    private fun findHitView(root: View, x: Int, y: Int): View? {
        if (root !is android.view.ViewGroup) return root
        val out = IntArray(2)
        for (i in (root.childCount - 1) downTo 0) {
            val child = root.getChildAt(i) ?: continue
            if (child.visibility != View.VISIBLE) continue
            child.getLocationOnScreen(out)
            val left = out[0]
            val top = out[1]
            val right = left + child.width
            val bottom = top + child.height
            if (x in left until right && y in top until bottom) {
                return findHitView(child, x, y) ?: child
            }
        }
        return root
    }

    private fun fire(type: String, context: Map<String, Any>) {
        fired++
        callback?.onTrigger(type, context)
    }
}

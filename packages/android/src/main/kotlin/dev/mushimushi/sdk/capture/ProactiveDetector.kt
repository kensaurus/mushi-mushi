package dev.mushimushi.sdk.capture

import android.view.Choreographer
import android.view.MotionEvent
import android.view.View

/**
 * Proactive trigger detection for Android. Mirrors `proactive-triggers.ts`
 * from the web SDK adapted for Android touch and frame budget:
 *
 * - **Rage-tap**: ≥3 `ACTION_DOWN` events on the same view within 500 ms.
 * - **Slow-screen**: a vsync frame that takes >200 ms, detected via
 *   [Choreographer.FrameCallback].
 *
 * Usage: call [install] once from [dev.mushimushi.sdk.Mushi.init], passing
 * the root [View] (e.g. `activity.window.decorView`).
 */
class ProactiveDetector(private val config: Config = Config()) {

    data class Config(
        /** Enable rage-tap detection (≥3 taps on same view in 500 ms). */
        val rageTap: Boolean = true,
        /** Enable slow-screen detection (frame >200 ms). */
        val slowScreen: Boolean = true,
        /** Threshold in ms to flag a frame as slow. */
        val slowScreenThresholdMs: Long = 200L,
        /** Max proactive triggers fired per session. */
        val maxPerSession: Int = 3,
    )

    fun interface TriggerCallback {
        fun onTrigger(type: String, context: Map<String, Any>)
    }

    private var callback: TriggerCallback? = null
    private var fired = 0

    // Rage-tap state
    private val tapTimes = mutableListOf<Long>()
    @Volatile private var lastTapView: View? = null

    // Slow-screen state
    private var choreographer: Choreographer? = null
    private var lastFrameNano: Long = 0L
    private var frameCallbackInstalled = false

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (fired < config.maxPerSession) {
                if (lastFrameNano > 0L) {
                    val deltaMs = (frameTimeNanos - lastFrameNano) / 1_000_000L
                    if (deltaMs > config.slowScreenThresholdMs) {
                        fire("slow_screen", mapOf("frameMs" to deltaMs))
                    }
                }
                lastFrameNano = frameTimeNanos
            }
            choreographer?.postFrameCallback(this)
        }
    }

    /**
     * Install on the root [View]. The [view]'s [View.OnTouchListener] is used
     * for rage-tap detection; an existing listener is chained rather than replaced.
     *
     * Must be called on the main thread.
     */
    fun install(view: View, callback: TriggerCallback) {
        this.callback = callback
        if (config.rageTap) {
            val existing = view.getTag(TAG_PREV_LISTENER) as? View.OnTouchListener
            view.setOnTouchListener { v, event ->
                onTouch(v, event)
                existing?.onTouch(v, event) ?: false
            }
            view.setTag(TAG_PREV_LISTENER, existing)
        }
        if (config.slowScreen && !frameCallbackInstalled) {
            choreographer = Choreographer.getInstance()
            choreographer?.postFrameCallback(frameCallback)
            frameCallbackInstalled = true
        }
    }

    fun destroy() {
        callback = null
        choreographer = null
        frameCallbackInstalled = false
    }

    private fun onTouch(view: View, event: MotionEvent) {
        if (event.action != MotionEvent.ACTION_DOWN) return
        if (fired >= config.maxPerSession) return
        val now = System.currentTimeMillis()
        if (view === lastTapView) {
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
            lastTapView = view
            tapTimes.clear()
            tapTimes.add(now)
        }
    }

    private fun fire(type: String, context: Map<String, Any>) {
        fired++
        callback?.onTrigger(type, context)
    }

    private companion object {
        val TAG_PREV_LISTENER = View.generateViewId()
    }
}

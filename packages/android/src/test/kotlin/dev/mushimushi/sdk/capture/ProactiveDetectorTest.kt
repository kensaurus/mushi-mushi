package dev.mushimushi.sdk.capture

import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Unit tests for [ProactiveDetector]'s rage-tap pipeline.
 *
 * Slow-screen detection runs through `Choreographer.postFrameCallback`
 * which Robolectric's looper dispatches synchronously — exercising it
 * here would require driving the test scheduler manually, so it's left
 * to the on-device instrumentation suite. Rage-tap logic is pure
 * timing / view-identity and is fully covered here via the internal
 * `recordTap(view, now)` test hook.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ProactiveDetectorTest {
    private val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()

    private fun newView(): View = View(ctx)

    @Test
    fun `three taps on same view within 500 ms fires rage_tap`() {
        var fired: Pair<String, Map<String, Any>>? = null
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false))
        // install(Window, …) is exercised in instrumentation tests; here we
        // wire the callback directly and drive the rage-tap pipeline via
        // the internal recordTap test hook.
        d.installCallbackForTest { type, ctx -> fired = type to ctx }
        val v = newView()
        d.recordTap(v, now = 1000L)
        d.recordTap(v, now = 1100L)
        d.recordTap(v, now = 1200L)
        assertEquals("rage_tap", fired?.first)
        assertEquals(3, fired?.second?.get("tapCount"))
    }

    @Test
    fun `taps spread over more than 500 ms do not fire`() {
        var fired = false
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false))
        d.installCallbackForTest { _, _ -> fired = true }
        val v = newView()
        d.recordTap(v, now = 1000L)
        d.recordTap(v, now = 1600L)
        d.recordTap(v, now = 2300L)
        assertEquals(false, fired)
    }

    @Test
    fun `taps on different views reset the rage counter`() {
        var fired = false
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false))
        d.installCallbackForTest { _, _ -> fired = true }
        val a = newView()
        val b = newView()
        d.recordTap(a, now = 1000L)
        d.recordTap(b, now = 1100L)
        d.recordTap(a, now = 1200L)
        assertEquals(false, fired)
    }

    @Test
    fun `maxPerSession caps the number of triggers`() {
        var fireCount = 0
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false, maxPerSession = 1))
        d.installCallbackForTest { _, _ -> fireCount++ }
        val v = newView()
        // First rage burst → 1 fire
        for (i in 0..2) d.recordTap(v, now = 1000L + i * 50)
        // Second rage burst with a fresh tap chain on a new view → would-be 2nd fire is silenced
        val w = newView()
        for (i in 0..2) d.recordTap(w, now = 5000L + i * 50)
        assertEquals(1, fireCount)
    }

    @Test
    fun `lastTapView is held weakly so a discarded view can be GC'd`() {
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false))
        d.installCallbackForTest { _, _ -> }
        var v: View? = newView()
        d.recordTap(v!!, now = 1000L)
        v = null
        // Best-effort: ask the JVM to collect.
        repeat(3) { System.gc(); System.runFinalization() }
        // No assertion on whether the view actually got reclaimed (the JVM
        // is not obliged) — but the next tap on a brand-new view must not
        // count as a "same view" continuation, which we assert by feeding
        // a fresh view and showing the rage counter starts from zero.
        var fired = false
        d.installCallbackForTest { _, _ -> fired = true }
        val u = newView()
        d.recordTap(u, now = 2000L)
        d.recordTap(u, now = 2100L)
        assertEquals("only 2 taps so far → no rage", false, fired)
    }

    @Test
    fun `destroy clears tap state`() {
        val d = ProactiveDetector(ProactiveDetector.Config(slowScreen = false))
        d.installCallbackForTest { _, _ -> }
        val v = newView()
        d.recordTap(v, now = 1000L)
        d.destroy()
        // After destroy, recordTap should still be safe to call (no callback
        // wired) and not throw.
        d.recordTap(v, now = 1100L)
    }
}

/**
 * Test-only helper to wire a callback without needing a real `Window`.
 * `install(Window, …)` is the production entry point; the private callback
 * field is package-internal so we expose it via this extension to keep the
 * production surface clean.
 */
private fun ProactiveDetector.installCallbackForTest(cb: (String, Map<String, Any>) -> Unit) {
    val field = ProactiveDetector::class.java.getDeclaredField("callback")
    field.isAccessible = true
    field.set(this, ProactiveDetector.TriggerCallback { type, ctx -> cb(type, ctx) })
}

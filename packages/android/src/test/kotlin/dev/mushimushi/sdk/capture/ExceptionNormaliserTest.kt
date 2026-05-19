package dev.mushimushi.sdk.capture

import org.junit.Assert.*
import org.junit.Test

class ExceptionNormaliserTest {
    @Test
    fun `normalises standard exception`() {
        val t = RuntimeException("connection failed")
        val norm = normaliseThrowable(t)
        assertEquals("connection failed", norm.message)
        assertTrue("name should contain class name", norm.name.contains("RuntimeException"))
    }

    @Test
    fun `stack trace is captured`() {
        val t = IllegalStateException("bad state")
        val norm = normaliseThrowable(t)
        assertNotNull("stack should not be null", norm.stack)
    }

    @Test
    fun `cause is unwrapped`() {
        val cause = RuntimeException("root cause")
        val outer = RuntimeException("outer", cause)
        val norm = normaliseThrowable(outer)
        assertEquals("root cause", norm.cause)
    }

    @Test
    fun `toMap contains required fields`() {
        val norm = NormalisedException(
            name = "MyError",
            message = "bad state",
            stack = "at Foo.bar(Foo.kt:12)",
        )
        val m = norm.toMap()
        assertEquals("MyError", m["type"])
        assertEquals("bad state", m["message"])
        assertEquals("at Foo.bar(Foo.kt:12)", m["stack"])
    }

    @Test
    fun `toMap omits null stack and cause`() {
        val norm = NormalisedException(name = "Err", message = "msg")
        val m = norm.toMap()
        assertFalse("stack should not be in map", m.containsKey("stack"))
        assertFalse("cause should not be in map", m.containsKey("cause"))
    }

    @Test
    fun `stack capped at 8 KB`() {
        val longMsg = "x".repeat(100_000)
        val t = RuntimeException(longMsg)
        val norm = normaliseThrowable(t)
        assertTrue((norm.stack?.length ?: 0) <= 8 * 1024)
    }
}

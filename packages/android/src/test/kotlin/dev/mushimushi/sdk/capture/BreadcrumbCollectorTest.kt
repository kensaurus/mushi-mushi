package dev.mushimushi.sdk.capture

import org.junit.Assert.*
import org.junit.Test

class BreadcrumbCollectorTest {
    @Test
    fun `add and getAll returns entries in insertion order`() {
        val bc = BreadcrumbCollector(max = 5)
        bc.add(MushiBreadcrumb.Category.LIFECYCLE, message = "init")
        bc.add(MushiBreadcrumb.Category.UI_TAP, message = "button tap")
        val all = bc.getAll()
        assertEquals(2, all.size)
        assertEquals("init", all[0].message)
        assertEquals(MushiBreadcrumb.Category.UI_TAP, all[1].category)
    }

    @Test
    fun `ring buffer evicts oldest entries when over cap`() {
        val bc = BreadcrumbCollector(max = 3)
        for (msg in listOf("a", "b", "c", "d")) bc.add(MushiBreadcrumb.Category.CUSTOM, message = msg)
        val all = bc.getAll()
        assertEquals(3, all.size)
        assertEquals("b", all[0].message)
        assertEquals("d", all[2].message)
    }

    @Test
    fun `message is truncated at maxMessageLength`() {
        val bc = BreadcrumbCollector(max = 50, maxMessageLength = 10)
        bc.add(MushiBreadcrumb.Category.CONSOLE, message = "12345678901234567890")
        assertEquals("1234567890…", bc.getAll().first().message)
    }

    @Test
    fun `clear removes all entries`() {
        val bc = BreadcrumbCollector()
        bc.add(MushiBreadcrumb.Category.NAVIGATION, message = "nav")
        bc.clear()
        assertEquals(0, bc.count)
    }

    @Test
    fun `getAll returns a snapshot copy`() {
        val bc = BreadcrumbCollector()
        bc.add(MushiBreadcrumb.Category.LIFECYCLE, message = "one")
        val snapshot = bc.getAll().toMutableList()
        snapshot.clear()
        assertEquals(1, bc.count, "Mutating the snapshot must not affect the internal buffer")
    }

    @Test
    fun `default level is INFO`() {
        val bc = BreadcrumbCollector()
        bc.add(MushiBreadcrumb.Category.CUSTOM, message = "x")
        assertEquals(MushiBreadcrumb.Level.INFO, bc.getAll().first().level)
    }

    @Test
    fun `toMap serialises correctly`() {
        val crumb = MushiBreadcrumb(
            timestamp = 1000L,
            category = MushiBreadcrumb.Category.LIFECYCLE,
            level = MushiBreadcrumb.Level.WARNING,
            message = "hello",
            data = mapOf("k" to "v"),
        )
        val m = crumb.toMap()
        assertEquals(1000L, m["timestamp"])
        assertEquals("lifecycle", m["category"])
        assertEquals("warning", m["level"])
        assertEquals("hello", m["message"])
        @Suppress("UNCHECKED_CAST")
        assertEquals("v", (m["data"] as Map<String, String>)["k"])
    }
}

package dev.mushimushi.sdk.capture

import java.util.LinkedList

/**
 * Single breadcrumb entry. Shape mirrors `MushiBreadcrumb` from `@mushi-mushi/core`
 * so the server and admin tools can treat Android and web breadcrumbs identically.
 */
data class MushiBreadcrumb(
    /** Unix epoch milliseconds when the breadcrumb fired. */
    val timestamp: Long = System.currentTimeMillis(),
    val category: Category,
    val level: Level = Level.INFO,
    /** Free-form short summary, capped at 500 chars at insert time. */
    val message: String,
    /** Optional structured payload. */
    val data: Map<String, String>? = null,
) {
    enum class Category(val wire: String) {
        NAVIGATION("navigation"),
        UI_TAP("ui.tap"),
        CONSOLE("console"),
        NETWORK("network"),
        LIFECYCLE("lifecycle"),
        CUSTOM("custom"),
    }

    enum class Level(val wire: String) {
        DEBUG("debug"),
        INFO("info"),
        WARNING("warning"),
        ERROR("error"),
    }

    fun toMap(): Map<String, Any> = buildMap {
        put("timestamp", timestamp)
        put("category", category.wire)
        put("level", level.wire)
        put("message", message)
        if (!data.isNullOrEmpty()) put("data", data)
    }
}

/**
 * Ring-buffer breadcrumb store. Capped at [max] entries (default 50); once
 * full every new [add] evicts the oldest. Thread-safe.
 *
 * PII note: values are stored verbatim; [PIIScrubber] is applied at
 * *report-snapshot time* in [dev.mushimushi.sdk.Mushi.report] — same
 * contract as the web SDK.
 */
class BreadcrumbCollector(
    private val max: Int = 50,
    private val maxMessageLength: Int = 500,
) {
    private val entries: LinkedList<MushiBreadcrumb> = LinkedList()

    @Synchronized
    fun add(
        category: MushiBreadcrumb.Category,
        level: MushiBreadcrumb.Level = MushiBreadcrumb.Level.INFO,
        message: String,
        data: Map<String, String>? = null,
        timestamp: Long = System.currentTimeMillis(),
    ) {
        val msg = if (message.length > maxMessageLength) message.take(maxMessageLength) + "…" else message
        entries.add(MushiBreadcrumb(timestamp, category, level, msg, data))
        while (entries.size > max) entries.removeFirst()
    }

    /** Return a copy of all retained breadcrumbs, oldest first. */
    @Synchronized
    fun getAll(): List<MushiBreadcrumb> = entries.toList()

    /** Drop all entries. */
    @Synchronized
    fun clear() = entries.clear()

    /** Number of currently retained entries. */
    @get:Synchronized
    val count: Int get() = entries.size
}

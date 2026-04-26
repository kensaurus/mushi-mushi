package dev.mushimushi.sdk.storage

import android.content.Context
import com.google.gson.Gson
import java.io.File
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Append-only file-backed queue that survives app restarts. Mirrors the
 * behaviour of the iOS `OfflineQueue` and the JS core SDK so the contract
 * is identical across platforms.
 *
 * Threading: All file IO is guarded by a per-instance lock. Methods are safe
 * to call from any thread; callers should still avoid the main thread.
 */
class OfflineQueue(
    context: Context,
    private val maxBytes: Long
) {
    private val file: File = File(context.applicationContext.filesDir, "mushi/queue.ndjson").apply {
        parentFile?.mkdirs()
    }
    private val lock = ReentrantLock()
    private val gson = Gson()

    /** Enqueue a JSON-serialisable report. Drops oldest entries on overflow. */
    fun enqueue(payload: Map<String, Any?>) = lock.withLock {
        val json = gson.toJson(payload).toByteArray(Charsets.UTF_8)
        val combined = ByteArray(json.size + 1).apply {
            System.arraycopy(json, 0, this, 0, json.size)
            this[json.size] = 0x0A
        }
        var existing = if (file.exists()) file.readBytes() else ByteArray(0)
        existing = existing + combined
        while (existing.size > maxBytes) {
            val nl = existing.indexOfFirst { it == 0x0A.toByte() }
            if (nl < 0) break
            existing = existing.copyOfRange(nl + 1, existing.size)
        }
        file.writeBytes(existing)
    }

    /** Drain up to [limit] queued reports without removing them. */
    fun peek(limit: Int): List<Map<String, Any?>> = lock.withLock {
        if (!file.exists()) return@withLock emptyList()
        file.readLines(Charsets.UTF_8)
            .asSequence()
            .filter { it.isNotBlank() }
            .take(limit)
            .mapNotNull { line ->
                runCatching {
                    @Suppress("UNCHECKED_CAST")
                    gson.fromJson(line, Map::class.java) as? Map<String, Any?>
                }.getOrNull()
            }
            .toList()
    }

    /** Drop the first [count] queued reports. */
    fun clearDelivered(count: Int) = lock.withLock {
        if (count <= 0 || !file.exists()) return@withLock
        val remaining = file.readLines(Charsets.UTF_8)
            .filter { it.isNotBlank() }
            .drop(count)
        if (remaining.isEmpty()) {
            file.delete()
        } else {
            file.writeText(remaining.joinToString("\n", postfix = "\n"), Charsets.UTF_8)
        }
    }

    /** Number of queued reports. */
    fun count(): Int = lock.withLock {
        if (!file.exists()) 0
        else file.readLines(Charsets.UTF_8).count { it.isNotBlank() }
    }
}

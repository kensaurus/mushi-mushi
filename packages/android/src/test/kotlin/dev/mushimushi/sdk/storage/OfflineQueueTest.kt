package dev.mushimushi.sdk.storage

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OfflineQueueTest {
    @Test
    fun enqueuePeekClear() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val q = OfflineQueue(ctx, maxBytes = 100_000)
        q.enqueue(mapOf("description" to "hello", "category" to "bug"))
        q.enqueue(mapOf("description" to "world", "category" to "slow"))

        assertEquals(2, q.count())
        val peeked = q.peek(10)
        assertEquals(2, peeked.size)
        assertEquals("hello", peeked.first()["description"])

        q.clearDelivered(1)
        assertEquals(1, q.count())
    }

    @Test
    fun trimsOldestWhenOverBudget() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val q = OfflineQueue(ctx, maxBytes = 250)
        repeat(10) { i ->
            q.enqueue(mapOf("description" to "report-$i", "category" to "bug"))
        }
        // Each NDJSON line is ~44 B (Gson map + newline). Budget 250 B ⇒ five
        // newest rows survive after trimming the five oldest.
        assertEquals(5, q.count())
        assertEquals("report-5", q.peek(1).first()["description"])
    }
}

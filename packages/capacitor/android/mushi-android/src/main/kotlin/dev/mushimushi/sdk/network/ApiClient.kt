package dev.mushimushi.sdk.network

import com.google.gson.Gson
import dev.mushimushi.sdk.MushiInfo
import dev.mushimushi.sdk.config.MushiConfig
import dev.mushimushi.sdk.storage.OfflineQueue
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP client for submitting reports. On any non-2xx (or transport error),
 * the payload is enqueued to [OfflineQueue] for later flushing — mirrors the
 * JS core SDK behaviour for cross-platform parity.
 */
class ApiClient(
    private val config: MushiConfig,
    private val queue: OfflineQueue,
    private val onSubmitted: ((Map<String, Any?>) -> Unit)? = null
) {
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val mediaJson = "application/json; charset=utf-8".toMediaType()

    fun submitReport(report: Map<String, Any?>) {
        val payload = report.toMutableMap().apply {
            put("projectId", config.projectId)
            put("sdkName", MushiInfo.SDK_NAME)
            put("sdkVersion", MushiInfo.SDK_VERSION)
        }

        val body = gson.toJson(payload).toRequestBody(mediaJson)
        val request = Request.Builder()
            .url("${config.endpoint}/v1/reports")
            .post(body)
            .header("Content-Type", "application/json")
            .header("X-Mushi-Api-Key", config.apiKey)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                queue.enqueue(payload)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        queue.enqueue(payload)
                        return
                    }
                    onSubmitted?.invoke(payload)
                }
            }
        })
    }

    /**
     * Best-effort flush of the offline queue. Stops on first failure.
     *
     * Called from the dedicated `mushi-flush` executor (see [Mushi.startFlushTimer]),
     * so blocking is safe. We deliberately avoid enqueue + CountDownLatch here:
     * with parallel async sends, responses can complete out of order, which means
     * `delivered` could not be safely mapped back to "the first N queue items"
     * when calling [OfflineQueue.clearDelivered] — the wrong items would be
     * dropped and successful sends could be retried as duplicates. Going
     * sequential keeps `delivered` aligned with the head of the queue and lets
     * us short-circuit on the first failure without any thread-safety dance.
     */
    fun flushQueue(maxBatch: Int = 25) {
        val batch = queue.peek(maxBatch)
        if (batch.isEmpty()) return

        var delivered = 0
        for (payload in batch) {
            val body = gson.toJson(payload).toRequestBody(mediaJson)
            val req = Request.Builder()
                .url("${config.endpoint}/v1/reports")
                .post(body)
                .header("X-Mushi-Api-Key", config.apiKey)
                .build()
            val ok = try {
                client.newCall(req).execute().use { it.isSuccessful }
            } catch (_: IOException) {
                false
            }
            if (!ok) break
            delivered++
        }
        if (delivered > 0) queue.clearDelivered(delivered)
    }
}

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
 * HTTP client for submitting reports. Scrubs PII from description before
 * sending. On any non-2xx (or transport error), the payload is enqueued to
 * [OfflineQueue] for later flushing with retry+jitter — mirrors the JS core
 * SDK behaviour for cross-platform parity.
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

        // Added: PII scrubbing (Phase 2.4)
        (payload["description"] as? String)?.let { payload["description"] = scrubPii(it) }

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
     * Best-effort flush of the offline queue with retry+jitter. Stops on
     * first unrecoverable failure.
     *
     * Called from the dedicated `mushi-flush` executor (see [Mushi.startFlushTimer]),
     * so blocking (Thread.sleep) is safe here.
     */
    fun flushQueue(maxBatch: Int = 25) {
        val batch = queue.peek(maxBatch)
        if (batch.isEmpty()) return

        var delivered = 0
        for (payload in batch) {
            val body = gson.toJson(payload)
            val ok = sendWithRetry(body)
            if (!ok) break
            delivered++
        }
        if (delivered > 0) queue.clearDelivered(delivered)
    }

    // Added: retry+jitter (Phase 2.4)
    private fun sendWithRetry(body: String, attempt: Int = 0): Boolean {
        val req = Request.Builder()
            .url("${config.endpoint}/v1/reports")
            .post(body.toRequestBody(mediaJson))
            .header("Content-Type", "application/json")
            .header("X-Mushi-Api-Key", config.apiKey)
            .build()
        val response = try {
            client.newCall(req).execute()
        } catch (_: IOException) {
            null
        }
        val code = response?.use { it.code } ?: -1
        if ((code == 429 || code >= 500) && attempt < 3) {
            val delayMs = minOf(1000L * (1L shl attempt) + (Math.random() * 500).toLong(), 10000L)
            Thread.sleep(delayMs)
            return sendWithRetry(body, attempt + 1)
        }
        return code in 200..299
    }

    // Added: PII scrubbing (Phase 2.4)
    private fun scrubPii(text: String): String {
        return text
            .replace(Regex("[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}"), "[REDACTED]")
            .replace(Regex("\\b\\d{3}[.\\-]?\\d{3}[.\\-]?\\d{4}\\b"), "[REDACTED]")
            .replace(Regex("\\b(?:\\d{4}[\\s\\-]?){3}\\d{4}\\b"), "[REDACTED]")
    }
}

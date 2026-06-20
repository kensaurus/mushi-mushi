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

        // PII scrubbing — applied to every free-text vector that can pick up
        // user-pasted secrets. Mirrors packages/core/src/pii-scrubber.ts so
        // server-side and SDK-side redaction stay in lockstep.
        (payload["description"] as? String)?.let { payload["description"] = scrubPii(it) }
        (payload["summary"] as? String)?.let { payload["summary"] = scrubPii(it) }
        @Suppress("UNCHECKED_CAST")
        (payload["breadcrumbs"] as? List<Map<String, Any?>>)?.let { crumbs ->
            payload["breadcrumbs"] = crumbs.map { crumb ->
                val msg = crumb["message"] as? String ?: return@map crumb
                crumb.toMutableMap().also { it["message"] = scrubPii(msg) }
            }
        }

        val body = gson.toJson(payload).toRequestBody(mediaJson)
        val request = Request.Builder()
            .url("${config.endpoint}/v1/reports")
            .post(body)
            .header("Content-Type", "application/json")
            .header("X-Mushi-Api-Key", config.apiKey)
            .header("X-Mushi-Project", config.projectId)
            .header("X-Mushi-SDK-Package", MushiInfo.SDK_NAME)
            .header("X-Mushi-SDK-Version", MushiInfo.SDK_VERSION)
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
            .header("X-Mushi-Project", config.projectId)
            .header("X-Mushi-SDK-Package", MushiInfo.SDK_NAME)
            .header("X-Mushi-SDK-Version", MushiInfo.SDK_VERSION)
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

    // PII scrubbing — Wave S2 / D-16
    //
    // Mirrors packages/core/src/pii-scrubber.ts so an Android user who pastes
    // a Stripe key, an OpenAI key, a JWT, or a credit card into a bug report
    // never ships it to our servers. Order matters: high-entropy / high-cost
    // tokens first so generic email/phone regex never wins a tie. We omit
    // IPv4/IPv6 by default (too noisy: `192.168.1.1` is rarely PII).
    private fun scrubPii(text: String): String {
        var result = text
        for ((regex, replacement) in SCRUB_PATTERNS) {
            result = regex.replace(result, replacement)
        }
        return result
    }

    companion object {
        private val SCRUB_PATTERNS: List<Pair<Regex, String>> = listOf(
            Regex("\\b\\d{3}-\\d{2}-\\d{4}\\b") to "[REDACTED_SSN]",
            Regex("\\b(?:\\d[ -]*){12,18}\\d\\b") to "[REDACTED_CC]",
            Regex("\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b") to "[REDACTED_AWS_KEY]",
            Regex(
                "(?:aws_secret_access_key|secret_access_key)[\"'\\s:=]+[A-Za-z0-9/+=]{40}\\b",
                RegexOption.IGNORE_CASE
            ) to "aws_secret_access_key=[REDACTED_AWS_SECRET]",
            Regex("\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\\b") to "[REDACTED_STRIPE_KEY]",
            Regex("\\bpk_(?:live|test)_[A-Za-z0-9]{24,}\\b") to "[REDACTED_STRIPE_PK]",
            Regex("\\bxox[abpor]-[A-Za-z0-9-]{10,}\\b") to "[REDACTED_SLACK_TOKEN]",
            Regex("\\bghp_[A-Za-z0-9]{36}\\b") to "[REDACTED_GITHUB_PAT]",
            Regex("\\bgithub_pat_[A-Za-z0-9_]{80,}\\b") to "[REDACTED_GITHUB_PAT]",
            Regex("\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b") to "[REDACTED_OPENAI_KEY]",
            Regex("\\bsk-ant-[A-Za-z0-9_-]{20,}\\b") to "[REDACTED_ANTHROPIC_KEY]",
            Regex("\\bAIza[0-9A-Za-z_-]{35}\\b") to "[REDACTED_GOOGLE_KEY]",
            Regex("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b") to "[REDACTED_JWT]",
            Regex("\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b") to "[REDACTED_EMAIL]",
            Regex("(?:\\+\\d{1,3}[\\s.\\-])?\\(?\\d{2,4}\\)?[\\s.\\-]\\d{3,4}[\\s.\\-]\\d{3,4}\\b") to "[REDACTED_PHONE]",
        )
    }
}

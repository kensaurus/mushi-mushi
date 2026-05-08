package dev.mushimushi.sdk.config

/**
 * Top-level Mushi Mushi configuration. Mirrors the shape of the iOS and JS
 * SDKs so cross-platform docs stay accurate.
 *
 * BREAKING CHANGE: `endpoint` is now required — there is no safe default.
 * Pass your Supabase Edge Function URL: "https://xyz.supabase.co/functions/v1/api".
 */
data class MushiConfig(
    val projectId: String,
    val apiKey: String,
    /** Required. Your Supabase Edge Function URL, e.g. "https://xyz.supabase.co/functions/v1/api". */
    val endpoint: String,
    val triggerMode: TriggerMode = TriggerMode.SHAKE,
    val captureScreenshot: Boolean = true,
    val captureBreadcrumbs: Boolean = true,
    val minDescriptionLength: Int = 20,
    val offlineQueueMaxBytes: Long = 2L * 1024 * 1024,
    val theme: Theme = Theme(),
    val triggerInset: TriggerInset = TriggerInset()
)

enum class TriggerMode { SHAKE, BUTTON, BOTH, NONE }

data class Theme(
    val accentColor: String = "#22C55E",
    val dark: Boolean = false
)

data class TriggerInset(
    val bottomDp: Int = 96,
    val startDp: Int? = null,
    val endDp: Int? = 20
)

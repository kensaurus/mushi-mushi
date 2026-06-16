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
    val triggerInset: TriggerInset = TriggerInset(),
    val proactive: ProactiveConfig = ProactiveConfig(),
    val pii: PIIConfig = PIIConfig(),
    /** Set to enable a draggable floating button. null = fixed (default). */
    val draggable: DraggableConfig? = null,
)

data class ProactiveConfig(
    /** Detect ≥3 rapid taps on the same view. Default true. */
    val rageTap: Boolean = true,
    /** Detect frames taking >200 ms to render. Default true. */
    val slowScreen: Boolean = true,
    /** Slow-screen threshold in ms. Default 200. */
    val slowScreenThresholdMs: Long = 200L,
    /** Max proactive triggers fired per session before silencing. Default 3. */
    val maxPerSession: Int = 3,
)

data class PIIConfig(
    val emails: Boolean = true,
    val phones: Boolean = true,
    val creditCards: Boolean = true,
    val ssns: Boolean = true,
    val ipAddresses: Boolean = false,
    val secretTokens: Boolean = true,
    val ipv6: Boolean = false,
)

enum class TriggerMode { SHAKE, BUTTON, BOTH, NONE }

data class Theme(
    val accentColor: String = "#22C55E",
    val dark: Boolean = false,
    /** When true, detect the device's night mode at runtime instead of using `dark`. */
    val inherit: Boolean = false,
)

/** Configuration for a draggable floating action button. */
data class DraggableConfig(
    val enabled: Boolean = true,
    /** Snap the FAB to the nearest vertical edge on release. */
    val snapToEdge: Boolean = true,
    /** Save and restore FAB position across app restarts (SharedPreferences). */
    val persist: Boolean = true,
)

data class TriggerInset(
    val bottomDp: Int = 96,
    val startDp: Int? = null,
    val endDp: Int? = 20
)

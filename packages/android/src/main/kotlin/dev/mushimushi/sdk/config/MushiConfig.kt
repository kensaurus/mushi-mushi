package dev.mushimushi.sdk.config

/**
 * Top-level Mushi Mushi configuration. Mirrors the shape of the iOS and JS
 * SDKs so cross-platform docs stay accurate.
 */
data class MushiConfig(
    val projectId: String,
    val apiKey: String,
    val endpoint: String = DEFAULT_ENDPOINT,
    val triggerMode: TriggerMode = TriggerMode.SHAKE,
    val captureScreenshot: Boolean = true,
    val captureBreadcrumbs: Boolean = true,
    val minDescriptionLength: Int = 20,
    val offlineQueueMaxBytes: Long = 2L * 1024 * 1024,
    val theme: Theme = Theme()
) {
    companion object {
        const val DEFAULT_ENDPOINT = "https://api.mushimushi.dev"
    }
}

enum class TriggerMode { SHAKE, BUTTON, BOTH, NONE }

data class Theme(
    val accentColor: String = "#22C55E",
    val dark: Boolean = false
)

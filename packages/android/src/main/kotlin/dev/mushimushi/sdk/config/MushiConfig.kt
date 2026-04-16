package dev.mushimushi.sdk.config

data class MushiConfig(
    val projectId: String,
    val apiKey: String,
    val endpoint: String = "https://api.mushimushi.dev",
    val triggerMode: TriggerMode = TriggerMode.SHAKE,
    val captureConsole: Boolean = true,
    val captureNetwork: Boolean = true,
    val maxQueueSize: Int = 50,
)

enum class TriggerMode {
    SHAKE, BUTTON, BOTH
}

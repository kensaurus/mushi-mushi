package dev.mushimushi.sdk

import android.app.Application
import dev.mushimushi.sdk.config.MushiConfig

object Mushi {
    private var config: MushiConfig? = null
    private var application: Application? = null

    fun init(app: Application, config: MushiConfig) {
        this.application = app
        this.config = config
        // TODO: Initialize OkHttp interceptor for network capture
        // TODO: Register ShakeDetector via SensorManager
        // TODO: Initialize Room database for offline queue
        // TODO: Schedule WorkManager periodic flush
    }

    fun submitReport(report: Map<String, Any>) {
        // TODO: Send via ApiClient, fall back to Room queue
    }

    fun captureError(throwable: Throwable, context: Map<String, Any>? = null) {
        // TODO: Build report from throwable + captured context
    }

    fun showWidget() {
        // TODO: Show MushiBottomSheet dialog fragment
    }
}

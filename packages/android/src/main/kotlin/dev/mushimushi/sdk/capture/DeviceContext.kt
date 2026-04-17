package dev.mushimushi.sdk.capture

import android.content.Context
import android.os.Build
import dev.mushimushi.sdk.MushiInfo
import java.util.Locale
import java.util.TimeZone

/**
 * Snapshots device + app context for inclusion in every report. Mirrors
 * the iOS DeviceContext so the cross-platform schema stays identical.
 */
object DeviceContext {
    fun capture(context: Context): Map<String, Any?> {
        val app = context.applicationContext
        val pm = app.packageManager
        val pkg = app.packageName
        val info = runCatching { pm.getPackageInfo(pkg, 0) }.getOrNull()
        val metrics = app.resources.displayMetrics

        return mapOf(
            "platform" to "android",
            "sdkName" to MushiInfo.SDK_NAME,
            "sdkVersion" to MushiInfo.SDK_VERSION,
            "timestamp" to System.currentTimeMillis(),
            "locale" to Locale.getDefault().toLanguageTag(),
            "timezone" to TimeZone.getDefault().id,
            "app" to mapOf(
                "id" to pkg,
                "version" to info?.versionName,
                "build" to (if (Build.VERSION.SDK_INT >= 28) info?.longVersionCode else info?.versionCode?.toLong())
            ),
            "device" to mapOf(
                "manufacturer" to Build.MANUFACTURER,
                "model" to Build.MODEL,
                "osName" to "Android",
                "osVersion" to Build.VERSION.RELEASE,
                "apiLevel" to Build.VERSION.SDK_INT,
                "screenWidth" to metrics.widthPixels,
                "screenHeight" to metrics.heightPixels,
                "density" to metrics.density
            )
        )
    }
}

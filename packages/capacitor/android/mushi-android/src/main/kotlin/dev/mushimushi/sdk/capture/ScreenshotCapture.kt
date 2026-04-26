package dev.mushimushi.sdk.capture

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import java.io.ByteArrayOutputStream

/**
 * Captures the current activity's root view as a base64 JPEG. Returns `null`
 * on any failure — this is best-effort and must never crash the host app.
 */
object ScreenshotCapture {
    fun captureBase64(activity: Activity, quality: Int = 80): String? = runCatching {
        val view = activity.window?.decorView?.rootView ?: return null
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).also { view.draw(it) }
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
    }.getOrNull()
}

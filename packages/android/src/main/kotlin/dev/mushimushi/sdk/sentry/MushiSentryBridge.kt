package dev.mushimushi.sdk.sentry

import dev.mushimushi.sdk.Mushi

/**
 * Bridges Mushi reports to Sentry's `UserFeedback` channel. Activated by
 * calling [install] after both `SentrySDK.init` and `Mushi.init` have run.
 *
 * Sentry is a `compileOnly` dep so consumers who don't use Sentry pay no
 * APK cost. The bridge resolves the Sentry classes via reflection and
 * silently no-ops if Sentry is missing on the runtime classpath.
 */
object MushiSentryBridge {
    @Volatile private var installed = false

    @JvmStatic
    fun install() {
        if (installed) return
        synchronized(this) {
            if (installed) return
            val sentryClass = runCatching { Class.forName("io.sentry.Sentry") }.getOrNull()
                ?: return
            val feedbackClass = runCatching { Class.forName("io.sentry.UserFeedback") }.getOrNull()
                ?: return

            Mushi.onReportSubmitted = { payload ->
                runCatching {
                    val description = payload["description"] as? String ?: return@runCatching
                    val captureMessage = sentryClass.getMethod("captureMessage", String::class.java)
                    val eventId = captureMessage.invoke(null, "MushiReport: ${description.take(80)}")
                        ?: return@runCatching

                    val feedbackCtor = feedbackClass.getConstructor(eventId.javaClass)
                    val feedback = feedbackCtor.newInstance(eventId)
                    feedbackClass.getMethod("setComments", String::class.java)
                        .invoke(feedback, description)

                    sentryClass.getMethod("captureUserFeedback", feedbackClass)
                        .invoke(null, feedback)
                }
            }
            installed = true
        }
    }
}

# Mushi Mushi consumer rules.
# Keep public API surface intact for consumers depending on dev.mushimushi.sdk.*

-keep public class dev.mushimushi.sdk.** { *; }
-keepclassmembers public class dev.mushimushi.sdk.** { *; }

# Sentry classes are reflectively resolved by MushiSentryBridge; if R8 strips
# them in consumer apps, that's fine — the bridge silently no-ops.
-dontwarn io.sentry.**

package dev.mushimushi.sdk.capture

/**
 * Normalised form of anything that might be thrown.
 * Mirrors `NormalisedException` from `packages/core/src/exception-normaliser.ts`.
 */
data class NormalisedException(
    val name: String,
    val message: String,
    val stack: String? = null,
    val cause: String? = null,
) {
    /** Convert to the `metadata["error"]` map shape sent in reports. */
    fun toMap(): Map<String, Any> = buildMap {
        put("type", name)
        put("message", message)
        stack?.let { put("stack", it) }
        cause?.let { put("cause", it) }
    }
}

private const val STACK_LIMIT = 8 * 1024

/**
 * Normalise any [Throwable] into the shape Mushi reports use. Mirrors
 * `normaliseThrown` from `packages/core/src/exception-normaliser.ts`:
 * same field names, same 8 KB stack cap, same cause-unwinding.
 */
fun normaliseThrowable(t: Throwable): NormalisedException {
    val name = t.javaClass.name
    val message = t.message?.takeIf { it.isNotEmpty() } ?: t.javaClass.simpleName
    val rawStack = t.stackTraceToString()
    val stack = if (rawStack.isNotEmpty()) rawStack.take(STACK_LIMIT) else null
    val cause = t.cause?.message
    return NormalisedException(name = name, message = message, stack = stack, cause = cause)
}

/**
 * Generic stub for Deno-style `npm:` specifiers that show up in the transitive
 * import graph of Edge Function source files when vitest transforms them on
 * Node. The actual call sites are always replaced with `vi.mock(...)` in the
 * test file, so the runtime exports here are never invoked — they only need
 * to satisfy Vite's transform-time resolver. We export a permissive Proxy so
 * any named import (`createClient`, `Sentry`, `Context`, ...) resolves to a
 * harmless callable that returns another Proxy.
 */

const handler: ProxyHandler<object> = {
  get(_target, prop) {
    if (prop === '__esModule' || prop === Symbol.toStringTag) return undefined
    return new Proxy(function () {}, handler)
  },
  apply() {
    return new Proxy({}, handler)
  },
  construct() {
    return new Proxy({}, handler)
  },
}

const stub = new Proxy(function () {}, handler)

export default stub
export const z = stub
export const createClient = stub
export const generateObject = stub
export const generateText = stub
export const createAnthropic = stub
export const reportError = stub
export const reportMessage = stub
export const init = stub
export const captureException = stub
export const captureMessage = stub

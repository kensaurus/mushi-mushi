/**
 * Normalise *anything* a host might throw — `Error`, string, plain
 * object, `null`, frozen DOMException — into the shape Mushi reports
 * use. Mirrors Sentry's own internal normaliser; lets `captureException`
 * be a thin sugar layer over `captureEvent`.
 *
 * Truncates the stack at 8 KB so a runaway long stack (recursive React
 * render error during a hot reload, for example) doesn't blow the
 * description budget when callers fall back to the stack as the body.
 */
export interface NormalisedException {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

const STACK_LIMIT = 8 * 1024;
const FALLBACK_JSON_LIMIT = 1000;

export function normaliseThrown(thrown: unknown): NormalisedException {
  if (thrown instanceof Error) {
    const name = thrown.name || 'Error';
    const message = thrown.message || String(thrown);
    const stack =
      typeof thrown.stack === 'string' && thrown.stack.length > 0
        ? thrown.stack.slice(0, STACK_LIMIT)
        : undefined;
    const cause = (thrown as { cause?: unknown }).cause;
    return {
      name,
      message,
      ...(stack ? { stack } : {}),
      ...(cause !== undefined
        ? { cause: cause instanceof Error ? cause.message : cause }
        : {}),
    };
  }
  if (typeof thrown === 'string') {
    return { name: 'Error', message: thrown };
  }
  if (thrown && typeof thrown === 'object') {
    const obj = thrown as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : 'Error';
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : (() => {
            try {
              return JSON.stringify(obj).slice(0, FALLBACK_JSON_LIMIT);
            } catch {
              return String(obj);
            }
          })();
    const stack = typeof obj.stack === 'string' ? obj.stack.slice(0, STACK_LIMIT) : undefined;
    return { name, message, ...(stack ? { stack } : {}) };
  }
  // `String(null)` → `"null"`, `String(undefined)` → `"undefined"`.
  // We special-case `undefined` to read as "unknown" because that's
  // how it shows up in the most common case (a `throw` without an
  // argument, or `Promise.reject()`).
  if (thrown === undefined) return { name: 'Error', message: 'unknown' };
  return { name: 'Error', message: String(thrown) };
}

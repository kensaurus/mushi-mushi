/**
 * FILE: apps/admin/src/lib/byokErrors.ts
 * PURPOSE: Turn BYOK API failures into plain English for Settings → AI keys.
 *          The panel used to print `res.error.message`, which for several
 *          routes was just the code ("BAD_PROVIDER"), or "Failed to add key."
 *          with no cause. Each code maps to a sentence the owner can act on;
 *          `where` says whether it belongs under the key field, the base URL
 *          field, or next to the row or form.
 */

interface ByokApiError {
  code?: string;
  message?: string;
}

interface ByokErrorView {
  message: string;
  where: 'key' | 'baseUrl' | 'form';
}

const SESSION_EXPIRED_MESSAGE = 'Your session expired — sign in again.';
const NETWORK_MESSAGE = "Couldn't reach Mushi — check your connection and retry.";

/** A server message worth showing as-is: a sentence, not a bare code. */
function sentence(error: ByokApiError | undefined): string | null {
  const message = error?.message?.trim();
  if (!message) return null;
  if (/^[A-Z][A-Z0-9_]*$/.test(message)) return null;
  if (error?.code && message.toUpperCase() === error.code.toUpperCase()) return null;
  return message;
}

export function describeByokError(
  error: ByokApiError | undefined,
  fallback: string,
): ByokErrorView {
  const code = (error?.code ?? '').toUpperCase();
  const own = sentence(error);
  switch (code) {
    case 'MISSING_AUTH':
    case 'INVALID_TOKEN':
      return { message: SESSION_EXPIRED_MESSAGE, where: 'form' };
    case 'NETWORK_ERROR':
      return { message: NETWORK_MESSAGE, where: 'form' };
    case 'DUPLICATE_KEY':
      return { message: own ?? 'This key is already saved.', where: 'key' };
    case 'VALIDATION_ERROR':
    case 'INVALID_KEY':
    case 'KEY_TOO_SHORT':
      return {
        message:
          own ?? 'That key was not accepted. Copy it again from the provider and paste it here.',
        where: 'key',
      };
    case 'INVALID_BASE_URL':
      return {
        message: `That base URL can't be used${own ? ` (${own})` : ''}. Use the https:// address of a supported provider, such as https://openrouter.ai/api/v1.`,
        where: 'baseUrl',
      };
    case 'VAULT_WRITE_FAILED':
      return {
        message: "Mushi couldn't store the key securely, so nothing was saved. Retry in a moment.",
        where: 'form',
      };
    case 'VAULT_READ_FAILED':
      return {
        message:
          "Mushi couldn't read the stored key. Retry; if it keeps failing, remove the key and add it again.",
        where: 'form',
      };
    case 'BAD_PROVIDER':
      return {
        message:
          own ?? "This key can't be managed from this row. Remove it from the key pool instead.",
        where: 'form',
      };
    case 'NO_KEY':
    case 'KEY_NOT_CONFIGURED':
      return { message: 'There is no saved key to test. Add one first.', where: 'form' };
    case 'NOT_FOUND':
      return {
        message: 'That key no longer exists. Reload the page to see the current list.',
        where: 'form',
      };
    case 'FEATURE_NOT_IN_PLAN':
      return { message: 'Your plan does not include your own API keys.', where: 'form' };
    case 'RATE_LIMITED':
      return { message: 'Too many requests. Wait a minute, then retry.', where: 'form' };
    case 'DB_ERROR':
    case 'INTERNAL':
    case 'INTERNAL_ERROR':
      return { message: 'Something went wrong on our side. Retry in a moment.', where: 'form' };
    case 'HTTP_ERROR': {
      const status = error?.message?.slice(0, 3) ?? '';
      if (status === '401') return { message: SESSION_EXPIRED_MESSAGE, where: 'form' };
      if (status.startsWith('5'))
        return { message: 'Something went wrong on our side. Retry in a moment.', where: 'form' };
      return { message: fallback, where: 'form' };
    }
    default:
      return { message: own ?? fallback, where: 'form' };
  }
}

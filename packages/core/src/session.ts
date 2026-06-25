const SESSION_KEY = 'mushi_session_id';

let cachedSessionId: string | null = null;

export function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;

  if (typeof sessionStorage !== 'undefined') {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
  }

  const id = generateSessionId();
  cachedSessionId = id;

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      // sessionStorage unavailable
    }
  }

  return id;
}

function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  return `ms_${timestamp}_${randomSuffix()}`;
}

/**
 * 6-char base36 suffix using the same crypto capability ladder as `newUuid()`
 * (crypto.getRandomValues first; Math.random only as a last-resort fallback on
 * runtimes without a CSPRNG). A session id is a correlation identifier, not a
 * secret, but preferring crypto keeps it off CodeQL js/insecure-randomness.
 */
function randomSuffix(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  const bytes = new Uint8Array(4);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let n = 0;
  for (const b of bytes) n = (n * 256 + b) >>> 0;
  return n.toString(36).padStart(6, '0').slice(0, 6);
}

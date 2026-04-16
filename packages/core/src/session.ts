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
  const random = Math.random().toString(36).slice(2, 8);
  return `ms_${timestamp}_${random}`;
}

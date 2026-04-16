const STORAGE_KEY = 'mushi_reporter_token';

export function getReporterToken(): string {
  if (typeof localStorage !== 'undefined') {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
  }

  const token = generateToken();

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // localStorage full or unavailable — token is ephemeral
    }
  }

  return token;
}

function generateToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `mushi_${crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `mushi_${hex}`;
}

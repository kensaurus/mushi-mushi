/**
 * Minimal Conduit API client (RealWorld spec): JWT via
 * `Authorization: Token <jwt>` (NOT `Bearer`), `{"errors":{"body":[...]}}`
 * error shape, `limit`/`offset` pagination.
 */

export interface Article {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  favoritesCount: number;
  favorited: boolean;
  author: { username: string; bio: string | null; following: boolean };
}

const TOKEN_KEY = 'conduit-jwt';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(jwt: string | null): void {
  if (jwt) localStorage.setItem(TOKEN_KEY, jwt);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init?.headers,
    },
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { errors?: { body: string[] } })
    | null;
  if (!res.ok) {
    throw new Error(json?.errors?.body?.join(', ') ?? `HTTP ${res.status}`);
  }
  return json as T;
}

export function listArticles(params: { limit: number; offset: number; tag?: string }) {
  const qs = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    ...(params.tag ? { tag: params.tag } : {}),
  });
  return request<{ articles: Article[]; articlesCount: number }>(`/articles?${qs}`);
}

export function getArticle(slug: string) {
  return request<{ article: Article }>(`/articles/${slug}`);
}

export function favoriteArticle(slug: string) {
  return request<{ article: Article }>(`/articles/${slug}/favorite`, { method: 'POST' });
}

export function getTags() {
  return request<{ tags: string[] }>('/tags');
}

export function getProfile(username: string) {
  return request<{ profile: Article['author'] }>(`/profiles/${username}`);
}

export function login(email: string, password: string) {
  return request<{ user: { username: string; token: string } }>('/users/login', {
    method: 'POST',
    body: JSON.stringify({ user: { email, password } }),
  });
}

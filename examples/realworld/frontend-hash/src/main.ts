/**
 * Hash-routed Conduit fixture (RealWorld routing spec: `#/`, `#/login`,
 * `#/article/:slug`, `#/profile/:username`, filters as `#/?tag=…`).
 * Uses @mushi-mushi/web directly — no framework wrapper — so the journey
 * exercises the base SDK's hashchange handling end to end.
 */
import { Mushi } from '@mushi-mushi/web';
import { createHeadlessCapture } from '@mushi-mushi/web/headless';

const env = (import.meta as ImportMeta & {
  env: Record<string, string | undefined>;
}).env;

Mushi.init({
  projectId: env.VITE_MUSHI_PROJECT_ID ?? 'realworld-fixture',
  apiKey: env.VITE_MUSHI_API_KEY ?? 'mushi_realworld_fixture_key',
  apiEndpoint: env.VITE_MUSHI_API_ENDPOINT ?? 'http://localhost:4199/functions/v1/api',
  runtimeConfig: false,
  debug: true,
  widget: {
    trigger: 'edge-tab',
    triggerText: 'Report bug',
    position: 'bottom-right',
    environments: { development: 'always', staging: 'always', production: 'always' },
  },
  capture: {
    discoverInventory: {
      enabled: true,
      throttleMs: 0,
      routeTemplates: ['/#/article/[slug]', '/#/profile/[username]'],
    },
  },
});
(window as Window & { __mushi?: typeof Mushi }).__mushi = Mushi;

const headless = createHeadlessCapture({
  projectId: env.VITE_MUSHI_PROJECT_ID ?? 'realworld-fixture',
  apiKey: env.VITE_MUSHI_API_KEY ?? 'mushi_realworld_fixture_key',
  apiEndpoint: env.VITE_MUSHI_API_ENDPOINT ?? 'http://localhost:4199/functions/v1/api',
});
(window as Window & { __mushiHeadless?: typeof headless }).__mushiHeadless = headless;

interface Article {
  slug: string;
  title: string;
  body: string;
  favoritesCount: number;
  tagList: string[];
  author: { username: string; bio: string | null };
}

const TOKEN_KEY = 'conduit-jwt';
const app = document.getElementById('app')!;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
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
  if (!res.ok) throw new Error(json?.errors?.body?.join(', ') ?? `HTTP ${res.status}`);
  return json as T;
}

function el(html: string): void {
  app.innerHTML = html;
}

async function renderHome(query: URLSearchParams): Promise<void> {
  const tag = query.get('tag');
  const offset = Number(query.get('offset') ?? '0');
  const qs = new URLSearchParams({ limit: '10', offset: String(offset) });
  if (tag) qs.set('tag', tag);
  const [{ articles, articlesCount }, { tags }] = await Promise.all([
    api<{ articles: Article[]; articlesCount: number }>(`/articles?${qs}`),
    api<{ tags: string[] }>('/tags'),
  ]);
  el(`
    <h1>conduit</h1>
    <p>A place to share your knowledge.</p>
    <div data-testid="tag-list">
      ${tags
        .map((t) => `<a data-testid="tag-${t}" href="#/?tag=${t}">${t}</a>`)
        .join(' ')}
    </div>
    <ul data-testid="article-list">
      ${articles
        .map(
          (a) => `
        <li>
          <a data-testid="article-link-${a.slug}" href="#/article/${a.slug}">${a.title}</a>
          by <a href="#/profile/${a.author.username}">${a.author.username}</a>
        </li>`,
        )
        .join('')}
    </ul>
    <a data-testid="next-page" href="#/?offset=${offset + 10}${tag ? `&tag=${tag}` : ''}">
      Next page (${articlesCount} total)
    </a>
  `);
}

async function renderArticle(slug: string): Promise<void> {
  try {
    const { article } = await api<{ article: Article }>(`/articles/${slug}`);
    el(`
      <h1 data-testid="article-title">${article.title}</h1>
      <p>${article.body}</p>
      <button data-testid="favorite-button">♥ ${article.favoritesCount}</button>
      <a data-testid="back-home" href="#/">Back</a>
    `);
    document.querySelector('[data-testid="favorite-button"]')!.addEventListener('click', () => {
      api<{ article: Article }>(`/articles/${slug}/favorite`, { method: 'POST' }).then(
        () => renderArticle(slug),
        (e: Error) => {
          console.error('Favorite failed', e);
          el(`<p data-testid="article-error">Something went wrong: ${e.message}</p>`);
        },
      );
    });
  } catch (e) {
    console.error('Failed to load article', e);
    el(`<p data-testid="article-error">Something went wrong: ${(e as Error).message}</p>`);
  }
}

async function renderProfile(username: string): Promise<void> {
  const { profile } = await api<{ profile: Article['author'] }>(`/profiles/${username}`);
  el(`
    <h1 data-testid="profile-username">${profile.username}</h1>
    <p>${profile.bio ?? 'No bio yet.'}</p>
  `);
}

function renderLogin(): void {
  el(`
    <h1>Sign in</h1>
    <p data-testid="login-error" hidden></p>
    <form data-testid="login-form">
      <input data-testid="login-email" type="email" placeholder="Email" />
      <input data-testid="login-password" type="password" placeholder="Password" />
      <button data-testid="login-submit" type="submit">Sign in</button>
    </form>
  `);
  document.querySelector('[data-testid="login-form"]')!.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const email = (document.querySelector('[data-testid="login-email"]') as HTMLInputElement).value;
    const password = (
      document.querySelector('[data-testid="login-password"]') as HTMLInputElement
    ).value;
    api<{ user: { token: string } }>('/users/login', {
      method: 'POST',
      body: JSON.stringify({ user: { email, password } }),
    }).then(
      ({ user }) => {
        localStorage.setItem(TOKEN_KEY, user.token);
        location.hash = '#/';
      },
      (e: Error) => {
        console.error('Login failed', e);
        const p = document.querySelector('[data-testid="login-error"]') as HTMLElement;
        p.hidden = false;
        p.textContent = e.message;
      },
    );
  });
}

function route(): void {
  const hash = location.hash || '#/';
  const [pathPart, queryPart] = hash.slice(1).split('?') as [string, string | undefined];
  const query = new URLSearchParams(queryPart ?? '');
  if (pathPart === '/login') renderLogin();
  else if (pathPart.startsWith('/article/'))
    void renderArticle(pathPart.slice('/article/'.length));
  else if (pathPart.startsWith('/profile/'))
    void renderProfile(pathPart.slice('/profile/'.length));
  else void renderHome(query);
}

window.addEventListener('hashchange', route);
route();

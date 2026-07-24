import { MushiProvider, MushiErrorBoundary, useMushi } from '@mushi-mushi/react';
import { createHeadlessCapture } from '@mushi-mushi/web/headless';
import { useCallback, useEffect, useState } from 'react';
import {
  type Article,
  favoriteArticle,
  getArticle,
  getProfile,
  getTags,
  listArticles,
  login,
  setToken,
} from './api';

const MUSHI_CONFIG = {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID ?? 'realworld-fixture',
  apiKey: import.meta.env.VITE_MUSHI_API_KEY ?? 'mushi_realworld_fixture_key',
  apiEndpoint:
    import.meta.env.VITE_MUSHI_API_ENDPOINT ?? 'http://localhost:4199/functions/v1/api',
  runtimeConfig: false,
  debug: true,
  widget: {
    trigger: 'edge-tab' as const,
    triggerText: 'Report bug',
    position: 'bottom-right' as const,
    environments: {
      development: 'always' as const,
      staging: 'always' as const,
      production: 'always' as const,
    },
  },
  capture: {
    discoverInventory: {
      enabled: true,
      throttleMs: 0,
      routeTemplates: ['/article/[slug]', '/profile/[username]', '/editor/[slug]'],
    },
  },
};

/**
 * Deliberately tiny history-based router: navigations go through
 * `history.pushState`, exactly the mechanism React Router / Next use and the
 * one Mushi's history-patch instruments.
 */
function usePathRouter() {
  const [path, setPath] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const onPop = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    history.pushState({}, '', to);
    setPath(to);
  }, []);
  return { path, navigate };
}

type Nav = (to: string) => void;

/** Expose the SDK for the Playwright journey (same bridge as react-demo). */
function JourneyBridge() {
  const sdk = useMushi();
  useEffect(() => {
    (window as Window & { __mushi?: typeof sdk }).__mushi = sdk;
    // Headless capture path — realistic app wiring (window.onerror → capture)
    // and the journey's programmatic-submission probe.
    const headless = createHeadlessCapture({
      projectId: MUSHI_CONFIG.projectId,
      apiKey: MUSHI_CONFIG.apiKey,
      apiEndpoint: MUSHI_CONFIG.apiEndpoint,
    });
    (window as Window & { __mushiHeadless?: typeof headless }).__mushiHeadless = headless;
  }, [sdk]);
  return null;
}

export function App() {
  return (
    <MushiProvider config={MUSHI_CONFIG}>
      <MushiErrorBoundary>
        <JourneyBridge />
        <Shell />
      </MushiErrorBoundary>
    </MushiProvider>
  );
}

function Shell() {
  const { path, navigate } = usePathRouter();
  const pathname = path.split('?')[0]!;

  let page: React.ReactNode;
  if (pathname === '/login') page = <LoginPage navigate={navigate} />;
  else if (pathname.startsWith('/article/'))
    page = <ArticlePage slug={pathname.slice('/article/'.length)} navigate={navigate} />;
  else if (pathname.startsWith('/profile/'))
    page = <ProfilePage username={pathname.slice('/profile/'.length)} />;
  else page = <HomePage path={path} navigate={navigate} />;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <nav style={{ display: 'flex', gap: 12, padding: 12 }}>
        <a
          data-testid="nav-home"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          conduit
        </a>
        <a
          data-testid="nav-login"
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigate('/login');
          }}
        >
          Sign in
        </a>
      </nav>
      {page}
    </div>
  );
}

function HomePage({ path, navigate }: { path: string; navigate: Nav }) {
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const tag = params.get('tag') ?? undefined;
  const offset = Number(params.get('offset') ?? '0');
  const [articles, setArticles] = useState<Article[]>([]);
  const [count, setCount] = useState(0);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    void listArticles({ limit: 10, offset, tag }).then((r) => {
      setArticles(r.articles);
      setCount(r.articlesCount);
    });
  }, [offset, tag]);
  useEffect(() => {
    void getTags().then((r) => setTags(r.tags));
  }, []);

  return (
    <main>
      <h1>conduit</h1>
      <p>A place to share your knowledge.</p>
      <div data-testid="tag-list" style={{ display: 'flex', gap: 8 }}>
        {tags.map((t) => (
          <button key={t} data-testid={`tag-${t}`} onClick={() => navigate(`/?tag=${t}`)}>
            {t}
          </button>
        ))}
      </div>
      <ul data-testid="article-list">
        {articles.map((a) => (
          <li key={a.slug}>
            <a
              data-testid={`article-link-${a.slug}`}
              href={`/article/${a.slug}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/article/${a.slug}`);
              }}
            >
              {a.title}
            </a>{' '}
            by{' '}
            <a
              href={`/profile/${a.author.username}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/profile/${a.author.username}`);
              }}
            >
              {a.author.username}
            </a>
          </li>
        ))}
      </ul>
      <button
        data-testid="next-page"
        disabled={offset + 10 >= count}
        onClick={() => navigate(`/?offset=${offset + 10}${tag ? `&tag=${tag}` : ''}`)}
      >
        Next page
      </button>
    </main>
  );
}

function ArticlePage({ slug, navigate }: { slug: string; navigate: Nav }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    getArticle(slug).then(
      (r) => setArticle(r.article),
      (e: Error) => {
        // Real-app pattern: log-and-render — Mushi's console capture should
        // pick this up and correlate it with the failed request.
        console.error('Failed to load article', e);
        setError(e.message);
      },
    );
  }, [slug]);

  if (error) return <p data-testid="article-error">Something went wrong: {error}</p>;
  if (!article) return <p>Loading…</p>;
  return (
    <main>
      <h1 data-testid="article-title">{article.title}</h1>
      <p>{article.body}</p>
      <button
        data-testid="favorite-button"
        onClick={() => {
          favoriteArticle(article.slug).then(
            (r) => setArticle(r.article),
            (e: Error) => {
              console.error('Favorite failed', e);
              setError(e.message);
            },
          );
        }}
      >
        ♥ {article.favoritesCount}
      </button>
      <button data-testid="back-home" onClick={() => navigate('/')}>
        Back
      </button>
    </main>
  );
}

function ProfilePage({ username }: { username: string }) {
  const [profile, setProfile] = useState<Article['author'] | null>(null);
  useEffect(() => {
    void getProfile(username).then((r) => setProfile(r.profile));
  }, [username]);
  if (!profile) return <p>Loading…</p>;
  return (
    <main>
      <h1 data-testid="profile-username">{profile.username}</h1>
      <p>{profile.bio ?? 'No bio yet.'}</p>
    </main>
  );
}

function LoginPage({ navigate }: { navigate: Nav }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <main>
      <h1>Sign in</h1>
      {error && <p data-testid="login-error">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login(email, password).then(
            (r) => {
              setToken(r.user.token);
              navigate('/');
            },
            (err: Error) => {
              console.error('Login failed', err);
              setError(err.message);
            },
          );
        }}
      >
        <input
          data-testid="login-email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          data-testid="login-password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button data-testid="login-submit" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}

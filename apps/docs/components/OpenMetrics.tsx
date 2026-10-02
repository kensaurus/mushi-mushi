/**
 * /open — public numbers, fetched once at build time (lib/open-metrics.ts).
 * Async server component: in the static export it runs during `next build`,
 * so the page ships plain HTML and the visitor's browser calls no API.
 * A source that failed renders as "unavailable at build time", never as 0.
 */
import { fetchOpenMetrics } from '../lib/open-metrics'

const fmt = new Intl.NumberFormat('en-US')
const day = (iso: string) => iso.slice(0, 10)

function Unavailable() {
  return <span className="docs-open__na">unavailable at build time</span>
}

export async function OpenMetrics() {
  const m = await fetchOpenMetrics()

  return (
    <div className="docs-open not-prose">
      <p className="docs-open__stamp">Fetched {day(m.fetchedAt)} (UTC), when this page was built.</p>

      <h2 className="docs-open__heading">Shipping</h2>
      <dl className="docs-open__grid">
        <div>
          <dt>Package releases, last 30 days</dt>
          <dd>{m.releases ? fmt.format(m.releases.last30) : <Unavailable />}</dd>
        </div>
        <div>
          <dt>Package releases, last 90 days</dt>
          <dd>{m.releases ? fmt.format(m.releases.last90) : <Unavailable />}</dd>
        </div>
        <div>
          <dt>Weekly digests, last 90 days</dt>
          <dd>{m.releases ? fmt.format(m.releases.weeklyDigestsLast90) : <Unavailable />}</dd>
        </div>
        <div>
          <dt>Commits to the default branch, last 30 days</dt>
          <dd>{m.commitsLast30 !== null ? fmt.format(m.commitsLast30) : <Unavailable />}</dd>
        </div>
        <div>
          <dt>Contributors on GitHub</dt>
          <dd>{m.contributors !== null ? fmt.format(m.contributors) : <Unavailable />}</dd>
        </div>
        <div>
          <dt>Latest release</dt>
          <dd>
            {m.releases?.latest ? (
              <>
                <code>{m.releases.latest.tag}</code> · {day(m.releases.latest.publishedAt)}
              </>
            ) : (
              <Unavailable />
            )}
          </dd>
        </div>
      </dl>

      <h2 className="docs-open__heading">npm downloads, last 7 days</h2>
      <p className="docs-open__caption">
        Raw counts from the npm downloads API. They include our own CI runs and the apps we run Mushi
        on ourselves, so they are an upper bound on outside use, not a count of users.
      </p>
      {m.npm ? (
        <table className="docs-open__table">
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Downloads</th>
              <th scope="col">Window</th>
            </tr>
          </thead>
          <tbody>
            {m.npm.map((row) => (
              <tr key={row.pkg}>
                <td>
                  <a href={`https://www.npmjs.com/package/${row.pkg}`} target="_blank" rel="noopener noreferrer">
                    <code>{row.pkg}</code>
                  </a>
                </td>
                <td>{fmt.format(row.downloads)}</td>
                <td>
                  {row.start} – {row.end}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          <Unavailable />
        </p>
      )}
    </div>
  )
}

/**
 * FILE: packages/server/src/__tests__/report-list-truth.test.ts
 * PURPOSE: /reports and /inbox counts match the lists they open, and every
 *          list filter the console sends is applied (2026-10-04 console audit,
 *          group B):
 *
 *   #16  platform / sdkPackage were sent and never read.
 *   #74  sort=severity ordered the text column alphabetically.
 *   #75  "Unset" severity sent '' and the DB CHECK turned it into a 500.
 *   #77  critical counts included fixed and dismissed reports.
 *   #231 KPI tiles counted a 14-day window the list never applied.
 *   #84  "Sync to N destinations" ignored Linear connected from the console.
 *   #85  "Generate test" wrapped the worker's envelope, hiding PR and errors.
 *   #240 the fix progress panel searched only the 50 newest fixes.
 *
 * Pure helpers are exercised directly; source contracts prove the routes use
 * them (the reports route imports too much Deno-only code to load here).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REPORT_LIST_PLATFORMS,
  REPORT_LIST_SDK_PACKAGES,
  REPORT_SORT_COLUMNS,
  combineOrGroups,
  parseSeverityUpdate,
  parseWindowDays,
  platformOrClause,
  reportWindowStartIso,
  resolveSdkPackageFilter,
} from '../../supabase/functions/_shared/report-list-filters.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')
const REPORTS = read('api/routes/reports.ts')
const DASHBOARD = read('api/routes/dashboard.ts')

function routeBody(src: string, signature: string, length = 6000): string {
  const start = src.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(0)
  return src.slice(start, start + length)
}

describe('platform filter (#16)', () => {
  it('maps each console option to the values the SDKs really send', () => {
    expect(platformOrClause('ios')).toContain('environment->>platform.ilike."iphone%"')
    expect(platformOrClause('ios')).toContain('environment->>platform.ilike."ios"')
    // Android Chrome reports navigator.platform as "Linux armv8l".
    expect(platformOrClause('android')).toContain('environment->>platform.ilike."linux arm%"')
    expect(platformOrClause('windows')).toContain('environment->>platform.ilike."win%"')
    expect(platformOrClause('macos')).toContain('environment->>platform.ilike."mac%"')
    // Web: Sentry's "javascript", the literal "web", or anything the web SDK stamped.
    expect(platformOrClause('web')).toContain('environment->>platform.ilike."javascript"')
    expect(platformOrClause('web')).toContain('sdk_package.eq.@mushi-mushi/web')
  })

  it('rejects values it does not know', () => {
    expect(platformOrClause('playstation')).toBeNull()
    expect(REPORT_LIST_PLATFORMS).not.toContain('playstation')
  })

  it('offers only SDK packages that stamp reports', () => {
    expect([...REPORT_LIST_SDK_PACKAGES]).toEqual(['@mushi-mushi/web', '@mushi-mushi/react-native'])
  })

  it('maps old wrapper SDK values to the web SDK and rejects the rest', () => {
    expect(resolveSdkPackageFilter('@mushi-mushi/react')).toBe('@mushi-mushi/web')
    expect(resolveSdkPackageFilter('@mushi-mushi/capacitor')).toBe('@mushi-mushi/web')
    expect(resolveSdkPackageFilter('@mushi-mushi/react-native')).toBe('@mushi-mushi/react-native')
    expect(resolveSdkPackageFilter('left-pad')).toBeNull()
  })

  it('every list row carries the dispatch rule the dispatch route enforces', () => {
    const list = routeBody(REPORTS, "app.get('/v1/admin/reports', adminOrApiKey()", 12000)
    expect(list).toContain('stage1_category:stage1_classification->>category')
    expect(list).toContain('const dispatch_block = featureRequestDispatchBlock(')
  })

  it('ANDs search and platform as one nested or= value', () => {
    expect(combineOrGroups([])).toBeNull()
    expect(combineOrGroups(['a.eq.1,b.eq.2'])).toBe('a.eq.1,b.eq.2')
    expect(combineOrGroups(['a.eq.1,b.eq.2', 'c.eq.3'])).toBe('and(or(a.eq.1,b.eq.2),or(c.eq.3))')
  })

  it('the list route reads platform, sdkPackage and days, and applies them', () => {
    const list = routeBody(REPORTS, "app.get('/v1/admin/reports', adminOrApiKey()", 9000)
    expect(list).toContain("c.req.query('platform')")
    expect(list).toContain("c.req.query('sdkPackage')")
    expect(list).toContain("c.req.query('days')")
    expect(list).toContain("query.eq('sdk_package', sdkPackageParam)")
    expect(list).toContain('platformOrClause(platformParam)')
    expect(list).toContain('combineOrGroups(orGroups)')
    expect(list).toContain("query.gte('created_at', reportWindowStartIso(windowDays))")
    // One .or() call: two would send two or= params.
    expect(list.match(/query\.or\(/g)?.length).toBe(1)
  })
})

describe('severity sort (#74)', () => {
  it('sorts severity by the generated rank column', () => {
    expect(REPORT_SORT_COLUMNS.severity).toBe('severity_rank')
    const list = routeBody(REPORTS, "app.get('/v1/admin/reports', adminOrApiKey()", 9000)
    expect(list).toContain("REPORT_SORT_COLUMNS[sortField] ?? 'created_at'")
  })

  it('the migration ranks critical highest', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261004160000_reports_severity_rank.sql'),
      'utf8',
    )
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS severity_rank/)
    expect(sql).toMatch(/WHEN 'critical' THEN 4/)
    expect(sql).toMatch(/WHEN 'low' THEN 1/)
  })
})

describe('severity "Unset" (#75)', () => {
  it('clears to null and rejects unknown values', () => {
    expect(parseSeverityUpdate('')).toEqual({ ok: true, value: null })
    expect(parseSeverityUpdate(null)).toEqual({ ok: true, value: null })
    expect(parseSeverityUpdate('high')).toEqual({ ok: true, value: 'high' })
    expect(parseSeverityUpdate('major')).toEqual({ ok: false })
    expect(parseSeverityUpdate(3)).toEqual({ ok: false })
  })

  it('PATCH validates severity before writing', () => {
    const patch = routeBody(REPORTS, "app.patch('/v1/admin/reports/:id'", 9000)
    const parse = patch.indexOf('parseSeverityUpdate(updates.severity)')
    const write = patch.indexOf('.update(updates)')
    expect(parse).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(parse)
  })
})

describe('one report window (#231, #77)', () => {
  it('starts at UTC midnight N-1 days ago', () => {
    const now = new Date('2026-10-04T15:30:00Z')
    expect(reportWindowStartIso(14, now)).toBe('2026-09-21T00:00:00.000Z')
    expect(reportWindowStartIso(1, now)).toBe('2026-10-04T00:00:00.000Z')
  })

  it('accepts 1..90 whole days only', () => {
    expect(parseWindowDays('14')).toBe(14)
    expect(parseWindowDays(undefined)).toBeNull()
    expect(parseWindowDays('0')).toBeNull()
    expect(parseWindowDays('91')).toBeNull()
    expect(parseWindowDays('1.5')).toBeNull()
  })

  it('severity KPIs, /reports/stats and the inbox use the same window helper', () => {
    expect(routeBody(REPORTS, "app.get('/v1/admin/reports/severity-stats'", 1200)).toContain('reportWindowStartIso(days)')
    expect(routeBody(REPORTS, "app.get('/v1/admin/reports/stats'", 3000)).toContain('reportWindowStartIso(14)')
    expect(routeBody(DASHBOARD, "app.get('/v1/admin/inbox/stats'", 3000)).toContain('reportWindowStartIso(14)')
  })

  it('/reports/stats counts only the active project, like totalAllTime and the list', () => {
    // glot.it, 2026-10-07: the 14-day tiles counted every project the caller owns.
    const start = REPORTS.indexOf("app.get('/v1/admin/reports/stats'")
    const end = REPORTS.indexOf('app.get(', start + 1)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const stats = REPORTS.slice(start, end)
    expect(stats).not.toContain(".in('project_id', projectIds)")
    const window = stats.slice(stats.indexOf(".select('id, status, severity, created_at')"))
    expect(window.slice(0, 200)).toContain(".eq('project_id', activeProject.id)")
  })

  it('the list understands status=active (what the KPI tiles count)', () => {
    const list = routeBody(REPORTS, "app.get('/v1/admin/reports', adminOrApiKey()", 9000)
    expect(list).toContain("status === 'active'")
    expect(list).toContain(".neq('status', 'dismissed')")
    const kpi = routeBody(REPORTS, "app.get('/v1/admin/reports/severity-stats'", 1500)
    expect(kpi).toContain(".neq('status', 'dismissed')")
  })
})

describe('critical counts only count open work (#77)', () => {
  it('the /reports banner counts critical reports in the New bucket and links to exactly that', () => {
    const stats = routeBody(REPORTS, "app.get('/v1/admin/reports/stats'", 7000)
    expect(stats).toContain("sev === 'critical' && (NEW_BUCKET_STATUSES as readonly string[]).includes(status)")
    expect(stats).toContain("scoped('/reports?status=new&severity=critical&days=14')")
  })

  it('the inbox critical tile counts open criticals; the Plan flag links to exactly what it counts', () => {
    const inbox = routeBody(DASHBOARD, "app.get('/v1/admin/inbox/stats'", 9000)
    // The tile (link status=open&severity=critical&days=14): open work only.
    const tile = inbox.slice(inbox.indexOf("'critical reports 14d'"), inbox.indexOf("'critical reports 14d'") + 400)
    expect(tile).toContain(".in('status', [...OPEN_REPORT_STATUSES])")
    expect(tile).toContain(".gte('created_at', sinceIso)")
    // The Plan flag counts the critical triage backlog and links to that list.
    expect(inbox).toContain("scoped('/reports?severity=critical&status=new')")
  })

  it('/v1/admin/dashboard exposes counts.openCritical14d with the same predicate', () => {
    const dash = routeBody(DASHBOARD, "app.get('/v1/admin/dashboard'", 20000)
    const count = dash.slice(dash.indexOf("'open critical 14d'"), dash.indexOf("'open critical 14d'") + 400)
    expect(count).toContain(".in('status', [...OPEN_REPORT_STATUSES])")
    expect(dash).toMatch(/openBacklog,\s+openCritical14d,/)
  })
})

describe('sync destinations include console-connected Linear (#84)', () => {
  const shared = read('_shared/integrations.ts')
  const routes = read('api/routes/integrations.ts')

  it('the sync and the count share one loader', () => {
    const create = routeBody(shared, 'export async function createExternalIssue(', 1500)
    expect(create).toContain('await loadSyncTargets(db, projectId)')
    const list = routeBody(shared, 'export async function listSyncDestinations(', 600)
    expect(list).toContain('await loadSyncTargets(db, projectId)')
    expect(list).toContain("[...types, 'linear']")
  })

  it('GET /v1/admin/integrations returns syncDestinations', () => {
    const get = routeBody(routes, "app.get('/v1/admin/integrations', jwtAuth", 3000)
    expect(get).toContain('listSyncDestinations(db, project.id as string)')
    expect(get).toContain('data: { integrations, syncDestinations }')
  })
})

describe('Generate test passes the worker envelope through (#85)', () => {
  it('returns the worker data flat on success and its error and status on failure', () => {
    const inv = read('api/routes/inventory.ts')
    const route = routeBody(inv, "'/v1/admin/inventory/:projectId/test-gen/from-report/:reportId'", 3500)
    expect(route).not.toContain('c.json({ ok: resp.ok, data: json })')
    expect(route).toContain('return c.json({ ok: true, data: json?.data ?? null })')
    expect(route).toContain("code: (workerError as { code?: string } | undefined)?.code ?? 'TEST_GEN_FAILED'")
  })
})

describe('fixes list filters by report (#240)', () => {
  it('reads report_id and narrows the query', () => {
    const fixes = read('api/routes/query-fixes-repo.ts')
    const route = routeBody(fixes, "c.req.query('report_id')", 1500)
    expect(route).toContain("query = query.eq('report_id', reportIdParam)")
  })
})

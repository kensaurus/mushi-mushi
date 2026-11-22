/**
 * FILE: packages/web/src/journey-recording.ts
 * PURPOSE: `trackSessions: 'on-demand'` (Journey optimizer, ADR 0058).
 *
 * In on-demand mode the session tracker sends nothing until one of:
 *   - this tab opted in with `?mushi_journeys=1` in the URL (kept for the tab
 *     in sessionStorage; `?mushi_journeys=0` opts out again), for the owner or
 *     a tester walking the app on purpose;
 *   - the console opened a recording window (`/v1/sdk/config` → `journeys`)
 *     and this device falls inside its sample. The draw is one random number
 *     kept per device, so the same visitor is in or out for the whole window.
 *
 * Real visitors outside a window pay nothing: no session, heartbeat or
 * page-view request. Deciding needs only the runtime config the SDK already
 * fetches on every load.
 */

type TrackSessionsMode = boolean | 'on-demand';

interface JourneyRecordingWindow {
  recordUntil: string;
  sampleRate: number;
}

const JOURNEY_URL_PARAM = 'mushi_journeys';

const tabKey = (projectId: string) => `mushi:journeys:tab:${projectId}`;
const drawKey = (projectId: string) => `mushi:journeys:draw:${projectId}`;

/** Pure: should this visit be recorded? */
export function journeyRecordingDecision(input: {
  mode: TrackSessionsMode | undefined;
  tabOptIn: boolean;
  window: JourneyRecordingWindow | null | undefined;
  /** This device's stable draw in [0, 1). */
  draw: number;
  now: number;
}): boolean {
  if (input.mode === false) return false;
  if (input.mode !== 'on-demand') return true;
  if (input.tabOptIn) return true;
  const w = input.window;
  if (!w) return false;
  const until = Date.parse(w.recordUntil);
  if (!Number.isFinite(until) || until <= input.now) return false;
  const rate = Number.isFinite(w.sampleRate) ? Math.min(1, Math.max(0, w.sampleRate)) : 0;
  return input.draw < rate;
}

/**
 * Read (and persist) this tab's URL opt-in. `?mushi_journeys=1` turns it on
 * for the tab, `?mushi_journeys=0` off; without the parameter the tab keeps
 * what it had. Storage failures (private mode, blocked) fall back to the URL.
 */
export function readTabOptIn(projectId: string): boolean {
  if (typeof window === 'undefined') return false;
  let fromUrl: string | null = null;
  try {
    fromUrl = new URL(window.location.href).searchParams.get(JOURNEY_URL_PARAM);
  } catch {
    fromUrl = null;
  }
  try {
    if (fromUrl === '1' || fromUrl === 'true') window.sessionStorage.setItem(tabKey(projectId), '1');
    else if (fromUrl === '0' || fromUrl === 'false') window.sessionStorage.removeItem(tabKey(projectId));
    return window.sessionStorage.getItem(tabKey(projectId)) === '1';
  } catch {
    return fromUrl === '1' || fromUrl === 'true';
  }
}

/** This device's stable random draw in [0, 1), created once and kept. */
export function deviceDraw(projectId: string, random: () => number = Math.random): number {
  if (typeof window === 'undefined') return random();
  try {
    const saved = Number(window.localStorage.getItem(drawKey(projectId)));
    if (window.localStorage.getItem(drawKey(projectId)) !== null && Number.isFinite(saved) && saved >= 0 && saved < 1) return saved;
    const fresh = random();
    window.localStorage.setItem(drawKey(projectId), String(fresh));
    return fresh;
  } catch {
    return random();
  }
}

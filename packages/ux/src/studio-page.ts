// SPDX-License-Identifier: MIT
/**
 * The studio's single page (served by dashboard.ts). Plain HTML + a small
 * script: no build step, no network beyond its own 127.0.0.1 server.
 *
 * Launcher: agent → live model list (with the model's own settings, e.g.
 * effort and context) → skill from the skills repo → pages → start.
 * Run view: phase and progress, burndown, every attempt's screenshot against
 * the baseline (slider, changed pixels), problems, and the agent's output.
 */

export const STUDIO_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mushi UX studio</title>
<style>
:root{--bg:#f6f6f3;--panel:#fff;--fg:#1c1c1a;--muted:#66665f;--line:#e2e2dc;--accent:#4f7f22;--accentfg:#fff;
--ok:#2f7d32;--okbg:#e6f3e6;--warn:#8a5a00;--warnbg:#fdf1d8;--bad:#a12a2a;--badbg:#fbe4e4;--info:#2b5c9a;--infobg:#e3edf9;--idle:#55554f;--idlebg:#ecece8}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--panel:#1d1d1b;--fg:#ececea;--muted:#a3a39c;--line:#2e2e2b;--accent:#9ccf5f;--accentfg:#14200a;
--ok:#8fd394;--okbg:#1e3320;--warn:#f1c46b;--warnbg:#3a2e14;--bad:#f19a9a;--badbg:#3b1d1d;--info:#9cc2f2;--infobg:#1b2a3d;--idle:#c4c4bd;--idlebg:#2a2a27}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--fg)}
button,select,input,textarea{font:inherit;color:inherit}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{font-size:15px;margin:0;display:flex;gap:6px;align-items:center}h1 small{color:var(--muted);font-weight:400}
.grow{flex:1}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 12px;cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accentfg);border-color:transparent;font-weight:600}
.btn:disabled{opacity:.5;cursor:not-allowed}.btn:focus-visible,select:focus-visible,input:focus-visible,nav button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
select,input[type=text],input[type=number],textarea{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 8px;min-width:0}
.status{padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);display:grid;gap:6px}
.status .top{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.meter{height:8px;background:var(--idlebg);border-radius:4px;overflow:hidden;display:flex}.meter i{display:block;height:100%}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.s-accepted,.p-done{background:var(--okbg);color:var(--ok)}.s-reverted,.p-failed{background:var(--badbg);color:var(--bad)}.s-regressed,.s-interrupted{background:var(--warnbg);color:var(--warn)}
.s-iterating,.s-baseline,.p-working,.p-install,.p-worktree,.p-dev-server,.p-mapping,.p-reviewing,.p-starting{background:var(--infobg);color:var(--info)}.s-pending,.s-skipped,.s-blocked{background:var(--idlebg);color:var(--idle)}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}.live .dot{animation:pulse 1.2s infinite}@keyframes pulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.live .dot{animation:none}}
.sub{color:var(--muted);font-size:12px}.mono{font-family:ui-monospace,monospace;font-size:12px}
main{display:grid;grid-template-columns:minmax(240px,320px) 1fr;min-height:calc(100vh - 110px)}
@media (max-width:860px){main{grid-template-columns:1fr}}
nav{border-right:1px solid var(--line);overflow:auto;max-height:calc(100vh - 110px)}
@media (max-width:860px){nav{max-height:260px;border-right:0;border-bottom:1px solid var(--line)}}
nav button{all:unset;box-sizing:border-box;display:block;width:100%;padding:9px 14px;border-bottom:1px solid var(--line);cursor:pointer}
nav button[aria-current=true]{background:var(--panel);box-shadow:inset 3px 0 0 var(--accent)}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center;min-width:0}.row .chip{flex-shrink:0}.label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
section.detail{padding:14px 18px;min-width:0}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{all:unset;box-sizing:border-box;padding:5px 10px;cursor:pointer;font-size:12px}
.seg button[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.compare{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}
.compare.mobile{max-width:420px}
.split{display:grid;gap:16px;align-items:start}.split>*{min-width:0}
.att[aria-busy=true]{grid-column:1/-1;cursor:default}.att[aria-busy=true] .ph{height:36px}.att .mono{overflow-wrap:anywhere}
@media (min-width:1100px){.split.mobile{grid-template-columns:minmax(0,420px) minmax(0,1fr)}.split.mobile .side h3:first-child{margin-top:0}}
.compare img{display:block;width:100%;height:auto}.compare .after{position:absolute;inset:0;clip-path:inset(0 0 0 var(--cut,50%))}
.compare .diff{position:absolute;inset:0;mix-blend-mode:multiply;opacity:.85}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair figure{margin:0;min-width:0}.pair figcaption{font-size:11px;color:var(--muted);margin-bottom:3px}
.pair img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.crop{border:1px solid var(--line);border-radius:8px;background-repeat:no-repeat;background-color:var(--panel);width:100%}
.changes{display:grid;gap:12px}.changes h4{margin:0 0 4px;font-size:12px;color:var(--muted);font-weight:600}
.cap{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:4px;gap:8px}
input[type=range]{width:100%;max-width:100%}
.plan{list-style:none;margin:6px 0 4px;padding:0;display:grid;gap:6px}.plan li{display:flex;gap:8px;align-items:flex-start;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--panel)}.plan .mark{width:16px;flex:none;text-align:center;font-weight:600}.pl-done .mark{color:var(--ok)}.pl-failed .mark{color:var(--bad)}.pl-skipped .mark,.pl-pending .mark{color:var(--idle)}.pl-now{border-color:var(--info)}.pl-now .mark{color:var(--info)}
.attempts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:14px}
.att{all:unset;box-sizing:border-box;cursor:pointer;border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden;display:flex;flex-direction:column}
.att[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.att img{width:100%;height:120px;object-fit:cover;object-position:top;background:var(--idlebg);display:block}
.att .body{padding:8px 10px;display:grid;gap:4px}
.ph{height:120px;display:grid;place-items:center;background:var(--idlebg);color:var(--muted);font-size:12px}
.problems{margin:8px 0 0;padding-left:18px;font-size:13px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;max-height:260px;overflow:auto;font-size:12px;margin:0}
h3{font-size:13px;margin:18px 0 6px}
.empty{color:var(--muted);padding:24px}
.form{max-width:860px;margin:0 auto;padding:18px 16px;display:grid;gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:grid;gap:10px}
.card h2{font-size:14px;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
label.f{display:grid;gap:4px;font-size:12px;color:var(--muted)}label.f>span{font-weight:600;color:var(--fg)}
.params{display:flex;flex-wrap:wrap;gap:10px}
.pills{display:flex;flex-wrap:wrap;gap:6px}.pill{all:unset;cursor:pointer;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:12px}
.pill[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.note{font-size:12px;color:var(--muted)}.warn{color:var(--warn)}.err{color:var(--bad)}
.card h2 .n{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:999px;background:var(--fg);color:var(--bg);font-size:11px;margin-right:6px}
.lede{font-size:12px;color:var(--muted);margin:-4px 0 0}
.choice{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.choice label{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:10px;cursor:pointer;font-size:12px;color:var(--muted)}
.choice label b{display:block;color:var(--fg);font-size:13px}
.choice label:has(input:checked){border-color:var(--fg)}
.summary{border:1px dashed var(--line);border-radius:10px;padding:10px;font-size:12px;display:grid;gap:4px}
.summary b{color:var(--fg)}
details.adv summary{cursor:pointer;font-size:12px;color:var(--muted)}
details.log{border-top:1px solid var(--line);background:var(--panel)}details.log summary{padding:8px 16px;cursor:pointer;font-size:12px;color:var(--muted)}details.log pre{border:0;border-radius:0;max-height:220px}details.steps{margin-top:8px}details.steps summary{cursor:pointer;font-size:12px;color:var(--muted)}details.steps pre{max-height:260px}
[hidden]{display:none!important}
</style></head><body>
<header>
  <h1><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-6" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/></svg>Mushi UX <small id="repo"></small></h1>
  <div class="grow"></div>
  <label class="sub" for="runPick">Run</label><select id="runPick" aria-label="Run"></select>
  <button class="btn primary" id="newBtn" hidden>＋ New run</button>
</header>
<div class="status" id="status" hidden>
  <div class="top"><span id="phase" class="chip"></span><span id="phaseDetail" class="sub"></span><span class="grow"></span><span id="clock" class="sub mono"></span><button class="btn" id="stopBtn" hidden>■ Stop</button><button class="btn primary" id="resumeBtn" hidden>▶ Resume</button><button class="btn primary" id="prBtn" hidden>Open draft PR</button><a class="btn" id="prLink" hidden target="_blank" rel="noopener"></a></div>
  <div class="meter" id="meter" role="img"></div>
  <div class="sub" id="who"></div>
</div>
<div id="launcher" hidden></div>
<main id="runview" hidden><nav id="list" aria-label="Screens"></nav><section class="detail" id="detail"><p class="empty">Pick a screen.</p></section></main>
<details class="log" id="logbox" hidden><summary>Run log</summary><pre id="runlog"></pre></details>
<script>
const T = new URLSearchParams(location.search).get('t')
const q = (p) => p + (p.includes('?') ? '&' : '?') + 't=' + T
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const api = (p, init) => fetch(q(p), init).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status)); return b })
const STATUS = { accepted: 'Improved', reverted: 'Rolled back', regressed: 'Moved by another change', iterating: 'Agent working', baseline: 'Measuring', interrupted: 'Stopped mid-attempt', pending: 'Queued', skipped: 'No change needed', blocked: 'Not finished' }
const PHASE = { starting: 'Starting', worktree: 'Creating worktree', install: 'Installing', 'dev-server': 'Starting dev server', mapping: 'Mapping screens', working: 'Working', reviewing: 'Reviewing', done: 'Done', failed: 'Failed' }
const FINISHED = ['accepted', 'reverted', 'skipped', 'regressed', 'blocked']
const store = { get(k) { try { return JSON.parse(localStorage.getItem('mushi-ux:' + k)) } catch { return null } }, set(k, v) { try { localStorage.setItem('mushi-ux:' + k, JSON.stringify(v)) } catch {} } }
let meta = null, runs = [], runId = null, state = null, selected = null, vp = 'mobile', diffOn = false, pick = null, view = 'changes'
const agentLog = {}, runLog = [], stepsFetched = new Set()
const chip = (st) => '<span class="chip s-' + st + '">' + esc(STATUS[st] || st) + '</span>'
const shot = (p) => q('/shot?run=' + encodeURIComponent(runId) + '&p=' + encodeURIComponent(p))
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's' }

// ── Run view ───────────────────────────────────────────────────────────────
function renderStatus() {
  const box = document.getElementById('status')
  if (!state) { box.hidden = true; return }
  box.hidden = false
  // A run that stopped mid-phase without saying so (process killed, machine slept) is not live.
  const unfinished = !['done', 'failed'].includes(state.phase || 'starting')
  // A run this studio did not start (another studio, mushi-ux run) is live while it checks in.
  const interrupted = unfinished && !(meta && runId === meta.active) && quietMinutes() > 0
  const ph = interrupted ? 'failed' : (state.phase || 'starting'), live = unfinished && !interrupted
  const el = document.getElementById('phase')
  el.className = 'chip p-' + ph + (live ? ' live' : '')
  el.innerHTML = (live ? '<span class="dot"></span>' : '') + esc(interrupted ? 'Interrupted' : (PHASE[ph] || ph))
  const pd = document.getElementById('phaseDetail')
  pd.textContent = interrupted
    ? 'This run stopped while ' + (PHASE[state.phase] || 'working').toLowerCase() + '. ' + (resumable() ? 'Resume carries on from the first unfinished screen.' : 'Continue it with: mushi-ux run --resume ' + state.runId)
    : state.error ? state.error.split('\\n')[0] : (state.phaseDetail || '')
  const quiet = live ? quietMinutes() : 0
  if (quiet) pd.textContent += ' · No check-in for ' + quiet + ' min: the run may have stopped. Check the terminal that started it.'
  // A read-only view (mushi-ux open) has no Resume button: say how to carry on.
  if (state.phase === 'failed' && !resumable()) pd.textContent += ' · Continue it with: mushi-ux run --resume ' + state.runId
  pd.className = state.error || interrupted ? 'sub err' : quiet ? 'sub warn' : 'sub'
  const total = state.surfaces.length, counts = {}
  for (const s of state.surfaces) counts[shownStatus(s)] = (counts[shownStatus(s)] || 0) + 1
  const done = state.surfaces.filter((s) => FINISHED.includes(s.status)).length
  const seg = (k, color) => counts[k] ? '<i style="width:' + (counts[k] / Math.max(1, total) * 100) + '%;background:' + color + '" title="' + esc(STATUS[k]) + ' ' + counts[k] + '"></i>' : ''
  const meter = document.getElementById('meter')
  meter.innerHTML = seg('accepted', 'var(--ok)') + seg('regressed', 'var(--warn)') + seg('reverted', 'var(--bad)') + seg('skipped', 'var(--idle)') + seg('blocked', 'var(--idle)') + seg('iterating', 'var(--info)')
  meter.setAttribute('aria-label', done + ' of ' + total + ' screens finished')
  const parts = [done + ' of ' + total + ' screens done', state.agent + (state.model ? ' · ' + state.model : '')]
  if (state.skill) parts.push('skill ' + state.skill.name)
  if (state.branch) parts.push(state.branch + (state.baseRef ? ' (from ' + state.baseRef + ')' : ''))
  document.getElementById('who').innerHTML = parts.map(esc).join(' · ') + ' &nbsp; ' + Object.entries(counts).map(([k, n]) => chip(k).replace('</span>', ' ' + n + '</span>')).join(' ')
  const stop = document.getElementById('stopBtn')
  stop.hidden = !(meta && meta.canStop && live && runId === meta.active)
  stop.disabled = false
  // Interrupted, failed or stopped: carry on from where it stopped, with the settings it started with.
  const resumeBtn = document.getElementById('resumeBtn')
  resumeBtn.hidden = !((interrupted || state.phase === 'failed') && resumable())
  resumeBtn.disabled = false
  // A finished run with kept changes: open its PR (or add it to the PR its branch came from), then merge from the console.
  const kept = state.surfaces.some((x) => x.iterations.some((it) => it.outcome === 'accepted' && it.commitSha))
  const prBtn = document.getElementById('prBtn'), prLink = document.getElementById('prLink')
  prBtn.hidden = !(meta && meta.canOpenPr && state.phase === 'done' && kept && !state.pr)
  prBtn.textContent = (state.baseRef || '').startsWith('origin/mushi-ux/') ? 'Add to its pull request' : 'Open draft PR'
  prLink.hidden = !state.pr
  if (state.pr) { prLink.href = state.pr.url; prLink.textContent = 'PR #' + state.pr.number + (state.pr.added ? ' (added) ↗' : ' ↗'); prLink.title = 'Merge it from the Mushi console once its checks pass' }
  tick()
}
/** Minutes since the run last saved its state (it does every 30 s while alive); 0 while it is fresh. */
function quietMinutes() {
  const hb = state && (state.updatedAt || (state.current && state.current.heartbeatAt))
  const gap = hb ? Date.now() - Date.parse(hb) : 0
  return gap > 3 * 60000 ? Math.floor(gap / 60000) : 0
}
/** The run is not going anywhere: it failed or stopped, or its process died without saying so. */
function runIsDead() {
  if (!state) return false
  if (state.phase === 'failed') return true
  const unfinished = state.phase !== 'done'
  return unfinished && !(meta && runId === meta.active) && quietMinutes() > 0
}
/** A screen the agent was on when the run died shows that, not "Agent working". */
function shownStatus(s) { return s.status === 'iterating' && runIsDead() ? 'interrupted' : s.status }
function tick() {
  if (!state) return
  const dead = runIsDead()
  // A dead run's clock stops at its last check-in instead of counting on.
  const end = state.finishedAt ? Date.parse(state.finishedAt) : dead ? Date.parse(state.updatedAt) : Date.now()
  let txt = 'elapsed ' + dur(end - Date.parse(state.createdAt))
  if (state.current && !state.finishedAt && !dead) txt = 'this attempt ' + dur(Date.now() - Date.parse(state.current.startedAt)) + (state.current.timeoutMs ? ' of ' + dur(state.current.timeoutMs) : '') + ' · ' + txt
  document.getElementById('clock').textContent = txt
}
setInterval(tick, 1000)
// Events can be missing (a run started elsewhere, a dropped stream): re-read an unfinished run's state.
setInterval(() => { if (state && !['done', 'failed'].includes(state.phase || 'starting') && !document.hidden) loadState() }, 15000)

function workingCard(s) {
  const c = state.current && state.current.surface === s.surface.key ? state.current : null
  const n = c ? c.attempt : s.iterations.length + 1
  if (runIsDead()) {
    return '<div class="att"><div class="ph">Stopped</div><div class="body"><div class="row"><strong>Attempt ' + n + '</strong>' + chip('interrupted') + '</div><div class="sub">The run stopped during this attempt. Its unfinished edits are thrown away and it runs again on Resume.</div></div></div>'
  }
  let body = '<div class="row"><strong>Attempt ' + n + '</strong><span class="chip s-iterating">working</span></div>'
  if (c) {
    body += '<div class="sub">' + (c.steps ? c.steps + ' step' + (c.steps === 1 ? '' : 's') : 'Reading the brief') + (c.lastStep ? ' · ' + esc(c.lastStep) : '') + '</div>'
    if (c.files && c.files.length) body += '<div class="sub mono">Changed so far: ' + c.files.slice(0, 6).map(esc).join(', ') + (c.files.length > 6 ? ' +' + (c.files.length - 6) + ' more' : '') + '</div>'
  }
  return '<div class="att" aria-busy="true"><div class="ph live" style="color:var(--info)"><span><span class="dot"></span> In progress</span></div><div class="body">' + body + '</div></div>'
}
/** Steps mode: the screen's plan as a checklist, the step being worked on marked. */
function planHtml(s) {
  if (!s.plan || !s.plan.steps || !s.plan.steps.length) return ''
  const working = shownStatus(s) === 'iterating'
  const now = working ? s.plan.steps.find((p) => p.status === 'pending') : null
  const MARK = { done: '✓', skipped: '–', failed: '✗', pending: '○' }
  const LABEL = { done: 'kept', skipped: 'not needed', failed: 'rolled back', pending: 'to do' }
  return '<h3>Plan: ' + s.plan.steps.filter((p) => p.status === 'done').length + ' of ' + s.plan.steps.length + ' steps kept</h3><ol class="plan">' + s.plan.steps.map((p) => {
    const cur = p === now
    const why = p.reason ? p.reason.replace(/^Step \\d+\\/\\d+: /, '') : ''
    return '<li class="pl-' + (cur ? 'now' : p.status) + '"><span class="mark" aria-hidden="true">' + (cur ? '▶' : MARK[p.status]) + '</span><div><div>' + esc(p.text) + ' <span class="sub">(' + (cur ? 'working now' : LABEL[p.status]) + ')</span></div>' + (why ? '<div class="sub">' + esc(why) + '</div>' : '') + '</div></li>'
  }).join('') + '</ol>'
}
function attemptsWithShots(s) { return s.iterations.filter((i) => i.after && (i.after.desktop || i.after.mobile)) }
function renderRun() {
  renderStatus()
  const list = document.getElementById('list')
  if (!state) { list.innerHTML = ''; document.getElementById('detail').innerHTML = '<p class="empty">No run selected.</p>'; return }
  const cur = state.current && state.current.surface
  list.innerHTML = state.surfaces.map((s) =>
    '<button data-k="' + esc(s.surface.key) + '" aria-current="' + (s.surface.key === selected) + '"><div class="row"><span class="label">' + (s.surface.key === cur && !runIsDead() ? '<span class="live" style="color:var(--info)"><span class="dot"></span></span> ' : '') + esc(s.surface.label) + '</span>' + chip(shownStatus(s)) + '</div><div class="sub mono">' + esc(s.surface.path) + (s.surface.steps.length ? ' › ' + esc(s.surface.steps.map((x) => x.label).join(' › ')) : '') + (s.iterations.length ? ' · ' + s.iterations.length + ' attempt' + (s.iterations.length === 1 ? '' : 's') : '') + '</div></button>').join('') || '<p class="empty">' + (state.phase === 'mapping' ? 'Mapping screens…' : 'No screens yet.') + '</p>'
  list.querySelectorAll('button').forEach((b) => b.onclick = () => { selected = b.dataset.k; pick = null; renderRun() })
  const s = state.surfaces.find((x) => x.surface.key === selected) || state.surfaces.find((x) => x.surface.key === cur) || state.surfaces[0]
  const box = document.getElementById('detail')
  if (!s) {
    box.innerHTML = state.error
      ? '<h3>The run stopped</h3><pre>' + esc(state.error) + '</pre><p class="sub">The run log below has the full output. Fix the cause, then start a new run.</p>'
      : '<p class="empty">' + esc(PHASE[state.phase] || 'Waiting') + '…</p>'
    if (state.error) document.getElementById('logbox').open = true
    return
  }
  selected = s.surface.key
  const atts = attemptsWithShots(s)
  const chosen = pick == null ? atts[atts.length - 1] : atts.find((a) => a.n === pick)
  const base = s.baseline[vp] || s.baseline.desktop, after = chosen && (chosen.after[vp] || null)
  let html = '<div class="row"><h2 style="margin:0;font-size:18px">' + esc(s.surface.label) + '</h2>' + chip(shownStatus(s)) + '</div>'
  if (s.note) html += '<p class="sub">' + esc(s.note) + '</p>'
  html += '<div class="toolbar"><div class="seg" role="group" aria-label="Viewport">' + ['mobile', 'desktop'].map((v) => '<button data-vp="' + v + '" aria-pressed="' + (v === vp) + '">' + v + '</button>').join('') + '</div>'
  if (after) html += '<div class="seg" role="group" aria-label="How to compare">' + [['changes', 'Changes'], ['side', 'Side by side'], ['slider', 'Slider']].map(([v, l]) => '<button data-view="' + v + '" aria-pressed="' + (v === view) + '">' + l + '</button>').join('') + '</div>'
  if (after && view === 'slider') html += '<label class="sub"><input type="checkbox" id="diff"' + (diffOn ? ' checked' : '') + '> Show changed pixels</label>'
  // Wide screens: the phone screenshot on the left, attempts and the agent's steps beside it.
  html += '</div><div class="split ' + vp + '"><div>'
  let problemsHtml = ''
  if (base) {
    // Before = the screen this attempt started from (the last kept step), so every view shows what THIS attempt changed.
    const prev = after ? startedFrom(s, chosen.n, vp) : null
    if (after && view === 'changes') html += changesHtml(prev, after, chosen, s)
    else if (after && view === 'side') html += '<div class="pair"><figure><figcaption>Before ' + esc(stepName(s, chosen.n, true)) + ' · problem score ' + prev.penalty + '</figcaption><img alt="Before" src="' + shot(prev.png) + '"></figure><figure><figcaption>' + esc(stepName(s, chosen.n)) + ' · problem score ' + after.penalty + '</figcaption><img alt="After" src="' + shot(after.png) + '"></figure></div>'
    else {
      html += '<div class="compare ' + vp + '" id="cmp"><img alt="Before" src="' + shot((prev || base).png) + '">' + (after ? '<img class="after" alt="After" src="' + shot(after.png) + '">' : '') + (after && diffOn && chosen.diffPng[vp] ? '<img class="diff" alt="Changed pixels" src="' + shot(chosen.diffPng[vp]) + '">' : '') + '</div>'
      if (after) html += '<input type="range" id="cut" min="0" max="100" value="50" aria-label="Before / after split"><div class="cap"><span>◀ Before · problem score ' + prev.penalty + '</span><span>' + esc(stepName(s, chosen.n)) + ' · problem score ' + after.penalty + ' ▶</span></div><p class="sub">Drag the handle: left of it is before, right of it is after. One screenshot split in two, not cut off.</p>'
      else html += '<div class="cap"><span>Baseline · problem score ' + base.penalty + '</span><span>' + (shownStatus(s) === 'iterating' ? 'Agent working…' : '') + '</span></div>'
    }
    const probes = (after || base).probes, lines = []
    for (const a of probes.axe || []) lines.push(a.help + ' (' + a.count + ')')
    if (probes.overflowX) lines.push('Scrolls sideways')
    if (probes.smallTargets) lines.push(probes.smallTargets + ' tap target(s) under 24 px')
    for (const e of (probes.consoleErrors || []).slice(0, 3)) lines.push('Console: ' + e)
    if (lines.length) problemsHtml = '<h3>Problems measured on ' + (after ? 'attempt ' + chosen.n : 'the baseline') + ' (' + vp + ')</h3><ul class="problems">' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>'
  } else html += '<p class="empty">No screenshot yet.</p>'
  html += '</div><div class="side">' + planHtml(s) + '<h3>Attempts</h3><div class="attempts">' + s.iterations.map((i) => {
    const a = i.after[vp] || i.after.desktop || i.after.mobile
    const tone = i.outcome === 'accepted' ? 'accepted' : i.outcome === 'rejected' || i.outcome === 'capture_failed' ? 'reverted' : 'skipped'
    return '<button class="att" data-n="' + i.n + '" aria-pressed="' + (chosen && chosen.n === i.n) + '"' + (a ? '' : ' disabled') + '>' + (a ? '<img alt="Attempt ' + i.n + '" loading="lazy" src="' + shot(a.png) + '">' : '<div class="ph">no screenshot</div>') + '<div class="body"><div class="row"><strong>Attempt ' + i.n + '</strong>' + chip(tone).replace(/>[^<]+</, '>' + esc(i.outcome.replace('_', ' ')) + '<') + '</div>' + (i.needsReview ? '<div class="sub warn">Needs your review: nothing visible changed</div>' : '') + (i.checker ? '<div class="sub">' + esc(checkerLine(i.checker)) + '</div>' : '') + '<div class="sub">' + esc(i.reason) + '</div><div class="sub mono">' + dur(i.durationMs) + (i.pixelDiff[vp] != null ? ' · ' + (i.pixelDiff[vp] * 100).toFixed(1) + '% px' : '') + (i.commitSha ? ' · ' + i.commitSha.slice(0, 8) : '') + '</div></div></button>'
  }).join('') + (s.status === 'iterating' ? workingCard(s) : '') + '</div>'
  if (!s.iterations.length && s.status !== 'iterating') html += '<p class="sub">No attempts yet.</p>'
  const mine = (agentLog[selected] || []).slice(-80)
  const stepsTitle = { iterating: 'Agent steps (live)', interrupted: 'Agent steps before the run stopped' }[shownStatus(s)] || 'Agent steps, last attempt'
  if (mine.length) html += '<h3>' + stepsTitle + '</h3><pre id="agentout">' + esc(mine.join('\\n')) + '</pre>'
  else if (shownStatus(s) === 'iterating') html += '<h3>' + stepsTitle + '</h3><pre id="agentout" class="sub">Steps appear here as the agent reads and edits files.</pre>'
  html += problemsHtml
  const jv = (s.judge || []).find((v) => v.viewport === vp)
  if (jv) html += '<h3>Review by ' + esc(jv.model) + ' (advisory)</h3><p class="sub">' + esc(jv.error || ('Prefers ' + (jv.preferred === 'tie' ? 'neither' : jv.preferred === 'after' ? 'the new version' : 'the original') + ' (' + jv.confidence + ' confidence). ' + jv.summary)) + '</p>'
  for (const i of s.iterations) if (i.logTail) html += '<details class="steps"><summary>What the agent did in attempt ' + i.n + '</summary><pre>' + esc(i.logTail) + '</pre></details>'
  html += '</div></div>'
  box.innerHTML = html
  // After a reload the live stream has nothing yet: read the saved steps once.
  const stepsKey = runId + ' ' + selected
  if (s.status === 'iterating' && !mine.length && !stepsFetched.has(stepsKey)) {
    stepsFetched.add(stepsKey)
    const forRun = runId, forSurface = selected
    api('/api/steps?run=' + encodeURIComponent(forRun) + '&surface=' + encodeURIComponent(forSurface)).then(({ lines }) => {
      if (runId !== forRun || !lines.length || (agentLog[forSurface] || []).length) return
      agentLog[forSurface] = lines
      if (selected === forSurface) renderRun()
    }).catch(() => {})
  }
  box.querySelectorAll('[data-vp]').forEach((b) => b.onclick = () => { vp = b.dataset.vp; renderRun() })
  box.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { view = b.dataset.view; renderRun() })
  box.querySelectorAll('.att[data-n]').forEach((b) => b.onclick = () => { pick = Number(b.dataset.n); renderRun() })
  const d = document.getElementById('diff'); if (d) d.onchange = () => { diffOn = d.checked; renderRun() }
  const c = document.getElementById('cut'); if (c) c.oninput = () => document.getElementById('cmp').style.setProperty('--cut', c.value + '%')
  const out = document.getElementById('agentout'); if (out) out.scrollTop = out.scrollHeight
}
// ── Before / after ─────────────────────────────────────────────────────────
/** The screenshot attempt n started from: the last kept attempt before it, else the baseline. */
const changeCache = {}
function checkerLine(c) {
  if (c.error) return c.model + ': review failed'
  const votes = (c.votes || []).map((v) => v.preferred).join(' / ')
  return c.model + ': ' + (c.verdict === 'revert' ? 'rolled back' : c.verdict === 'keep' ? 'agrees' : 'unsure') + (votes ? ' (' + votes + ')' : '')
}
function startedFrom(s, n, v) {
  const kept = s.iterations.filter((i) => i.n < n && i.outcome === 'accepted' && i.after[v]).pop()
  return (kept && kept.after[v]) || s.baseline[v] || s.baseline.desktop
}
function stepName(s, n, before) {
  const it = s.iterations.find((i) => i.n === n), steps = (s.plan && s.plan.steps) || []
  const k = it && it.step ? steps.findIndex((p) => p.text === it.step) : -1
  return k >= 0 ? (before ? 'step ' : 'Step ') + (k + 1) : (before ? 'attempt ' : 'Attempt ') + n
}
/** One changed area as a zoomed crop of a screenshot (CSS sprite maths, no canvas). */
function cropHtml(png, box, size, label) {
  const sx = box.w >= size.width ? 0 : (box.x / (size.width - box.w)) * 100
  const sy = box.h >= size.height ? 0 : (box.y / (size.height - box.h)) * 100
  const style = 'aspect-ratio:' + box.w + '/' + box.h + ';background-image:url(&quot;' + shot(png) + '&quot;);background-size:' + (size.width / box.w) * 100 + '% auto;background-position:' + sx + '% ' + sy + '%'
  return '<figure><figcaption>' + esc(label) + '</figcaption><div class="crop" role="img" aria-label="' + esc(label) + '" style="' + style + '"></div></figure>'
}
function changesHtml(prev, after, it, s) {
  let ch = it.changes && it.changes[vp]
  const pct = it.pixelDiff[vp] != null ? (it.pixelDiff[vp] * 100).toFixed(1) + '% of the screen changed' : ''
  if (!ch && it.diffPng && it.diffPng[vp]) {
    // An older attempt: work the areas out from its saved diff image once.
    const key = runId + ' ' + it.diffPng[vp]
    ch = changeCache[key]
    if (!ch) {
      if (!changeCache[key + '?']) {
        changeCache[key + '?'] = true
        api('/api/changes?run=' + encodeURIComponent(runId) + '&p=' + encodeURIComponent(it.diffPng[vp])).then((c) => { changeCache[key] = c; renderRun() }).catch(() => {})
      }
      return '<p class="sub">Finding the changed areas…</p>'
    }
  }
  if (!ch) return '<p class="sub">No change areas for this attempt. Use Side by side.</p>'
  if (!ch.boxes.length) return '<p class="sub">Nothing changed on this screen in this attempt.</p>'
  return '<div class="changes"><p class="sub">' + ch.boxes.length + ' changed area' + (ch.boxes.length === 1 ? '' : 's') + (pct ? ' · ' + pct : '') + '. Each is shown before and after ' + esc(stepName(s, it.n, true)) + ', zoomed in.</p>' + ch.boxes.map((b, i) =>
    '<div><h4>Change ' + (i + 1) + ' · ' + b.w + '×' + b.h + ' px at ' + b.x + ',' + b.y + '</h4><div class="pair">' + cropHtml(prev.png, b, ch, 'Before') + cropHtml(after.png, b, ch, 'After') + '</div></div>').join('') + '</div>'
}
async function loadState() { state = runId ? await api('/api/state?run=' + runId).catch(() => state) : null; renderRun() }
async function loadRuns() {
  runs = (await api('/api/runs')).runs
  const sel = document.getElementById('runPick')
  sel.innerHTML = runs.map((r) => '<option value="' + esc(r.runId) + '"' + (r.runId === runId ? ' selected' : '') + '>' + esc(new Date(r.createdAt).toLocaleString()) + ' · ' + esc(r.agent) + (r.model ? ' ' + esc(r.model) : '') + ' · ' + r.done + '/' + r.total + '</option>').join('') || '<option>No runs yet</option>'
  sel.disabled = !runs.length
}
function showRun(id) {
  runId = id; selected = null; pick = null
  document.getElementById('launcher').hidden = true
  document.getElementById('runview').hidden = false
  document.getElementById('logbox').hidden = false
  const logEl = document.getElementById('runlog')
  logEl.textContent = ''
  history.replaceState(null, '', '?t=' + T + '&run=' + id)
  loadState()
  // The saved log first (past runs, a restarted studio), then live lines arrive over events.
  api('/api/log?run=' + id).then(({ lines }) => {
    if (runId !== id) return
    logEl.textContent = lines.join('\\n')
    logEl.scrollTop = logEl.scrollHeight
  }).catch(() => {})
}
document.getElementById('runPick').onchange = (e) => showRun(e.target.value)

// ── Launcher ───────────────────────────────────────────────────────────────
let options = null, models = null
async function openLauncher() {
  document.getElementById('runview').hidden = true
  document.getElementById('logbox').hidden = true
  document.getElementById('status').hidden = true
  const box = document.getElementById('launcher')
  box.hidden = false
  box.innerHTML = '<div class="form"><div class="card"><h2>New run</h2><p class="note">Checking which coding agents are installed and signed in, this repo’s branches and its pages. This takes up to 20 seconds.</p></div></div>'
  options = await api('/api/options').catch((e) => ({ error: e.message }))
  const last = store.get('last') || {}
  const agents = options.agents || []
  const agentOpt = (a) => '<option value="' + esc(a.name) + '"' + (a.name === (last.agent || options.defaultAgent) ? ' selected' : '') + (a.installed ? '' : ' disabled') + '>' + esc(a.label) + (a.installed ? '' : ' — ' + esc(a.note || 'not found')) + '</option>'
  const refOpt = (r) => '<option value="' + esc(r.ref) + '"' + (r.ref === (last.baseRef || options.defaultRef) ? ' selected' : '') + '>' + esc(r.label) + '</option>'
  const lastPaths = last.startPaths || (options.lastRun ? options.lastRun.startPaths : [])
  const whole = lastPaths.length === 0
  box.innerHTML = '<form class="form" id="lf" novalidate>' +
    '<div class="card"><h2><span class="n">1</span>What to improve</h2>' +
      '<p class="lede">The agent works one screen at a time on its own branch. Each change is measured (accessibility, layout, console) and kept only if nothing got worse.</p>' +
      '<div class="choice" role="radiogroup" aria-label="Which screens">' +
        '<label><input type="radio" name="f-scope" value="whole"' + (whole ? ' checked' : '') + '><span><b>The whole app</b>Map screens from the home page and the links it opens, up to the screen limit below.</span></label>' +
        '<label><input type="radio" name="f-scope" value="pages"' + (whole ? '' : ' checked') + '><span><b>Pages I pick</b>Only these pages, plus the tabs and dialogs they open.</span></label>' +
      '</div>' +
      '<div id="f-pages-box" class="card" style="padding:10px"' + (whole ? ' hidden' : '') + '>' +
        '<label class="f"><span>Pages (comma-separated, or click below)</span><input type="text" id="f-paths" autocomplete="off" value="' + esc(lastPaths.join(', ')) + '"></label>' +
        '<div class="pills" id="f-route-pills">' + (options.routes || []).slice(0, 40).map((r) => '<button type="button" class="pill" data-r="' + esc(r) + '" aria-pressed="false">' + esc(r) + '</button>').join('') + '</div>' +
        '<label class="sub"><input type="checkbox" id="f-crawl"' + (last.crawl ? ' checked' : '') + '> Also follow links from these pages</label>' +
      '</div>' +
      '<div class="grid">' +
        '<label class="f"><span>Skills: what the agent focuses on, applied in order (' + esc(options.skillsRepo || 'skills package') + ')</span><select id="f-skill"><option value="">Add a skill…</option></select></label>' +
        '<label class="f"><span>…or your own SKILL.md / folder</span><input type="text" id="f-skill-path" placeholder="./skills/my-skill" autocomplete="off"></label>' +
      '</div><div class="pills" id="f-chain" aria-label="Skill chain"></div><div class="pills" id="f-next"></div><div class="note" id="f-skill-note"></div>' +
      '<label class="sub"><input type="checkbox" id="f-steps"' + (last.steps === false ? '' : ' checked') + '> Small steps (recommended): plan each screen first, then one small change per attempt, each kept or rolled back on its own</label>' +
    '</div>' +
    '<div class="card"><h2><span class="n">2</span>Who does the work</h2><div class="grid">' +
      '<label class="f"><span>Coding agent</span><select id="f-agent">' + agents.map(agentOpt).join('') + '</select></label>' +
      '<label class="f"><span>Model</span><select id="f-model"><option>Loading…</option></select></label>' +
      '<label class="f" id="f-custom-wrap" hidden><span>Model id</span><input type="text" id="f-custom" placeholder="e.g. grok-4.7" autocomplete="off"></label>' +
    '</div><div class="params" id="f-params"></div><div class="note" id="f-model-note"></div>' +
    '<div class="summary" id="f-account"><span class="note">Checking the account…</span></div>' +
    '<div class="grid">' +
      '<label class="f"><span>Checker: a second model reviews each kept step and may roll it back</span><select id="f-checker">' + checkerOptions(agents, last) + '</select></label>' +
    '</div>' +
    '<div class="note">The checker sees the changed area before and after, twice with the order swapped, and rolls a step back only when both reviews prefer the original. It never keeps a step the measurements rejected. Each checked step costs about $0.20–0.50 of your Claude usage (two reviews; measured $0.46 on glot.it).</div>' +
    '<label class="sub"><input type="checkbox" id="f-invisible"' + (last.keepInvisible === false ? '' : ' checked') + '> Keep changes that are not visible in a screenshot (motion, haptics, press feedback) and flag them for your review</label>' +
    '<div class="row"><span class="sub mono" id="f-spec"></span><button type="button" class="btn" id="f-refresh">Refresh list</button></div></div>' +
    '<div class="card"><h2><span class="n">3</span>How much</h2><div class="grid">' +
      '<label class="f"><span>Screens at most</span><input type="number" id="f-max" min="1" max="100" value="' + (last.maxSurfaces || 8) + '"></label>' +
      '<label class="f"><span>Attempts (steps) per screen</span><input type="number" id="f-iter" min="1" max="5" value="' + (last.iterations || 4) + '"></label>' +
      '<label class="f"><span>Minutes per attempt</span><input type="number" id="f-timeout" min="1" max="60" value="' + (last.timeoutMin || 8) + '"></label>' +
    '</div><div class="summary" id="f-estimate"></div></div>' +
    '<div class="card"><h2><span class="n">4</span>Your app</h2><div class="grid">' +
      '<label class="f" style="grid-column:1/-1"><span>Dev command ({port} is replaced)</span><input type="text" id="f-dev" list="f-devs" autocomplete="off"><datalist id="f-devs">' + (options.devCommands || []).map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist></label>' +
      '<label class="f"><span>Branch from</span><select id="f-base">' + (options.refs || [{ ref: 'HEAD', label: 'HEAD' }]).map(refOpt).join('') + '</select></label>' +
    '</div>' +
    (options.lastRun ? '<div class="note">Run ' + esc(options.lastRun.runId) + ' mapped screens with <code>' + esc(options.lastRun.devCommand) + '</code>, so it is first in the list.</div>' : '') +
    '<div class="note warn" id="f-dev-warn">' + esc(options.devWarning || '') + '</div>' +
    '<details class="adv"><summary>Advanced: parts of the page to leave out</summary>' +
    '<label class="f"><span>Not part of the app (CSS selectors, one per line): hidden in screenshots and skipped by every check</span><textarea id="f-ignore" rows="2" autocomplete="off" spellcheck="false" placeholder=".dev-badge">' + esc((last.ignore || []).join('\\n')) + '</textarea></label>' +
    '<div class="note">Dev overlays, build stamps and the Mushi widget are already skipped. Add your own here, or mark an element with <code>data-mushi-ux-ignore</code>.</div></details></div>' +
    '<div class="card"><h2>After the run</h2><div class="grid">' +
      '<label class="f"><span><input type="checkbox" id="f-judge"' + (options.judgeAvailable ? (last.judge === false ? '' : ' checked') : ' disabled') + '> Second-model review</span><input type="text" id="f-judge-model" value="' + esc(last.judgeModel || options.judgeModel || '') + '"' + (options.judgeAvailable ? '' : ' disabled') + '></label>' +
      '<label class="f"><span><input type="checkbox" id="f-sync"' + (options.syncAvailable ? (last.sync ? ' checked' : '') : ' disabled') + '> Mirror to the Mushi console</span><span class="note">' + esc(options.syncNote || '') + '</span></label>' +
    '</div>' + (options.judgeAvailable ? '' : '<div class="note">Review needs ANTHROPIC_API_KEY in this shell.</div>') + '</div>' +
    '<div class="row"><span class="note err" id="f-error"></span><button class="btn primary" id="f-start" type="submit">▶ Start run</button></div></form>'
  document.getElementById('f-dev').value = last.devCommand || (options.devCommands || [])[0] || ''
  syncPills()
  document.getElementById('f-paths').oninput = syncPills
  box.querySelectorAll('input[name=f-scope]').forEach((r) => r.onchange = () => { document.getElementById('f-pages-box').hidden = scope() !== 'pages'; estimate() })
  ;['f-max', 'f-iter', 'f-timeout', 'f-steps'].forEach((id) => document.getElementById(id).addEventListener('input', estimate))
  estimate()
  box.querySelectorAll('.pill').forEach((p) => p.onclick = () => {
    const input = document.getElementById('f-paths'), set = new Set(input.value.split(',').map((x) => x.trim()).filter(Boolean))
    set.has(p.dataset.r) ? set.delete(p.dataset.r) : set.add(p.dataset.r)
    input.value = [...set].join(', '); syncPills()
  })
  document.getElementById('f-agent').onchange = () => loadModels(false)
  document.getElementById('f-refresh').onclick = () => loadModels(true)
  document.getElementById('f-model').onchange = renderParams
  document.getElementById('f-custom').oninput = updateSpec
  document.getElementById('lf').onsubmit = (e) => { e.preventDefault(); start() }
  loadModels(false)
  loadSkills(last.skill)
}
function checkerOptions(agents, last) {
  const claude = agents.some((a) => a.name === 'claude-code' && a.installed)
  const opts = [['', 'None: measurements alone decide']]
  if (claude) opts.push(['claude-code|claude-opus-5-5', 'Claude Opus 5.5, via Claude Code (your sign-in)'], ['claude-code|claude-sonnet-5-5', 'Claude Sonnet 5.5, via Claude Code (cheaper)'])
  if (options.judgeAvailable) opts.push(['anthropic-api|claude-opus-5-5', 'Claude Opus 5.5, via the Anthropic API key'])
  const want = last.checkerModel ? (last.checkerVia || 'claude-code') + '|' + last.checkerModel : (claude ? 'claude-code|claude-opus-5-5' : '')
  return opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === want ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + (claude ? '' : '<option disabled>Claude Code not found: install it to use Claude as the checker</option>')
}
function checkerPick() {
  const v = document.getElementById('f-checker').value
  if (!v) return { model: null, via: 'claude-code' }
  const [via, model] = v.split('|')
  return { model, via }
}
function scope() { const r = document.querySelector('input[name=f-scope]:checked'); return r ? r.value : 'whole' }
// Published per-million-token prices (cursor.com/docs/models-and-pricing, read 2026-10-07).
const PRICES = [
  ['grok-4.7', 'Grok 4.7: $2 in / $6 out per million tokens; the Fast tier, the default speed on Pro and above, is $4 / $12. A Cursor model, so it draws on the larger included pool first.'],
  ['opus-5.5', 'Claude Opus 5.5: $4 in / $20 out per million tokens.'],
  ['opus-5-5', 'Claude Opus 5.5: $4 in / $20 out per million tokens.'],
  ['sonnet-5.5', 'Claude Sonnet 5.5: $2 in / $10 out per million tokens.'],
  ['sonnet-5-5', 'Claude Sonnet 5.5: $2 in / $10 out per million tokens.'],
  ['composer', 'A Cursor model: it draws on the larger included pool first.'],
]
function priceNote() {
  const spec = (modelSpec() || '').toLowerCase()
  const hit = PRICES.find(([k]) => spec.includes(k))
  return hit ? hit[1] : 'Billed at the model’s API rate: first from your plan’s included usage, then on-demand if you allow it.'
}
function estimate() {
  const num = (id, d) => { const n = parseInt(document.getElementById(id).value, 10); return Number.isFinite(n) && n > 0 ? n : d }
  const screens = num('f-max', 8), tries = num('f-iter', 4), mins = num('f-timeout', 8), steps = document.getElementById('f-steps').checked
  const worst = screens * (tries * mins + (steps ? 4 : 0)) + 5
  const h = Math.floor(worst / 60), m = worst % 60
  document.getElementById('f-estimate').innerHTML =
    '<span><b>Up to ' + screens * tries + ' attempts</b> (' + screens + ' screen' + (screens === 1 ? '' : 's') + ' × ' + tries + (steps ? ' steps, after a planning pass of up to 4 min each' : ' attempts') + ').</span>' +
    '<span>Worst case about <b>' + (h ? h + ' h ' : '') + m + ' min</b> of agent time, since every attempt stops at its time box. Runs usually end sooner: a step that needs no change moves on.</span>' +
    '<span class="note">' + (scope() === 'whole' ? 'Whole app: screens are mapped from the home page until the limit above.' : 'Pages you picked: at most ' + screens + ' of them are worked on.') + '</span>'
}
const accounts = {}
async function loadAccount() {
  const agent = document.getElementById('f-agent').value, box = document.getElementById('f-account')
  // The CLI call takes a second or two; a model change only redraws the price.
  accounts[agent] = accounts[agent] || api('/api/account?agent=' + encodeURIComponent(agent)).catch(() => ({ account: null }))
  const r = await accounts[agent]
  const a = r.account
  const who = a ? '<span>Spends <b>' + esc(a.email || 'your account') + '</b>' + (a.plan ? ' · ' + esc(a.plan) + ' plan' : '') + '. To use a different account, sign in with that one in this shell (<code>agent login</code>) and restart the studio.</span>' : '<span>Spends the account this agent is signed in with in this shell.</span>'
  const usage = '<span class="note">No agent reports how much credit is left, so this cannot show a balance. ' + (a && a.usageUrl ? 'Check it on <a href="' + esc(a.usageUrl) + '" target="_blank" rel="noopener">your usage page</a>. ' : '') + 'If the account runs out mid-run, the run stops; resume it later or with another account.</span>'
  box.innerHTML = who + '<span>' + esc(priceNote()) + '</span>' + usage
}
function syncPills() {
  const set = new Set(document.getElementById('f-paths').value.split(',').map((x) => x.trim()))
  document.querySelectorAll('#f-route-pills .pill').forEach((p) => p.setAttribute('aria-pressed', String(set.has(p.dataset.r))))
}
async function loadModels(force) {
  const agent = document.getElementById('f-agent').value, sel = document.getElementById('f-model'), note = document.getElementById('f-model-note')
  sel.innerHTML = '<option>Loading…</option>'; note.textContent = ''
  models = await api('/api/models?agent=' + encodeURIComponent(agent) + (force ? '&fresh=1' : '')).catch((e) => ({ models: [], note: e.message }))
  const last = store.get('last') || {}, lastModel = (last.agent === agent && last.model) ? last.model.split('?')[0] : null
  const def = models.models.find((m) => m.id === lastModel) || models.models.find((m) => m.isDefault)
  sel.innerHTML = '<option value="">Agent default</option>' + models.models.map((m) => '<option value="' + esc(m.id) + '"' + (def && def.id === m.id ? ' selected' : '') + '>' + esc(m.label === m.id ? m.id : m.label + ' — ' + m.id) + '</option>').join('') + '<option value="__custom">Other model id…</option>'
  note.textContent = (models.source === 'live' ? models.models.length + ' models from your account. ' : '') + (models.note || '')
  note.className = models.source === 'none' && models.note ? 'note warn' : 'note'
  if (lastModel && !def) { sel.value = '__custom'; document.getElementById('f-custom').value = lastModel }
  renderParams()
}
function renderParams() {
  const id = document.getElementById('f-model').value
  document.getElementById('f-custom-wrap').hidden = id !== '__custom'
  const m = models && models.models.find((x) => x.id === id), last = store.get('last') || {}
  const lastParams = new URLSearchParams((last.model || '').split('?')[1] || '')
  document.getElementById('f-params').innerHTML = (m && m.params ? m.params : []).map((p) => '<label class="f"><span>' + esc(p.label) + '</span><select data-param="' + esc(p.id) + '"><option value="">default</option>' + p.values.map((v) => '<option value="' + esc(v.value) + '"' + (lastParams.get(p.id) === v.value ? ' selected' : '') + '>' + esc(v.label) + '</option>').join('') + '</select></label>').join('')
  document.querySelectorAll('[data-param]').forEach((s) => s.onchange = updateSpec)
  updateSpec()
}
function modelSpec() {
  const id = document.getElementById('f-model').value
  const base = id === '__custom' ? document.getElementById('f-custom').value.trim() : id
  if (!base) return null
  const params = [...document.querySelectorAll('[data-param]')].filter((s) => s.value).map((s) => s.dataset.param + '=' + s.value)
  return params.length ? base + '?' + params.join('&') : base
}
function updateSpec() { const s = modelSpec(); document.getElementById('f-spec').textContent = s ? 'model: ' + s : 'model: the agent’s default'; loadAccount() }
let chain = [], knownSkills = new Set()
async function loadSkills(last) {
  const sel = document.getElementById('f-skill'), note = document.getElementById('f-skill-note')
  try {
    const { skills } = await api('/api/skills')
    knownSkills = new Set(skills.map((s) => s.name))
    const groups = {}
    for (const s of skills) (groups[s.group || 'Skills'] = groups[s.group || 'Skills'] || []).push(s.name)
    sel.innerHTML = '<option value="">Add a skill…</option>' + Object.entries(groups).map(([g, names]) => '<optgroup label="' + esc(g) + '">' + names.map((n) => '<option>' + esc(n) + '</option>').join('') + '</optgroup>').join('')
    note.textContent = skills.length + ' skills. Each skill\\'s whole folder (references too) is given to the agent. With several, the agent applies them in this order.'
  } catch (e) { note.textContent = e.message; note.className = 'note warn' }
  if (last && /[\\\\/.]/.test(last)) document.getElementById('f-skill-path').value = last
  else chain = (last || '').split(',').map((x) => x.trim()).filter((x) => knownSkills.has(x))
  sel.onchange = () => { if (sel.value && !chain.includes(sel.value) && chain.length < 5) chain.push(sel.value); sel.value = ''; renderChain() }
  renderChain()
}
const relatedCache = {}
async function renderChain() {
  const box = document.getElementById('f-chain'), next = document.getElementById('f-next')
  box.innerHTML = chain.length
    ? chain.map((n, i) => '<button type="button" class="pill" aria-pressed="true" data-rm="' + esc(n) + '" title="Remove">' + (i + 1) + '. ' + esc(n) + ' ×</button>').join('')
    : '<span class="note">No skill: the agent uses the built-in UX guidance.</span>'
  box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { chain = chain.filter((x) => x !== b.dataset.rm); renderChain() })
  next.innerHTML = ''
  const lastSkill = chain[chain.length - 1]
  if (!lastSkill || chain.length >= 5) return
  relatedCache[lastSkill] = relatedCache[lastSkill] || api('/api/skill?name=' + encodeURIComponent(lastSkill)).catch(() => ({ related: [] }))
  const { related } = await relatedCache[lastSkill]
  const offer = (related || []).filter((n) => knownSkills.has(n) && !chain.includes(n)).slice(0, 6)
  if (chain[chain.length - 1] !== lastSkill) return
  next.innerHTML = offer.length ? '<span class="note">' + esc(lastSkill) + ' hands over to:</span>' + offer.map((n) => '<button type="button" class="pill" data-add="' + esc(n) + '">+ ' + esc(n) + '</button>').join('') : ''
  next.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { chain.push(b.dataset.add); renderChain() })
}
async function start() {
  const err = document.getElementById('f-error'), btn = document.getElementById('f-start')
  err.textContent = ''
  const num = (id, d) => { const n = parseInt(document.getElementById(id).value, 10); return Number.isFinite(n) ? n : d }
  const judgeOn = document.getElementById('f-judge').checked
  const body = {
    agent: document.getElementById('f-agent').value,
    model: modelSpec(),
    skill: document.getElementById('f-skill-path').value.trim() || chain.join(',') || null,
    devCommand: document.getElementById('f-dev').value.trim(),
    baseRef: document.getElementById('f-base').value,
    startPaths: scope() === 'whole' ? [] : document.getElementById('f-paths').value.split(',').map((x) => x.trim()).filter(Boolean),
    iterations: num('f-iter', 2), maxSurfaces: num('f-max', 8), timeoutMin: num('f-timeout', 15),
    judgeModel: judgeOn ? (document.getElementById('f-judge-model').value.trim() || null) : null,
    sync: document.getElementById('f-sync').checked,
    crawl: scope() === 'pages' && document.getElementById('f-crawl').checked,
    steps: document.getElementById('f-steps').checked,
    checkerModel: checkerPick().model,
    checkerVia: checkerPick().via,
    keepInvisible: document.getElementById('f-invisible').checked,
    ignore: document.getElementById('f-ignore').value.split('\\n').map((x) => x.trim()).filter(Boolean),
  }
  if (!body.devCommand) { err.textContent = 'Give the dev command.'; return }
  store.set('last', { ...body, judge: judgeOn })
  btn.disabled = true
  try {
    const { runId: id } = await api('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (meta) meta.active = id
    await loadRuns(); showRun(id)
  } catch (e) { err.textContent = e.message } finally { btn.disabled = false }
}
function resumable() { return !!(meta && meta.canResume && state && state.options && state.phase !== 'done') }
document.getElementById('resumeBtn').onclick = async () => {
  const b = document.getElementById('resumeBtn'), pd = document.getElementById('phaseDetail')
  b.disabled = true
  b.textContent = 'Resuming…'
  try {
    await api('/api/runs/' + runId + '/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (meta) meta.active = runId
    await loadRuns(); await loadState()
  } catch (e) { pd.textContent = e.message; pd.className = 'sub err' } finally { b.textContent = '▶ Resume'; b.disabled = false }
}
document.getElementById('prBtn').onclick = async () => {
  const b = document.getElementById('prBtn'), pd = document.getElementById('phaseDetail'), label = b.textContent
  b.disabled = true
  b.textContent = 'Pushing…'
  try {
    const pr = await api('/api/runs/' + runId + '/pr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    pd.textContent = (pr.added ? 'Added to PR #' : 'Opened draft PR #') + pr.number + '. Merge it from the Mushi console once its checks pass.'
    pd.className = 'sub'
    await loadState()
  } catch (e) { pd.textContent = e.message; pd.className = 'sub err' } finally { b.textContent = label; b.disabled = false }
}
document.getElementById('newBtn').onclick = openLauncher
document.getElementById('stopBtn').onclick = async () => {
  const b = document.getElementById('stopBtn')
  b.disabled = true
  b.textContent = 'Stopping…'
  await api('/api/runs/' + runId + '/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch((e) => { document.getElementById('phaseDetail').textContent = e.message })
  b.textContent = '■ Stop'
}

// ── Live events ────────────────────────────────────────────────────────────
let stateTimer = null
const es = new EventSource(q('/api/events'))
es.onmessage = (m) => {
  const e = JSON.parse(m.data)
  if (e.type === 'started') { if (meta) meta.active = e.runId; loadRuns(); return }
  if (e.type === 'log') { runLog.push(e); if (e.runId === runId) { const p = document.getElementById('runlog'); p.textContent += (p.textContent ? '\\n' : '') + e.message; p.scrollTop = p.scrollHeight } }
  if (e.type === 'agent') { (agentLog[e.surface] = agentLog[e.surface] || []).push(e.line); if (agentLog[e.surface].length > 1500) agentLog[e.surface] = agentLog[e.surface].slice(-800); if (e.runId === runId && e.surface === selected) { const o = document.getElementById('agentout'); if (o) { if (o.classList.contains('sub')) { o.textContent = e.line; o.classList.remove('sub') } else o.textContent += '\\n' + e.line; o.scrollTop = o.scrollHeight } else renderRun() } }
  if ((e.type === 'state' || e.type === 'phase') && e.runId === runId) { clearTimeout(stateTimer); stateTimer = setTimeout(() => { loadState(); if (e.type === 'phase') loadRuns() }, 150) }
}

;(async () => {
  meta = await api('/api/meta')
  document.getElementById('repo').textContent = meta.repo
  document.getElementById('newBtn').hidden = !meta.launcher
  await loadRuns()
  const want = new URLSearchParams(location.search).get('run') || meta.active || meta.initial
  if (want && runs.some((r) => r.runId === want)) showRun(want)
  else if (meta.launcher) openLauncher()
  else if (runs[0]) showRun(runs[0].runId)
})()
</script></body></html>`

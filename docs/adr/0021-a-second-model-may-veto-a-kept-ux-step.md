# 0021. A second model may veto a kept UX step; changes with nothing visible are kept for review

Status: Accepted (owner, 2026-10-07)            Date: 2026-10-07

Plan: [Plan 021](../execplans/ux-loop.md). Amends decision 4 of
[0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) ("keep or revert
is decided by measurement, not by a model"). Everything else in 0020 stands.

## Context

On 2026-10-07 the owner watched a glot.it run (Cursor + Grok 4.7,
`enhance-mobile-native-feel`) and asked for a maker and a checker: Grok makes
each change, and a different model (Claude Opus 5.5) judges it. Two gaps in
0020 showed in that run:

- Measurements catch harm (new accessibility violations, sideways scroll,
  small tap targets, console errors, layout shift) but not taste. A step can
  pass every probe and still make a screen worse to use.
- A change with nothing visible in a still screenshot (press feedback,
  haptics, spring motion, another breakpoint) was rolled back as "no change",
  so most of what a native-feel skill asks for could never be kept.

The research still holds that a vision model should not decide alone:
judges are near random on small UI differences (arxiv 2510.08783), flip with
the order the images are shown in (arxiv 2305.17926), and screenshot UX
audits run at high error rates (Baymard).

## Decision

1. **Measurements stay first.** A step the probes reject is rolled back, and
   no model can keep it.
2. **An optional checker may veto a kept step.** The person picks it in the
   launcher (none by default in the CLI; Claude Opus 5.5 through Claude Code
   is offered first in the studio when Claude Code is installed).
   - It sees crops of the changed area, before and after, twice with the
     order swapped, and the step it was meant to make.
   - It rolls the step back only when **both** reviews prefer the original
     with at least medium confidence. Disagreement, a tie, low confidence or
     a failed call keeps the step on its measurements, and says so.
   - It runs on the person's own credentials: `claude -p` read-only (Read
     tool only, no MCP, no session saved) or `ANTHROPIC_API_KEY`.
3. **A change with nothing visible is kept and flagged**, when nothing
   measured got worse: "Kept, needs your review". The checker reviews its
   diff against the step instead of screenshots, with the same veto-only
   power. The person decides at the draft PR.
4. **Still nothing merges.** The run ends with a branch and a draft PR (0016,
   0017's exception).

## Rejected alternatives

- **The model decides every step.** Rejected for the reasons above; the
  owner chose veto only.
- **A single review in one order.** Order bias makes one answer close to a
  coin flip on small changes; two orders that agree are the minimum.
- **Keep rolling back invisible changes.** It made native-feel work
  impossible to keep, which defeats the skill the loop was built to run.

## Consequences

- A checked step costs two model calls: on glot.it, Opus 5.5 through Claude
  Code took 37 s and $0.46 for both reviews of one step (a single
  two-image probe: 12 s, $0.13).
- "Kept, needs your review" commits reach the draft PR; the PR description
  must list them so a person reads their diffs.
- The final advisory review (0020 decision 4's second half) stays as it is.

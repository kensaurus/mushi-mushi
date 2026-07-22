# Closed-loop evolution — the thesis

Source: https://kensaur.us/mushi-mushi/docs/concepts/closed-loop

---
title: Closed-loop evolution — the thesis
---

# Closed-loop evolution — the thesis

> *"Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI."*

The vibe-coding era — AI-assisted development where you build and ship in hours — solved the creation bottleneck. The new bottleneck is selection: out of everything you could fix next, which changes actually make the app better for real users? Without a closed feedback loop, you're flying blind. This page is the long-form argument for *why* the loop matters and *how* Mushi implements it.

For a shorter version see [The evolution loop](/concepts/evolution-loop). For the manifesto see the [EVOLUTION-LOOP.md](https://github.com/kensaurus/mushi-mushi/blob/master/docs/EVOLUTION-LOOP.md) doc.

---

## The NTSB moment software is missing

In 1977 two Boeing 747s collided on a foggy runway in Tenerife. 583 people died. In the years that followed, aviation did something unusual: it systematically refused to let the crash be a tragedy and nothing more. The NTSB — the National Transportation Safety Board — dissected every failure, named every cause, and encoded each cause as a rule the next generation of pilots, controllers, and aircraft designers had to obey.

The result is the safest form of transport in history. Not because pilots got braver, or planes got sturdier, but because **every crash was turned into institutional memory**.

Matthew Syed documents this contrast in *Black Box Thinking* (2015): aviation learned from failure; medicine, for most of its history, did not. Doctors who lost patients rarely analysed why. Complications were attributed to the complexity of the case, not to a systemic flaw that could be fixed and encoded. The mortality rate reflected the difference.

Software development is closer to pre-NTSB medicine than to aviation. Every production bug is technically a crash. Most get fixed and forgotten. The knowledge that *this* class of bug appeared, under *these* conditions, encoded in *this* pattern — vanishes. The next developer joins the project and makes the same mistake. Six months later a user reports the same friction. The fix is almost identical. The cost is real.

**Mushi is the NTSB layer software has been missing.**

  *"In a world where crashes are hidden, disasters accumulate. In a world where crashes are dissected, progress compounds."* — Matthew Syed, *Black Box Thinking* (2015), p. 9

---

## Why the linear SDLC is the wrong unit

The textbook software development lifecycle runs one way: PM defines spec → dev implements → QA tests → ships → user experiences → (maybe) bug reported → ticket created → fixed in a future sprint.

At every junction information is lost, delayed, or distorted:

- The PM's spec is a theory about user behaviour, not evidence from it.
- The dev's implementation is tested against the spec, not against the real user journey.
- QA tests are mostly happy paths — the edge cases that cause real user friction are rarely in the test plan.
- The bug report, when it arrives, is a support ticket with no reproduction context, no screenshot, no stack trace, no session replay, no device info — just "it doesn't work."
- By the time the fix lands, the developer who wrote the original code has often moved to a different project. The lesson is not encoded anywhere.

This is not a people problem. It is an **information architecture** problem. The loop does not close. Each iteration starts roughly where the last one started.

---

## Cumulative selection: why it works

Dawkins introduced *cumulative selection* in *The Blind Watchmaker* and developed it further in *Climbing Mount Improbable*. The key insight: single-step random search (pure chance) is hopeless at finding complex solutions. But **selection with memory** — where each generation keeps the improvements of the last — can reach solutions of arbitrary complexity, given enough iterations.

Applied to software:

- A single bug report is noise. A cluster of similar reports is signal.
- A cluster that reappears across releases is a **systemic failure mode**.
- A systemic failure mode that is named, documented, and encoded as a rule the next developer sees before they repeat it — is a **permanent improvement** to the development process.

This is cumulative selection. The software system gets permanently better with each encoded lesson — not just temporarily patched.

  *"Cumulative selection is the key to all of evolution. … Each improvement, however slight, is retained and passed on."* — Richard Dawkins, *Climbing Mount Improbable* (1996), p. 74

In Mushi that means: catch the bug → embed it → cluster similar bugs → name the cluster → promote it to a learning rule → inject the rule into the next PR review and the next agent fix → credit the reporter → repeat.

---

## What the loop looks like in practice

1. **A user feels friction** (a dead button, a slow screen, a layout that breaks on one phone) and shakes the app or clicks the feedback stamp. — *Source: SDK or [Anti-gaming](/admin/anti-gaming) for synthetic probes.*
2. **Mushi SDK captures** the moment: screenshot, session breadcrumbs, device info, the current route. — *Visible in [Reports & triage](/admin/reports).*
3. **The server embeds the report** with `text-embedding-3-small` and runs the BIRCH-style streaming clusterer. — *Architecture: `classify-report` edge function.*
4. **Similar reports collapse** into a `mistake_cluster`. When the cluster reaches coherence ≥ 0.75 and size ≥ 3, the judge model promotes it to a **`lesson`** with auto-generated name + summary + one-shot rule. — *Visible in [Judge dashboard](/admin/judge) and [Lessons](/admin/lessons).*
5. **The lesson is injected** into the next PR review (token-budget packed to ≤ 3 000 tokens) and into the next agentic fix run — so neither human reviewers nor the AI agent can repeat the same class of mistake. — *Triggered from [Fix orchestrator](/admin/fixes) or autonomously via [Iterate (PDCA)](/admin/iterate).*
6. **The user is credited** in the changelog: *"Fixed by Kenji: the Settings page back-button was double-counting the safe-area inset"*. The SDK shows a toast on the next session. — *Managed in [Releases](/admin/releases) and [Rewards](/admin/rewards).*
7. **Drift and anomaly detectors** run continuously, generating candidate reports for issues no user has noticed yet. Those reports enter the same pipeline at step 2 — the loop closes without waiting for a human to file a ticket. — *[Drift scanner](/admin/drift) and [Anomaly detection](/admin/anomalies).*
8. **The PDCA loop runs** on a schedule or on demand: crawl the live URL, plan improvements, fix them, verify. — *[Iterate (PDCA)](/admin/iterate) page; powered by the `pdca-runner` edge function.*

---

## What this means for the roadmap

Every feature in the Mushi roadmap is either:

1. **A sensor**: something that generates more signal about where the system is failing (rewards that incentivise reporting, drift agents that find latent failures, A/B tests that detect which version performs better).
2. **A processor**: something that turns raw signal into named, structured knowledge (the mistake clusterer, the judge coherence gate, the PDCA loop, anomaly detection).
3. **An effector**: something that injects knowledge back into the development process (lesson injection into PRs, changelog attribution, the `.mushi/lessons.json` repo file, the PDCA draft PR).

The loop is: **sense → process → effect → sense again** — each encoded lesson makes the next agent run less likely to repeat the same class of mistake.

---

*See [Roadmap](/roadmap) for the implementation schedule. See [Architecture](/concepts/architecture) for the wire-level sequence diagrams.*

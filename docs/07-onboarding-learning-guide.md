# `guardian-rn` — Engineer Onboarding & Learning Guide

> **Audience:** every new engineer joining the team — junior to senior, SDK to SRE to security advisor.
> **Promise:** by Day 90, a new engineer can land production code without supervision in their primary track.
> **Contract:** this guide is *prescriptive*. Skip steps and you'll feel it.

This document is built on **Diátaxis**: the path is a *tutorial* (learning-oriented), not a how-to (task-oriented) or reference. You will *do* things, not just read.

---

## 0. Before Day 1 (Hiring / Pre-Boarding)

Hiring manager's checklist (run a week ahead):

- [ ] Welcome email with start date + first-day logistics + this guide link.
- [ ] Mentor assigned (see §1.3 below).
- [ ] Hardware ordered and shipping-tracked.
- [ ] Accounts queued for Day 1 provisioning: GitHub, 1Password, Slack, PagerDuty, Grafana, AWS read-only, Linear/Jira, Confluence-or-equivalent (we use the in-repo wiki).
- [ ] Calendar invites for: 1:1 with manager (Day 1 13:00), tech-lead intro (Day 1 14:00), team standup (Day 2 09:30), pairing window with mentor (Day 2 11:00–12:30, Day 3 same).
- [ ] Reading list (next section) sent ahead with **"don't try to read all of this — pick what feels relevant; we'll discuss what stuck"**.

---

## 1. The Three Tracks

We onboard by track. Most engineers join one of these:

| Track | Examples | Primary contexts | Languages |
|---|---|---|---|
| **SDK Engineer (Mobile)** | RN bridge, native modules, JSI, TurboModules, codegen | Threat Detection, Bridge Integrity, Subscriber & Lifecycle, Response & Policy | TypeScript, Kotlin, Swift, C++ (a little) |
| **Detection Engineer** | New detectors, threat-feed curation, FP triage, evidence design | Threat Detection (deep), Reporting (consumer) | TypeScript, Kotlin, Swift |
| **Backend / SRE** | Collector, ELK, Grafana, Helm/Terraform, alerting, reporting worker | Observability Ingest, Reporting | Node, Bash, YAML, Terraform, Lucene |

A fourth, lightweight, track exists for the **Security Advisor** (typically a contractor or rotating internal). They do not write production code; they review threat models, audit detectors, and approve cryptographic decisions.

The 90-day plan below has shared early weeks then track-specific labs from Week 3.

### 1.1 Reading list (shared, before/early Week 1)

Don't try to read all of this. Pick what feels relevant; the discussion-points session at the end of Week 1 is *about* what stuck and why.

- `01-product-and-solution-design.md` — what we're replacing and why.
- `02-superior-solution-proposal.md` — what we're building.
- `04-observability-addendum.md` — the centralised pipeline.
- `05-wiki/Home.md` — the orientation map.
- `05-wiki/Architecture-Overview.md` — the 10-minute mental model.
- `05-wiki/reference/Glossary.md` — the words we use, used precisely.
- `05-wiki/Engineering-Practices.md` — how we work.
- `06-domain-driven-design-with-tdd.md` — modelling and testing discipline.
- *Test-Driven Development by Example*, Beck, ch. 1–6 (one weekend's reading).
- For SDK: skim the [React Native New Architecture intro](https://reactnative.dev/docs/the-new-architecture/landing-page).
- For Detection: skim OWASP MASVS L1+L2 and read the freerasp-rn changelog.
- For Backend/SRE: skim *Site Reliability Engineering*, ch. 4 (SLOs), 5 (Toil), 14 (Incident Response).

### 1.2 What we don't expect

- You don't need to know all three native platforms on Day 1. Pick one to start; we'll grow you across.
- You don't need prior RASP experience. The domain is teachable.
- You don't need to have read every line of the design docs before Day 1. Skim, then we walk together.

### 1.3 Mentor assignment

Every new engineer gets one **mentor** for 90 days:

- A senior engineer in the same track.
- 30 min/day, mostly pairing, sometimes pure Q&A. Booked on the new hire's calendar.
- Different from the **manager** (career/comp/perf) — mentors don't review your performance; they teach you the codebase.

---

## 2. The 90-Day Plan

A clear week-by-week ladder. Each week ends in a checkpoint.

### Week 1 — Orientation

**Goal:** environment up; ship a tiny, *real* PR; understand the language we use.

**Day 1**
- 09:00 IT setup, accounts, hardware.
- 10:00 Read this onboarding guide top to bottom (1h).
- 11:00 Read `05-wiki/Architecture-Overview.md` and `05-wiki/Home.md` (45min).
- 13:00 1:1 with manager (welcome, expectations, comp, no-surprises culture).
- 14:00 Tech Lead walkthrough: live tour of the repo, the bounded contexts, the test pyramid.
- 16:00 Lab 0 (below): clone the repo, run the example app on a simulator, see a threat fire.

**Day 2**
- 09:30 Standup (silent observer).
- 10:00 Read `05-wiki/Engineering-Practices.md` carefully.
- 11:00 First pairing session with mentor: a tour of the part of the codebase your track touches most.
- 14:00 Lab 1 (below): the example app + the dev loop.
- 16:00 Open your **Day 2 PR**: pick a `good-first-issue` (we curate ~10 in the issue tracker; tiny ones — typo fixes, missing test cases, doc tweaks). Goal: feel the CI, get reviewed, merge before Day 5.

**Day 3**
- 09:30 Standup.
- 10:00 Read `05-wiki/reference/Glossary.md` cover to cover. **This is the most important reading of Week 1.** Bring 5 questions to your mentor at 11:00.
- 14:00 Pairing: walk through `06-domain-driven-design-with-tdd.md` §3.1 and §3.2 (Threat Detection + Bridge Integrity). Make sure you can run the verifier test suite locally.

**Day 4**
- Continue your Day 2 PR; address review feedback. Land it.
- Pair with someone *outside* your track for 90 minutes (mutual onboarding) — gives you the ACL across team boundaries early.

**Day 5**
- 09:30 Standup (talk).
- 10:00 Lab 2 *or* equivalent track-lab (below).
- 16:00 **Week 1 retro with mentor (45 min):**
  - What landed?
  - Glossary terms that still feel fuzzy?
  - One thing in the codebase that surprised you?
  - One thing in our process that surprised you?

**Week 1 checkpoint** (signed off by mentor):
- [ ] Example app running on iOS *and* Android.
- [ ] First PR merged.
- [ ] Glossary read; 5+ questions discussed.
- [ ] Architecture diagram in `05-wiki/Architecture-Overview.md` redrawn from memory at the whiteboard, mentor present.

If any item is red, the next week slows down to fix it.

### Week 2 — Drive a TDD cycle in your track

**Goal:** write a test first, drive minimal code, refactor — for a *real* small feature.

- Days 6–8: Lab 2 or your track's Week-2 lab end-to-end (below).
- Day 9: pair-program with your mentor on a real ticket. Mentor drives the first hour; you drive the second; mentor observes the third.
- Day 10: open your **first track-PR** — small, but real (e.g., add a property test for a specific invariant; add a redaction option; tune a detector confidence threshold; add a panel to a dashboard).

**Week 2 checkpoint:**
- [ ] Track-PR opened.
- [ ] Wrote at least one Red→Green→Refactor cycle from scratch.
- [ ] Can articulate, in one minute, the difference between a `Threat`, a `ThreatPayload`, and a `ThreatEvent`.

### Week 3 — Track-specific deep work

The labs branch by track here.

#### SDK Engineer

- **Lab 3 (SDK):** Add a new threat. Schema → codegen → detector (one platform) → unit tests → property test → JS hook → Detox e2e → dashboard panel. End-to-end. Mentor checkpoints at each layer.
- **Reading:** Hermes runtime, RN reanimated/JSI examples (just to see another JSI module's shape).
- **Pairing:** with the iOS *and* Android leads, even if your stronger platform is one.

#### Detection Engineer

- **Lab 3 (Detection):** Adopt or sharpen one community-engine detector. Pick one with a recent FP report (we keep these in `D-3` dashboard exports). Improve the confidence model; add a property test for the new rule; document the change in the threat catalogue.
- **Reading:** *Mobile Application Hacker's Handbook* selected chapters; recent CVEs in your detector's category.
- **Pairing:** with a SecOps colleague to triage 5 real FPs from prod.

#### Backend / SRE

- **Lab 3 (Backend):** Provision a fresh local stack (docker-compose + Helm in kind). Bring up: collector, ES, Logstash, Grafana, reporting worker. Run the synthetic probe; verify the SLO dashboard turns green. Document any drift from `04-observability-addendum.md`. Open a PR with the deltas.
- **Reading:** Logstash advanced filters; ECS docs; ILM patterns.
- **Pairing:** shadow on-call for one shift (read-only — no decisions yet).

**Week 3 checkpoint:**
- [ ] Track-Lab 3 complete.
- [ ] Code review participation: reviewed 3+ PRs (your comments count toward learning, not just feedback).

### Weeks 4–6 — First owned ticket

- Pick a sprint ticket sized for ~3 days. Own it end-to-end: design (consult mentor), write tests, implement, review-cycle, merge, deploy, watch dashboards.
- Attend a **post-mortem** (from any past incident in the last quarter; mentor picks). Read it, understand it, ask questions.
- Run a **brown-bag** for the team (30 min): "what I learned about <topic>". Not a presentation review — a learning forcing-function.

**Week 6 checkpoint:**
- [ ] First owned ticket merged and deployed.
- [ ] Brown-bag delivered.
- [ ] Reviewed a real post-mortem.

### Weeks 7–9 — Second ticket, larger; first cross-context PR

- Pick a ticket that touches two bounded contexts (with mentor's help). The point is to feel the ACL discipline.
- Begin **shadowing on-call** one shift per week (still read-only).
- Begin **rotating into code review queue** for your track.

**Week 9 checkpoint:**
- [ ] Second ticket merged.
- [ ] One on-call shadow completed; debrief with primary on-call.

### Weeks 10–12 — Independence

- Independently own a ticket without mentor pairing.
- Take a **secondary on-call** shift (with primary as safety net).
- Lead one **team-internal pair-programming** session (your turn to teach).
- Open one **ADR** of your own — even a small one — to feel the decision-record process.

**Day 90 checkpoint** (manager + mentor + you):
- [ ] At least 3 tickets merged independently in the last 4 weeks.
- [ ] On-call certified (primary, with override window).
- [ ] An ADR authored.
- [ ] Brown-bag delivered.
- [ ] No blockers escalated to manager more than once for the same root cause.

If any item is red: extend by 30 days, identify the gap, address it.

---

## 3. Hands-on Labs (curriculum)

Labs are stepwise tutorials. Each has *guaranteed-to-work* steps, expected output, and a "you should now understand …" closing line.

### Lab 0 — Clone, build, run (Day 1)

```bash
git clone git@github.com:org/guardian-rn.git
cd guardian-rn
yarn install
yarn codegen
yarn example android   # or `ios`
```

Expected: example app launches; you tap the "Trigger debug threat" button; an event appears in the on-screen log AND a verified threat appears in the JS console.

You should now understand: the code path from a button press → native bus → JS verifier → on-screen log.

### Lab 1 — The dev loop (Day 2)

1. Run unit tests: `yarn jest`.
2. Run native tests: `yarn android:test`, `yarn ios:test`.
3. Make a deliberate failing change to `EnvelopeVerifier` (e.g., always return `{ok:true}`); watch tampering tests go red.
4. Revert; verify green.
5. Open `dashboards/d-2-engine-health.json`; locate the panel `HMAC verification failure rate`; understand its query.

You should now understand: how to provoke and observe each test layer; how a dashboard panel ties to a code-level invariant.

### Lab 2 — Domain modelling (Days 6–8)

Without writing platform code, *only* working in `packages/guardian-rn/src/core/`:

1. Open `06-domain-driven-design-with-tdd.md` §3.2 (Bridge Integrity).
2. Write a new property test asserting `CanonicalJson.serialise` is idempotent (`serialise(parse(serialise(x))) === serialise(x)`).
3. Make sure it passes.
4. Now break `CanonicalJson` deliberately (sort numerically, not lexically — a real subtle bug); watch the property test catch it.
5. Revert.

You should now understand: how property-based tests catch *classes* of bugs, not single examples.

### Lab 3 — Track-specific (Week 3)

See §2 Week 3 above per track.

### Lab 4 — Run the full stack locally (Backend track + recommended for everyone)

```bash
cd deploy/dev
docker compose up -d         # collector, ES, Kibana, Logstash, Grafana
./scripts/seed-tenant.sh dev-tenant
./scripts/run-probe.sh       # emits a synthetic event every minute

# In another terminal, run the example app pointed at the local collector:
GUARDIAN_INGEST_URL=https://localhost:8443/v1/ingest yarn example android
```

Open `https://localhost:3000` (Grafana); pick D-1; watch events appear within 60 seconds.

You should now understand: end-to-end where every event lives between phone and report.

### Lab 5 — Build a custom engine (SDK or Detection track, Month 2)

Write a 30-line custom engine that emits `simulator` whenever a configurable env var is set. Wire it through the registry; observe it in the dashboards. The point is to feel that the engine surface is *small*.

### Lab 6 — Trigger and triage a false positive (Detection track, Month 2)

Use the staging environment + the FP synthetic harness. Reproduce a known FP; tune a detector threshold; ship the change behind a flag; watch FP rate drop in D-3.

### Lab 7 — Add a Grafana dashboard panel (SRE track, Month 2)

Pick a metric on the SLO dashboard that's missing. Author the panel JSON in the repo, run the dashboard validator, push, watch CI provision the change.

---

## 4. Pairing Schedule

Pairing isn't optional in the first 30 days. Concretely:

| Time | Activity |
|---|---|
| Daily 11:00–11:30 | Mentor stand-up (your stand-up, audience of 1) — share what you tried, what's confusing, what blocked you. |
| Tue/Thu 14:00–15:30 | Pair-programming with mentor on real tickets. |
| Wed 11:00–12:00 | Cross-track pairing (different track each week — keeps your map of the system fresh). |
| Fri 16:00–17:00 | Week retro (with mentor) — what worked, what didn't, what to change. |

After Day 30, pairing is optional but encouraged for:
- Any cross-context PR.
- Anything you've never done before.
- Anything that touches the threat model.

---

## 5. Code Review Curriculum

Code review is a *learning* tool here, not just a quality gate. We onboard reviewers as carefully as authors.

### 5.1 Week 2 — Observe

Read at least 5 PRs end-to-end without commenting. Note what makes a *good* review (specific, kind, blocking-vs-nit clarity).

### 5.2 Week 3 — Comment

Start commenting on PRs in your track. Stick to:
- `[question]` — when you don't understand. Ask, don't accuse.
- `[nit]` — when you see a tiny improvement, non-blocking.
- `[suggestion]` — alternative approach; ok to merge without taking it.

Avoid `[blocking]` for the first month — let mentor do those.

### 5.3 Week 5 — Approve

Begin giving approvals on small PRs in your track. Mentor co-reviews for the first ten approvals.

### 5.4 Reviewer's checklist

- [ ] Description has *what* and *why*.
- [ ] Tests are present and meaningful (not just for coverage).
- [ ] Glossary terms used precisely.
- [ ] Public API changes documented.
- [ ] Telemetry / dashboards / runbook updated where applicable.
- [ ] No `TODO` without a ticket.
- [ ] Diff size reasonable; if > 400 lines, walked through.
- [ ] Backwards-compat handled or release notes drafted.

---

## 6. On-Call Onboarding

Separate, deliberately gradual.

| Stage | When | Activity |
|---|---|---|
| **Shadow** | Week 5 | Sit beside the primary for one shift. Read the runbook live. Ask after the shift, never during. |
| **Secondary** | Weeks 7–9 | You're on the page, primary is too — they decide; you observe how they decide. |
| **Primary (training-wheels)** | Weeks 10–12 | You're primary; mentor or another senior is the explicit override target for any SEV-1. |
| **Primary (full)** | Day 90+ | You're primary; standard escalation only. |

Before any stage advances:
- Walked through every alert in `05-wiki/Runbook.md` §2 with a senior, and run the diagnostic toolkit (§3) on a real-feeling staging incident.
- Practised one tabletop incident exercise (we run these monthly).

---

## 7. Stuck? — Escalation Ladder

Don't suffer in silence. **Asking questions is a job requirement.**

1. **5-minute rule:** if stuck for 5 min, search the wiki + codebase + your notes.
2. **15-minute rule:** if still stuck, ask in `#guardian-eng` Slack with the question + what you've tried + a link to the code.
3. **30-minute rule:** if no response, ping your mentor directly.
4. **2-hour rule:** if still blocked, escalate to the Tech Lead. *We measure how long new hires sit blocked* — and if it's frequent, it's our process bug, not yours.

---

## 8. Knowledge-Check Questions (self-assessment, end of each phase)

### After Week 1

1. Sketch the architecture from memory.
2. Define `ThreatId`, `ThreatPayload`, `ThreatEvent`, `SignedEnvelope`, `Subscriber`, `Tenant`, `Session` — in one sentence each.
3. What does `useGuardian` actually do, in three lines?
4. Why don't we call `abort()`?
5. Why is the Compatibility context an Anti-Corruption Layer and not a regular adapter?

### After Week 4

6. Walk through the threat → JS path step by step. Where does HMAC verification happen? What happens if it fails?
7. Where do detectors live? Why?
8. What's the difference between `restrict`, `lockout`, and `kill` policies, and when would you use each?
9. Why is the SDK adapter responsible for redaction *and* the collector also redacts?
10. What does the Engine Health dashboard tell you that the Threat Heatmap doesn't?

### After Week 12

11. Given a new threat to add, walk through the full PR plan (every file you'd touch). Time-box it: under 5 minutes.
12. Trace what happens during a SEV-1 HMAC verification spike, hour by hour. What evidence do you collect? Who do you escalate to?
13. Pick any invariant from `06-domain-driven-design-with-tdd.md` §3 and explain why a property test, not just an example test, is the right tool.
14. Where is the line between Bridge Integrity and Subscriber & Lifecycle? Why is it there?
15. If we removed the codegen tooling, what would degrade first? Why?

If you can answer all 15 confidently by Day 90, you're ready.

---

## 9. Track-Specific Reading & Resources

### 9.1 SDK Engineer

**Required:**
- React Native New Architecture docs (TurboModule, Codegen, Fabric).
- Hermes overview.
- The Talsec adapter source (see what a real adapter looks like).

**Recommended:**
- *iOS App Reverse Engineering* (selected chapters) — to understand what we detect *against*.
- Android internals: Linux process model, Binder IPC.
- *The Mobile Application Hacker's Handbook*.

### 9.2 Detection Engineer

**Required:**
- OWASP MASVS L1+L2 controls.
- The community engine's existing detectors (read all of them).
- `D-3 False-Positive Triage` dashboard's last 90 days.

**Recommended:**
- *The Mobile Application Hacker's Handbook* (deeper).
- Recent Magisk/KernelSU/Frida release notes — track the bypass-tool ecosystem.
- *Practical Reverse Engineering* (Dang, Gazet, Bachaalany).

### 9.3 Backend / SRE

**Required:**
- ECS specification.
- Elasticsearch ILM docs.
- Grafana provisioning docs (file-based).
- Our own runbook + post-mortem archive.

**Recommended:**
- *Site Reliability Engineering* (Beyer et al.) — chapters 4, 5, 14 minimum.
- *The Site Reliability Workbook* — chapter on alerting on SLOs.
- *Designing Data-Intensive Applications* (Kleppmann), ch. 11 (stream processing).

---

## 10. The Definition of "Onboarded"

You are **onboarded** when:

1. You can ship a PR in your track without mentor pairing.
2. You can answer the Day-90 self-assessment confidently.
3. You have taken at least one primary on-call shift.
4. You have authored or co-authored an ADR.
5. You have led one brown-bag.
6. You have reviewed at least 20 PRs and approved at least 10.
7. You can explain the architecture diagram from memory at the whiteboard.
8. Your manager and mentor agree, in writing, that you're independent.

**This is the bar.** The numbers aren't bureaucracy; they're proxies for *demonstrated capability*. We don't onboard halfway.

---

## 11. Things We Want From You During Onboarding

- **Documentation feedback.** You will spot gaps and contradictions that long-tenured engineers can't see anymore. Open PRs against this guide and the wiki — *especially* in your first 30 days. We celebrate first-month doc PRs.
- **Process critique.** If a step in this guide seemed wasted, say so in your Week 4 retro. The cost of bad process compounds; the cost of changing it once is finite.
- **Honest blockers.** "I'm stuck and embarrassed" is not a status; it's a flag. Raise it.
- **Curiosity outside your track.** SDK should pair with SRE. Detection should pair with Backend. The cross-pollination keeps us out of silos.

## 12. Things We Don't Want From You During Onboarding

- **Heroics.** Solving a hard ticket alone in week 2 isn't impressive; it bypasses the safety net we built deliberately.
- **Over-promising.** "I'll have it by Friday" said because you feel pressure → ship Tuesday or Friday with quality, not Friday with hidden tech debt.
- **Silent struggle.** See §7. Asking is the job, not a weakness.
- **Premature opinions on architecture.** Hold them; write them down; raise them in Week 6+ once you have context. Day-3 architecture critiques are usually wrong, and even when they're right, they sound dismissive.

---

## 13. Sample Day-by-Day for the First Two Weeks (SDK Track)

A worked example. Adapt to your track.

| Day | Morning | Afternoon |
|---|---|---|
| 1 | Setup, accounts, this guide, architecture overview | Manager 1:1, tech lead tour, Lab 0 |
| 2 | Standup, engineering practices, mentor pairing #1 (codebase tour) | Lab 1, pick a good-first-issue |
| 3 | Standup, glossary deep-read, mentor Q&A | DDD-with-TDD §3.1 + §3.2 reading + run tests |
| 4 | Standup, work on first PR | Cross-track pairing (with SRE) |
| 5 | Standup, finish + merge first PR | Week retro |
| 6 | Lab 2 part 1 (property test on CanonicalJson) | Mentor pairing #2 |
| 7 | Lab 2 part 2 (break and fix CanonicalJson) | Code-review observation |
| 8 | Standup, work on track-PR (small detector tweak or test) | Pair-program with iOS lead |
| 9 | Standup, address review feedback | Pair-program with Android lead |
| 10 | Standup, ship track-PR | Week 2 retro + checkpoint |

---

## 14. The TL;DR

- **Three tracks** (SDK / Detection / Backend-SRE), one shared first 2 weeks.
- **90 days** to independent.
- **Mentor + manager are different people**; mentor teaches, manager develops.
- **Pairing is non-optional in Month 1.**
- **Reading is required but ruthlessly prioritised** — start with the four core docs and the glossary.
- **Hands-on labs** at each stage, with crisp success criteria.
- **TDD discipline** drilled from Week 1; you write the failing test *first*.
- **DDD vocabulary** is enforced; the glossary is the contract.
- **Onboarding ends with measurable artifacts** — merged PRs, an ADR, a brown-bag, on-call certification — not just "Joe says you're ready".

If you (the new engineer) are reading this and feel either *underwhelmed* ("seems easy") or *overwhelmed* ("seems too much"), tell your mentor on Day 1. The plan adapts; it's not a contract you signed in blood. But the *spine* — TDD discipline, DDD vocabulary, paired learning, on-call gradual ramp — does not bend, because it's what makes the team durable.

Welcome.

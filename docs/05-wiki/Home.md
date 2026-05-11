# `guardian-rn` Wiki

> The single source of truth for engineers, SREs, security advisors, and product owners working on `guardian-rn`. If something is true and durable, it lives here. If it's true and ephemeral, it lives in a ticket.

This wiki follows the **[Diátaxis](https://diataxis.fr)** framework: information is organised by what the reader is trying to *do*, not by what we feel like writing. Four shelves:

| Shelf | When you reach for it |
|---|---|
| **Tutorials** (learning-oriented) | "I'm new. Walk me through building something." |
| **How-To Guides** (task-oriented) | "I know what I want. Show me the steps." |
| **Reference** (information-oriented) | "I need to look up an exact value or contract." |
| **Explanation** (understanding-oriented) | "Why is it this way? What were the trade-offs?" |

Don't mix shelves in one page. If a page drifts, split it.

---

## 0. Start Here

- 🆕 **New to the project?** Go to [`Onboarding-Roadmap`](Onboarding-Roadmap.md) — a 90-day path with hands-on labs.
- 🛠 **Need to do a specific task?** Jump to [How-To Guides](#how-to-guides) below.
- 🧭 **Want to understand the architecture?** Start with [`Architecture-Overview`](Architecture-Overview.md), then [`Bounded-Contexts`](Bounded-Contexts.md).
- 🚨 **Production incident right now?** [`Runbook`](Runbook.md) → [`Incident-Response`](Incident-Response.md).

---

## 1. Tutorials (learning-oriented)

Read in order if you're new. Each tutorial has *guaranteed-to-work* end-to-end steps.

| # | Tutorial | Audience | Outcome |
|---|---|---|---|
| T-1 | [`Onboarding-Roadmap`](Onboarding-Roadmap.md) | Any new engineer | 90-day plan, week by week |
| T-2 | [`Lab-1-Build-The-Example-App`](labs/Lab-1-Build-The-Example-App.md) | Engineer, day 1 | RN example app running on iOS + Android |
| T-3 | [`Lab-2-Add-A-New-Threat`](labs/Lab-2-Add-A-New-Threat.md) | SDK engineer, week 1 | New threat detected end-to-end (schema → bus → JS) |
| T-4 | [`Lab-3-Wire-A-Telemetry-Adapter`](labs/Lab-3-Wire-A-Telemetry-Adapter.md) | SDK engineer | Threat events visible in Grafana |
| T-5 | [`Lab-4-Run-The-Collector-Locally`](labs/Lab-4-Run-The-Collector-Locally.md) | Backend / SRE | docker-compose stack: SDK → collector → ES → Grafana |
| T-6 | [`Lab-5-Build-A-Custom-Engine`](labs/Lab-5-Build-A-Custom-Engine.md) | SDK engineer, month 2 | Custom detector emitting through the bus |
| T-7 | [`Lab-6-Trigger-And-Triage-A-False-Positive`](labs/Lab-6-Trigger-And-Triage-A-False-Positive.md) | Detection engineer | Tune a detector confidence threshold |
| T-8 | [`Lab-7-Add-A-Grafana-Dashboard-Panel`](labs/Lab-7-Add-A-Grafana-Dashboard-Panel.md) | SRE / data-eng | Panel JSON committed, deployed via CI |

(Lab pages are stubs in this addendum and authored during P0–P3 of the implementation plan.)

---

## 2. How-To Guides (task-oriented)

Single-task recipes. Assume you understand the basics.

### 2.1 Development

- [`HowTo-Run-Codegen`](how-to/Run-Codegen.md)
- [`HowTo-Add-A-New-Threat-Type`](how-to/Add-A-New-Threat-Type.md) (operational checklist; pairs with Lab-2)
- [`HowTo-Add-A-Detector-To-The-Community-Engine`](how-to/Add-A-Detector-To-The-Community-Engine.md)
- [`HowTo-Write-A-Telemetry-Adapter`](how-to/Write-A-Telemetry-Adapter.md)
- [`HowTo-Update-The-Threat-Feed`](how-to/Update-The-Threat-Feed.md)

### 2.2 Testing

- [`HowTo-Write-A-Unit-Test`](how-to/Write-A-Unit-Test.md) (Jest / JUnit / XCTest)
- [`HowTo-Write-An-Acceptance-Test`](how-to/Write-An-Acceptance-Test.md) (Gherkin)
- [`HowTo-Run-The-Tampering-Test-Suite`](how-to/Run-The-Tampering-Test-Suite.md)
- [`HowTo-Run-Detox-Locally`](how-to/Run-Detox-Locally.md)

### 2.3 Build & Release

- [`HowTo-Cut-A-Release`](how-to/Cut-A-Release.md)
- [`HowTo-Sign-An-NPM-Package-With-Provenance`](how-to/Sign-An-NPM-Package-With-Provenance.md)
- [`HowTo-Roll-Back-A-Bad-Release`](how-to/Roll-Back-A-Bad-Release.md)

### 2.4 Operations

- [`HowTo-Provision-A-Tenant`](how-to/Provision-A-Tenant.md)
- [`HowTo-Rotate-Collector-Certificates`](how-to/Rotate-Collector-Certificates.md)
- [`HowTo-Trigger-An-Erasure-Request`](how-to/Trigger-An-Erasure-Request.md)
- [`HowTo-Investigate-A-Sequence-Gap`](how-to/Investigate-A-Sequence-Gap.md)
- [`HowTo-Triage-A-Critical-Threat-Alert`](how-to/Triage-A-Critical-Threat-Alert.md)

---

## 3. Reference (information-oriented)

Look-up tables, no narrative.

- [`API-Reference`](reference/API-Reference.md) — TypeScript public surface (auto-generated from typedoc, do not hand-edit).
- [`Threat-Catalogue`](reference/Threat-Catalogue.md) — every `ThreatId`, severity, evidence shape, platform support, engine providers.
- [`Configuration-Reference`](reference/Configuration-Reference.md) — every config option, default, validity rules.
- [`ECS-Field-Mapping`](reference/ECS-Field-Mapping.md) — every `guardian.*` field, type, example.
- [`Glossary`](reference/Glossary.md) — Ubiquitous Language. **Required reading** before any architecture conversation.
- [`Bounded-Contexts`](Bounded-Contexts.md) — context map and per-context responsibilities.
- [`Error-Codes`](reference/Error-Codes.md) — every error a host app or collector can return.
- [`HTTP-API`](reference/HTTP-API.md) — collector endpoints (OpenAPI export).
- [`Performance-Budgets`](reference/Performance-Budgets.md) — SLOs per layer.
- [`Permissions-Matrix`](reference/Permissions-Matrix.md) — Android/iOS permissions per feature.
- [`SDK-Compatibility-Matrix`](reference/SDK-Compatibility-Matrix.md) — RN versions × OS versions × engine versions.
- [`Release-History`](reference/Release-History.md) — every version, breaking change, security note.

---

## 4. Explanation (understanding-oriented)

Background, design rationale, trade-offs. Read when you ask "but *why*?"

- [`Architecture-Overview`](Architecture-Overview.md) — the big picture, in one read.
- [`Domain-Driven-Design`](Domain-Driven-Design.md) — strategic + tactical DDD applied here. Cross-links to `Bounded-Contexts`.
- [`Why-TurboModule-And-JSI`](explanation/Why-TurboModule-And-JSI.md) — and why we don't fall back to the legacy bridge.
- [`Why-HMAC-On-The-Bridge`](explanation/Why-HMAC-On-The-Bridge.md) — threat model excerpt, attacker capabilities considered.
- [`Why-Pluggable-Engines`](explanation/Why-Pluggable-Engines.md) — vendor-lock avoidance, defence-in-depth.
- [`Why-No-Abort`](explanation/Why-No-Abort.md) — graceful response policies as default.
- [`Why-ECS-And-Not-Custom`](explanation/Why-ECS-And-Not-Custom.md) — observability standardisation.
- [`Why-Self-Host-First`](explanation/Why-Self-Host-First.md) — sovereignty over SaaS.
- [`Trade-Offs-We-Made`](explanation/Trade-Offs-We-Made.md) — running list of "we knew, we picked, here's why".
- [`What-Is-NOT-Here`](explanation/What-Is-NOT-Here.md) — non-goals, with rationale.

---

## 5. Operational Pages

- [`Runbook`](Runbook.md) — what on-call does, hour by hour.
- [`Incident-Response`](Incident-Response.md) — SEV definitions, comms templates, post-mortem template.
- [`SLOs-And-Error-Budgets`](SLOs-And-Error-Budgets.md) — current burn, history.
- [`On-Call-Rotation`](On-Call-Rotation.md) — schedule + handoff checklist.
- [`Disaster-Recovery`](Disaster-Recovery.md) — backups, RTO/RPO, drill cadence.

---

## 6. Engineering Practice Pages

- [`Engineering-Practices`](Engineering-Practices.md) — TDD, code review, branching, commit style. **Read on day one.**
- [`Definition-Of-Done`](Definition-Of-Done.md) — what "done" means before merge.
- [`Coding-Standards`](Coding-Standards.md) — TS / Kotlin / Swift conventions (mostly automated).
- [`Architectural-Decision-Records`](adr/README.md) — every binding decision, with date and rationale.
- [`Security-Practices`](Security-Practices.md) — secrets, dep review, SAST, signed releases.
- [`Documentation-Standards`](Documentation-Standards.md) — Diátaxis rules, ownership, freshness review.

---

## 7. People & Process

- [`Onboarding-Roadmap`](Onboarding-Roadmap.md) — covered in Tutorials too; lives here for HR linkage.
- [`Roles-And-Responsibilities`](Roles-And-Responsibilities.md) — Tech Lead, SDK eng, Detection eng, SRE, Security Advisor.
- [`Decision-Rights`](Decision-Rights.md) — who can say "go" on what.
- [`Meetings`](Meetings.md) — sync cadence, async expectations.
- [`How-We-Plan`](How-We-Plan.md) — quarterly OKRs, sprint loop, escape hatches.

---

## 8. Wiki Hygiene

- **Owner per page.** Every page lists an owner in front-matter; owners review at least quarterly.
- **Dead pages get deleted.** A page hasn't been touched in 12 months and nobody opens it (we measure)? It goes. Better than misleading.
- **Edits are PRs.** Wiki content is git-versioned. Direct edits via the GitHub wiki UI are disabled.
- **Front-matter required**:

  ```yaml
  ---
  title: <human title>
  owner: <github-handle>
  audience: [tutorial|how-to|reference|explanation]
  last_reviewed: 2026-04-15
  ---
  ```

- **Cross-link, don't copy.** Repeating content guarantees drift; link to the canonical page.
- **No screenshots without alt text.** Accessibility, and screenshots rot — write the words.

---

## 9. Conventions in This Wiki

- File names use `Kebab-Case.md` and live under semantic subdirs (`how-to/`, `labs/`, `reference/`, `explanation/`, `adr/`).
- Code blocks always declare a language for syntax highlighting and to keep grep-ability.
- ADRs use the [MADR format](https://adr.github.io/madr/) — short, dated, status-tracked.
- Diagrams check in their source (Mermaid or PlantUML), not just rendered PNGs.
- Internal-only pages are tagged `audience: internal` in front-matter; public docs export skips them.

---

**Index author:** Tech Lead | **Last reviewed:** 2026-05-10 | **Audience:** all roles

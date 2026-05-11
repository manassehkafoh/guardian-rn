---
title: Engineering Practices
owner: tech-lead
audience: explanation
last_reviewed: 2026-05-10
---

# Engineering Practices

> *Goal:* one page that captures **how** we work, so that any new engineer can ship code on day one without breaking the team's norms. If you read only one practice page, read this. The rest are details.

## 1. The Five Non-Negotiables

1. **TDD red-green-refactor for all production code.** No untested code merges. See [`Domain-Driven-Design`](Domain-Driven-Design.md) §6 for the discipline applied per bounded context.
2. **Trunk-based development.** Short-lived branches (≤ 3 days), feature flags for incomplete work, no long-lived `develop` branch.
3. **Definition of Done is enforced by CI**, not by reviewer goodwill. See [`Definition-Of-Done`](Definition-Of-Done.md).
4. **Decisions get ADRs**, not Slack threads. Anything that constrains future work goes in `docs/adr/` as MADR.
5. **Security and observability are part of the feature**, not bolted on. A PR that adds a feature and ships zero telemetry/zero tampering tests is not a complete PR.

## 2. Branching & commits

- **Branch names**: `feat/<context>-<short-desc>`, `fix/<context>-<short-desc>`, `docs/...`, `chore/...`. The `<context>` aligns with a Bounded Context (e.g., `feat/bridge-integrity-add-replay-vector-test`).
- **Commit messages**: Conventional Commits. `<type>(<scope>): <subject>` — release-it pulls the changelog from these.
- **One concern per commit.** Refactors and behavioural changes never share a commit; they share a PR if necessary, but split into separate commits.
- **PRs**: ≤ 400 lines of diff is the soft cap. Larger PRs require a 5-minute walkthrough at review time and tend to get bounced.
- **Merge strategy**: squash for feature branches, merge commit for release branches.

## 3. TDD discipline (cross-platform)

We write tests first. Always. The mantra is `Red → Green → Refactor` and the cycle is short — minutes, not hours.

- **Red:** write a failing test that expresses a behaviour we don't have yet. It must compile and run; it must fail for the *right* reason.
- **Green:** write the simplest production code that passes. Hardcoded? Fine. Gross? Fine. Get to green.
- **Refactor:** with the safety net of green tests, clean up the design. Typed, named, decomposed.

Per-platform tooling:

| Platform | Unit | Integration | Acceptance |
|---|---|---|---|
| TypeScript | Jest + `@swc/jest` | Jest with mocked native | Detox (E2E) + Cucumber.js (BDD) |
| Kotlin | JUnit5 + Mockk | Robolectric | Espresso (instrumented) |
| Swift | XCTest | XCTest with `@testable` | XCUITest |
| Node (collector) | Vitest | Vitest + Testcontainers (ES, S3, Logstash) | Postman/Newman against staging |

A practice we enforce: **you cannot mark a test "skipped" in a PR.** If the test is wrong, fix it; if the production code is wrong, file a ticket and revert. Skipped tests are the enemy of trust.

## 4. The TDD-DDD pairing

Bounded contexts give us natural test boundaries. Inside a context, we use **outside-in TDD**:

1. Acceptance test (Gherkin, in `*.feature` files) — describes the user-visible behaviour for the context.
2. Unit tests for the domain model (entities, value objects, aggregates) — drive the design from the domain rules.
3. Adapter tests for ports (repositories, gateways) — verify integration without the slow dependencies.

Mocks for **collaborators we own** (London school). Real implementations for **value objects and pure functions** (Chicago school). Property-based tests (`fast-check`, `Kotest property`, `SwiftCheck`) for invariants — especially in the Bridge Integrity context where round-tripping must be exact.

## 5. Code review

- **Reviewer's job:** can I delete a test and have you keep the code working? Can I read this in 12 months and understand the *why*? Are the boundaries respected?
- **Author's job:** PR description has a 1-line *what*, a paragraph *why*, screenshots/recordings for UI, and an explicit `Tests:` section. Self-review the diff before requesting reviewers.
- **Throughput target**: first review within 4 working hours during local hours; merges within 1 working day for typical PRs.
- **No nit-bikeshedding without a comment label.** Use `[nit]`, `[blocking]`, `[question]` prefixes; non-blocking nits don't hold up a merge.
- **Two approvals** for cross-context PRs (e.g., a change touching both Bridge Integrity and Threat Detection). One approval is fine inside a single context, by an owner.

## 6. CI gates (every PR)

The pipeline will refuse to merge until:

- [ ] Lint, prettier, typecheck — green.
- [ ] `yarn codegen` — idempotent (no diff).
- [ ] Unit tests — coverage ≥ thresholds (85% JS, 70% Kotlin/Swift, 90% Node).
- [ ] Integration tests — green against ephemeral testcontainers (where applicable).
- [ ] Build matrix — Android + iOS example apps build on both old and new arch.
- [ ] Tampering tests — green (HMAC bridge contract).
- [ ] Schema-vs-code drift — no orphan or missing types.
- [ ] Dashboard JSON validation — every committed dashboard parses, queries are valid.
- [ ] License + dep audit — no GPL/AGPL transitive deps without exemption ADR.
- [ ] Security scanning — CodeQL + `npm audit` + `mvn dependency-check` clean (or accepted exceptions documented).

The pipeline takes ~12 minutes today; the budget is 15.

## 7. Versioning & release

- **SemVer** strictly. Breaking SDK changes only in major versions; threat-feed updates and detector tuning are minor; bug fixes are patch.
- **Release cadence**: minor every 4 weeks, patch as needed (target ≤ 1 week to patch a P0).
- **Release notes** per version, generated from Conventional Commits + hand-written highlights. See [`HowTo-Cut-A-Release`](how-to/Cut-A-Release.md).
- **Provenance**: every npm release is signed (OIDC), every Android AAR/iOS xcframework is signed (sigstore + Apple notarisation).

## 8. Observability & ops as code

- **Dashboards as code**: every Grafana dashboard lives as JSON in `dashboards/`, provisioned via Grafana file provisioning. No clicking-edit-in-prod.
- **Alerts as code**: rules in YAML in `alerting/`, with a golden-test fixture per rule.
- **Runbooks as code**: in this wiki under `Runbook.md`. On-call updates the runbook *during* the incident, not after.
- **SLOs are visible at all times**: D-6 dashboard is open on the team monitor.

## 9. Documentation discipline

- **Diátaxis applies.** Tutorials, How-Tos, Reference, Explanation. One shelf per page.
- **Every public API surface has a typedoc/dokka/jazzy docstring.** Linter enforces.
- **Wiki edits are PRs.** Direct GitHub-wiki UI edits are disabled.
- **Quarterly review.** Each owner walks their pages every quarter; pages with stale `last_reviewed` are flagged.

## 10. Security practices

- **Secrets**: never in git. We use 1Password Connect for dev, AWS Secrets Manager for prod. Pre-commit hook (gitleaks) blocks accidental commits.
- **Dependencies**: pinned exact versions in lockfile. Renovate raises PRs weekly. Security advisories trigger same-week patch PRs.
- **SAST**: CodeQL on every PR, gosec/semgrep on the collector.
- **Threat model**: lives in `docs/threat-model.md`, reviewed annually with an external advisor.
- **Disclosure**: `SECURITY.md` with PGP key + advisory mailbox; 72h ack, 30d patch.

## 11. Definition of Done

A change is "done" when:

- [ ] Acceptance criteria met (linked in the PR).
- [ ] All CI gates pass.
- [ ] Reviewer-approved.
- [ ] Documentation updated (the right Diátaxis shelf).
- [ ] Telemetry added (counters/timers/log) where new behaviour exists.
- [ ] Dashboards/alerts updated (where applicable).
- [ ] Migration plan written (where backwards-incompat).
- [ ] Threat model updated (where attack surface changes).
- [ ] Glossary updated (where new domain terms appear).
- [ ] Release notes drafted (collected at release time, but the entry is added on merge).

## 12. What we don't do

- **No "we'll add tests later."** The PR is incomplete; revert it.
- **No silent behaviour changes.** Add a flag, communicate, then default-flip in a later release.
- **No stack traces in user-facing UI.** Errors are wrapped at the boundary; debug detail goes to telemetry.
- **No console.log / printf / NSLog in production code.** Use the logger; log levels are honoured.
- **No "TODO: fix later" without a ticket reference.** `TODO(GUARD-1234)` or it's not a TODO.
- **No screen-clicking deploys.** Every change goes through CI/CD or it didn't happen.

## 13. Recommended reading (canon)

Books that the team treats as shared canon. Not required to memorise; required to *recognise* the patterns when discussed.

- *Domain-Driven Design*, Eric Evans (the blue book).
- *Implementing Domain-Driven Design*, Vaughn Vernon (the red book).
- *Test-Driven Development by Example*, Kent Beck.
- *Growing Object-Oriented Software, Guided by Tests*, Freeman & Pryce.
- *A Philosophy of Software Design*, John Ousterhout.
- *Site Reliability Engineering*, Beyer et al. (free online).
- *Accelerate*, Forsgren, Humble, Kim.
- *The Pragmatic Programmer*, 20th-anniversary edition.

---

**Owner:** Tech Lead | **Last reviewed:** 2026-05-10

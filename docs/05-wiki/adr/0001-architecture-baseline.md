---
title: "ADR-0001: Architecture baseline (TurboModule, JSI, HMAC, codegen)"
owner: tech-lead
audience: explanation
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0001: Architecture baseline

## Status
Accepted (2026-05-10).

## Context
We are building `guardian-rn` from scratch as a successor to `freerasp-react-native`, with explicit goals around type safety, multi-instance JS hygiene, vendor pluggability, and integrity of the native-JS bridge. The choices below shape every later ADR.

## Decision
1. **TurboModule + JSI HostObject** as the only native-JS contract. No legacy bridge support in v1.0.
2. **JSON-Schema** is the single source of truth for `ThreatId`, `Severity`, `Evidence`, and `GuardianConfig`. Codegen produces TS, Kotlin, and Swift artefacts.
3. **HMAC-SHA256 envelope** wraps every threat event crossing the bridge, with a per-process session key delivered via JSI and a monotonic sequence number.
4. **Pluggable engines** behind the `Engine` interface; community engine in-tree, commercial adapters as optional packages.
5. **Response policies** (`telemetry`, `restrict`, `lockout`, `kill`) replace the freerasp-rn `abort()` model. `kill` is opt-in and is the only one that terminates.
6. **Centralised observability is part of the product**: ELK + Grafana + a reporting worker are in-tree (`packages/collector`, `dashboards/`, `packages/reporting`).
7. **RN baseline = 0.74** (TurboModule + Codegen stable). No fallback to legacy bridge in v1.0.

## Consequences
- Adopters on RN < 0.74 cannot use v1.0; we ship a separate `guardian-rn-legacy` branch for them, best-effort.
- The team must invest in codegen tooling early; pays back from P1 onwards.
- Per-process key handling adds complexity but gives integrity guarantees the freerasp-rn random-id trick alone cannot.
- Self-hostable observability multiplies the test matrix; we accept this for sovereignty reasons.

## Alternatives considered
- **Legacy-bridge first, JSI later** — rejected; would lock us into the freerasp-rn shape we're trying to escape.
- **Random IDs only, no HMAC** — rejected; insufficient against an attacker who can reach the bridge.
- **Single closed-source detection engine** — rejected; recreates vendor-lock.
- **SaaS-only observability** — rejected; regulated customers need self-host.

## Links
- `02-superior-solution-proposal.md`
- `03-implementation-plan.md`
- `04-observability-addendum.md`

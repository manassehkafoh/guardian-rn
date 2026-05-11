---
title: Architecture Overview
owner: tech-lead
audience: explanation
last_reviewed: 2026-05-10
---

# Architecture Overview

> *Goal of this page:* in 10 minutes, give any engineer enough mental model to navigate the rest of the wiki and read the codebase without getting lost. Depth lives in [`Domain-Driven-Design`](Domain-Driven-Design.md), [`Bounded-Contexts`](Bounded-Contexts.md), and the four `02-…` and `04-…` design docs.

## 1. The product, in one paragraph

`guardian-rn` is a React Native library that detects runtime threats against a mobile app (root, hooks, debugger, screen capture, malware co-installation, etc.), reports them through a cryptographically authenticated channel to the JS side, lets the host app react via configurable response policies, and ships a centralised observability stack (collector → Elasticsearch → Grafana → reports) that a security team actually runs. Engines are pluggable — there's a community OSS engine plus optional commercial adapters (Talsec, etc.). The library is built on TurboModule + JSI for the New Architecture; the bridge is HMAC-signed so tampering is detectable rather than just statically obscured.

## 2. Layers, top to bottom

```
┌────────────────────────────────────────────────────────────────────┐
│  Host React Native app                                             │
│   • policy: telemetry|restrict|lockout|kill                        │
│   • routes/UI react to ThreatEvent or RestrictEvent                │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  useGuardian(config, options)
┌────────────────────────────────▼───────────────────────────────────┐
│  guardian-rn JS API                                                │
│   • hooks: useGuardian, useThreatHandler, useThreatActions         │
│   • store: refcounted subscribers, engine state machine            │
│   • verifier: HMAC envelope check (rejects on tamper)              │
│   • policy engine: dispatches the configured response              │
│   • telemetry adapters: Sentry / Datadog / Elastic / custom        │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  TurboModule + JSI HostObject
┌────────────────────────────────▼───────────────────────────────────┐
│  Native bridge (Kotlin / Swift / C++ JSI)                          │
│   • GuardianHostObject — sync subscribe / sessionKey / lifecycle   │
│   • ThreatBus — SharedFlow / AsyncStream, replay 32, conflated     │
│   • HMAC signer + monotonic seq numbers                            │
│   • Lifecycle dispatcher (foreground gate, scene awareness)        │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  Engine.emit(ThreatPayload)
┌────────────────────────────────▼───────────────────────────────────┐
│  Engines (parallel, conflated by ThreatId)                         │
│   • Community engine (in-tree, OSS, no binary blobs)               │
│   • Talsec adapter (optional, @guardian/engine-talsec)             │
│   • Custom engines (host-supplied)                                 │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  HTTPS mTLS / NDJSON gzip
┌────────────────────────────────▼───────────────────────────────────┐
│  @guardian/collector (Node + Fastify)                              │
│   • Auth (mTLS + tenant key) → ECS validate → redact → fan-out     │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
         ┌──────────────┐ ┌──────────┐    ┌──────────────┐
         │ Elasticsearch│ │ S3 (WORM)│    │ Kafka        │
         │ + ILM        │ │ audit    │    │ (optional)   │
         └──────┬───────┘ └──────────┘    └──────────────┘
                │
                ▼
         ┌──────────────┐
         │ Grafana      │
         │ + Alerting   │
         └──────┬───────┘
                ▼
         ┌──────────────┐
         │ Reporting    │
         │ worker       │
         └──────────────┘
```

## 3. Five things that make this design distinctive

1. **Codegen-driven schemas.** All threat types, severities, and evidence shapes live in JSON Schema. TypeScript types, Kotlin sealed classes, and Swift enums are generated. Adding a threat is a one-file PR.
2. **HMAC-signed bridge envelopes.** Per-process keys live in Keystore/Keychain, are handed to JS via JSI (never serialised through the legacy bridge), and every event carries a monotonic sequence number. Tampering is *detected*, not just made awkward.
3. **Pluggable engines.** Detection is not a single closed-source binary. Community engine ships in source; commercial detectors plug in as adapters; both can run together with results conflated.
4. **Graceful response policies, never `abort()`.** The host picks `telemetry`, `restrict`, `lockout`, or `kill`. Default is restrict (log out of sensitive surfaces, keep the app cleanly closable).
5. **First-class centralised observability.** ELK + Grafana + a reporting worker ship together. ECS-mapped events make threat data join cleanly with the host's existing logs.

## 4. The two flows you'll trace most often

### 4.1 Threat detection (happy path)

1. `useGuardian(config, options)` mounts in the app.
2. JS calls `Guardian.start(config)` (TurboModule).
3. Native registers engines via `EngineRegistry`.
4. Each engine runs its detectors; positive signals call `bus.emit(ThreatPayload)`.
5. `ThreatBus` signs the payload (HMAC + seq), writes a `SignedEnvelope` into the SharedFlow.
6. JSI HostObject pushes the envelope into JS subscribers via `CallInvoker`.
7. JS verifier checks HMAC + sequence. Pass → policy engine dispatches; fail → `InvariantBreach` event, telemetry adapter fires, host's invariant-breach handler runs.

### 4.2 Telemetry shipping

1. Host installs `elasticTelemetry({...})` adapter via `guardian.telemetry.use(...)`.
2. Each verified `ThreatEvent` flows through the adapter's queue.
3. Adapter batches (max 50 / 5s / 256KB), writes NDJSON to local SQLite buffer, attempts HTTPS POST.
4. On success, drains buffer; on failure, exponential backoff + jitter.
5. Collector receives, validates against ECS, redacts, fans out to ES + S3 audit + (optional) Kafka.
6. Logstash decorates and writes to a per-tenant ES data stream.
7. Grafana dashboards query the stream. Reporting worker runs weekly digests.

## 5. Where the code lives

| Area | Location | Owner |
|---|---|---|
| JS public API | `packages/guardian-rn/src/` | SDK eng |
| TurboModule specs | `packages/guardian-rn/src/specs/` | SDK eng |
| Codegen tooling | `tools/codegen/` | SDK eng |
| Schemas | `schemas/*.schema.json` | SDK eng + Detection eng |
| Android native | `packages/guardian-rn/android/` | SDK eng (Android) |
| iOS native | `packages/guardian-rn/ios/` | SDK eng (iOS) |
| Community engine | `packages/engine-community/` | Detection eng |
| Talsec adapter | `packages/engine-talsec/` | SDK eng |
| Telemetry adapters | `packages/telemetry-*/` | SDK eng |
| Collector service | `packages/collector/` | Backend / SRE |
| Grafana dashboards | `dashboards/` | SRE |
| Reporting worker | `packages/reporting/` | Backend |
| Helm + Terraform | `deploy/` | SRE |
| Wiki / docs | `docs/wiki/` | All (Tech Lead reviews) |

## 6. Reading order for new engineers

1. This page.
2. [`Domain-Driven-Design`](Domain-Driven-Design.md) — what the domain looks like.
3. [`Bounded-Contexts`](Bounded-Contexts.md) — where lines are drawn.
4. [`Glossary`](reference/Glossary.md) — the words, used precisely.
5. [`Engineering-Practices`](Engineering-Practices.md) — how we work.
6. [`Onboarding-Roadmap`](Onboarding-Roadmap.md) — your 90 days.

## 7. Design references

- `02-superior-solution-proposal.md` — the *what* and *why* (out-of-wiki, in-repo at `docs/design/`).
- `03-implementation-plan.md` — the *when*.
- `04-observability-addendum.md` — the centralised pipeline.
- `06-domain-driven-design-with-tdd.md` — the modelling and testing discipline.

---

**Owner:** Tech Lead | **Last reviewed:** 2026-05-10

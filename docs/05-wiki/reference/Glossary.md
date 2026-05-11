---
title: Glossary (Ubiquitous Language)
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
---

# Glossary — Ubiquitous Language

> *Why this page is required reading:* in DDD, the **Ubiquitous Language** is the shared vocabulary that domain experts, engineers, product, and on-call all use when discussing the system. If we use the same word for two things, or two words for the same thing, we will build the wrong system. This page is the canonical dictionary. Disagreements about meaning are resolved by editing this page first, then the code.

Terms are organised by Bounded Context. A term may appear in multiple contexts with **different** meanings — that's intentional and the glossary makes the distinction explicit.

---

## Cross-Cutting

| Term | Meaning |
|---|---|
| **Threat** | Any condition the system is configured to detect. Always belongs to a `ThreatId`. Not a generic synonym for "problem" or "bug". |
| **ThreatId** | The canonical name of a threat type (e.g., `hooks`, `privilegedAccess`, `screenshot`). Defined in `schemas/threats.schema.json`; never a free-form string elsewhere. |
| **Detector** | A piece of code that decides whether a specific signal indicates a specific `ThreatId`. Lives inside an Engine. Returns `(detected, confidence, signals)`. |
| **Engine** | A coherent set of Detectors plus the lifecycle to run them. Implements `Engine` interface. The Community Engine, the Talsec Adapter, etc. |
| **ThreatPayload** | The pre-signing data structure: `{id, severity, confidence, evidence, capturedAt, engine, sessionId, sequenceNumber}`. |
| **SignedEnvelope** | A `ThreatPayload` plus its HMAC and sequence number, ready to cross the JSI boundary. The only shape that crosses native↔JS. |
| **ThreatEvent** | A `ThreatPayload` after JS-side verification has succeeded. JS consumers deal in this type, not in envelopes. |
| **InvariantBreach** | The named state we enter when an envelope fails verification, a sequence is replayed, or any other "this should be impossible" condition occurs. Triggers the breach handler, not the threat handler. Distinct from a threat. |
| **Session** | A single `Guardian.start(...)` lifetime. Each session has its own `sessionId` (UUIDv4) and HMAC key. Sessions end on `stop()` or process death. |
| **Tenant** | The customer organisation operating the host app. The collector identifies tenants by API key + mTLS cert. Different from "user" — one tenant has many users. |
| **Subscriber** | A JS-side recipient of threat events, identified by `subscriberId`. One `useGuardian` mount = one Subscriber. |
| **Filter** | A predicate a Subscriber registers describing which threats it cares about. Default filter is `() => true`. |

---

## Bounded Context: **Threat Detection** (core domain)

| Term | Meaning |
|---|---|
| **Engine Capability** | The set of `ThreatId`s an Engine can possibly emit. Declared statically (`engine.capabilities`) — used to gate config validation. |
| **Confidence** | A real number in `[0, 1]` set by a Detector. Drives policy: severities are a *combination* of base severity (per ThreatId) and confidence. Below 0.6 → maximum severity = `low`. |
| **Evidence** | Discriminated-union sub-record of `ThreatPayload`. The shape depends on `id` — e.g., `{kind: 'hooks', framework, signatures[]}`. Evidence is opaque to JS; only the policy and telemetry layers read it. |
| **Conflation** | The merging of two events with the same `ThreatId` from different Engines within a 250 ms window. Result: one `ThreatEvent` with `severity = max`, `confidence = max`, `engine = [a, b]`, `evidence = union`. |
| **Detector Run** | A single invocation of a Detector. Synchronous on `Guardian.start()`; some Detectors also re-run on lifecycle events (e.g., `applicationDidBecomeActive`). |

**Anti-terms (do not use):**
- "Hack" — too vague. Use `ThreatId`.
- "Alert" — that's a Grafana concept; in the SDK we have Threats and Events, not Alerts.

---

## Bounded Context: **Bridge Integrity** (core domain)

| Term | Meaning |
|---|---|
| **Session Key** | The 32-byte HMAC-SHA256 key generated per Session. Lives in Keystore (Android) or Keychain (iOS) for the process lifetime. JS receives a copy via JSI `getSessionKey()`. Never logged. |
| **HMAC Envelope** | The serialised `{payload, sig, seq}` triple that crosses the bridge. `sig = HMAC-SHA256(key, canonicalJson(payload) || seq)`. |
| **Sequence Number** | A monotonic `uint64` that increments per emission within a Session. Detects drops, replays, and reordering. Resets on Session restart. |
| **Verifier** | The JS code (`src/core/verifier.ts`) that checks the HMAC and sequence number for each envelope. The single point of authority for bridge trust. |
| **Sequence Gap** | A jump > 1 in the sequence number observed by the Verifier. Logged as telemetry; if `> 0.1%` of events show gaps, alert A-4 fires. |
| **Replay** | An envelope with `seq <= lastSeen`. Always rejected; always raises `InvariantBreach`. |
| **Canonical JSON** | Deterministic JSON serialisation: keys sorted lexically, no whitespace, numbers in shortest-form decimal. Both signer and verifier MUST use the same algorithm; an internal vector test enforces this. |

**Distinct meanings to watch:** "Key" in this context means HMAC key. In Android-platform terms, a "key" can mean a Keystore entry — both apply. "Session" here is the SDK session, **not** the user's login session in the host app.

---

## Bounded Context: **Subscriber & Lifecycle** (supporting)

| Term | Meaning |
|---|---|
| **Subscriber** | (cross-cutting; defined above). Specifically here, a row in the in-memory store with `id`, `filter`, `handlersRef`. |
| **Refcount** | The Engine starts when the first Subscriber attaches and stops when the last detaches *and* `stopOnUnmount: true`. Default is `false` — engine outlives any single mount. |
| **Engine State** | `idle | starting | running | degraded | stopped | breached`. State transitions are the only thing the host's `onState` callback receives. |
| **Foreground Gate** (Android) | The boolean that, when false, causes the dispatcher to cache events instead of emitting. Driven by `LifecycleEventListener`. |
| **Scene** (iOS) | A `UIWindowScene`. Multi-scene apps have many. Screen-capture blocking and threat dispatch are scene-aware. |

---

## Bounded Context: **Response & Policy** (core domain)

| Term | Meaning |
|---|---|
| **Policy** | The configured response category: `telemetry`, `restrict`, `lockout`, `kill`, or `custom`. |
| **RestrictEvent** | A JS-side event the host listens to and uses to navigate away from sensitive screens. Carries the original `ThreatEvent`. |
| **Lockout** | A response that requires the user to re-authenticate to continue. The SDK doesn't perform the auth; it emits a `LockoutEvent` and clears any in-memory secrets the host registered. |
| **Kill** | The terminal response. After a configurable `gracePeriodMs` (default 1000 ms), the SDK calls a host-overridable `terminate()` that defaults to `process.exit(0)` on Android (after a clean unbind) and `exit(EXIT_SUCCESS)` on iOS. **Never `abort()`.** |
| **Grace Period** | Window between policy decision and termination, during which a final telemetry beacon is shipped. |
| **Sensitive Screen** | A route name registered in policy config (`sensitiveScreens: ['/balance', '/transfer']`) that `restrict` policy navigates away from. |

**Anti-terms:** "Crash" is what the OS does when something breaks; we don't crash, we *terminate*. "Quit" is what users do; we *terminate*. Use the precise word.

---

## Bounded Context: **Threat Telemetry** (supporting, client-side)

| Term | Meaning |
|---|---|
| **Telemetry Adapter** | A function `(ThreatEvent) => void | Promise<void>` registered via `guardian.telemetry.use(...)`. |
| **Batch** | A grouped flush of buffered events. Bounded by max-events, max-age, max-bytes. |
| **Offline Buffer** | The on-device persistent queue (default SQLite) that holds events when the network or collector is unavailable. |
| **Backpressure** | The condition where events arrive faster than the adapter can ship them. Resolved by drop-newest after buffer cap, with a counter. |
| **Conflation Window** | 250 ms; multiple events with the same `(threatId, severity)` are folded into one within this window. |

---

## Bounded Context: **Observability Ingest** (supporting, server-side)

| Term | Meaning |
|---|---|
| **Collector** | The Node/Fastify service at `/v1/ingest`. Stateless. The trust boundary between device fan-in and sink fan-out. |
| **Sink** | A downstream system the collector writes to. Examples: Logstash, S3 audit, Kafka, Loki. Each has a circuit breaker. |
| **Tenant Stream** | An ES data stream named `logs-guardian.threat-<tenantId>`. Per-tenant ILM and retention applies. |
| **Probe** | A synthetic event the SRE harness emits every minute per region to measure end-to-end freshness. |
| **Freshness** | `now() - capturedAt` measured at search time. SLO: < 60 s p99. |
| **Retention** | The duration data lives in ES. Default 365 days; per-tenant override. |
| **Erasure** | A GDPR Art. 17 request to delete all events for a hashed `externalId`. Performed via `_delete_by_query`; logged to S3 WORM. |

**Anti-terms:** "Log" is overloaded. In the collector, an event is an `ECSEvent`, not a "log line".

---

## Bounded Context: **Configuration** (generic, code-gen'd)

| Term | Meaning |
|---|---|
| **Schema** | The JSON-Schema documents in `schemas/`. The single source of truth for shapes. |
| **Codegen** | The `yarn codegen` step that produces TS / Kotlin / Swift artefacts from the schemas. |
| **GuardianConfig** | The top-level configuration object accepted by `Guardian.start()`. Validated at runtime by ajv against `config.schema.json`. |
| **Engine Config** | Sub-record under `engines.<name>` — engine-specific options (e.g., `engines.talsec.appBundleId`). |
| **Policy Config** | Sub-record under `policy` — see Response & Policy context. |

---

## Bounded Context: **Compatibility** (supporting)

| Term | Meaning |
|---|---|
| **Compat Shim** | The `guardian-rn/compat/freerasp-rn` module that re-exports `useFreeRasp` and the original public surface. |
| **Translation** | The function inside the shim that maps `TalsecConfig` → `GuardianConfig`. |
| **Drop-in** | A migration where the consumer changes only their imports and config stays identical. The shim guarantees drop-in for freerasp-rn 4.5.x. |

---

## Bounded Context: **Reporting** (supporting, server-side)

| Term | Meaning |
|---|---|
| **Digest** | A periodic (default weekly) report rendered by the Reporting worker. |
| **Renderer** | A function `(QueryResults) => RenderedReport` — `email-html`, `pdf`, `markdown`. |
| **Schedule** | A per-tenant cron expression with a tenant-local timezone. |
| **Recipient** | An email address or webhook target configured per tenant. |

---

## Versioning the Glossary

This page is versioned with the codebase. Adding a term: PR with a one-line description and the context. Renaming a term: PR that updates this page **and every reference in the code, in the same PR**. Removing a term: deprecate first (mark `[DEPRECATED — do not use]`), wait one release cycle, then delete.

---

**Owner:** Tech Lead | **Last reviewed:** 2026-05-10

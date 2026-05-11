# Product Design Document: guardian-rn v1.1.0

**Status**: Draft  
**Author**: Product — Alex  
**Last Updated**: 2026-05-11  
**Version**: 1.0  
**Stakeholders**: Core SDK Engineering, Security Research, DevRel, OSS Community, MDAM Integration Partners

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Goals and Non-Goals](#2-product-goals-and-non-goals)
3. [Architecture Baseline (v1.0.0)](#3-architecture-baseline-v100)
4. [v1.1.0 Improvements — User Stories](#4-v110-improvements--user-stories)
5. [Success Metrics](#5-success-metrics)
6. [Risk Assessment](#6-risk-assessment)
7. [Rollout Strategy](#7-rollout-strategy)
8. [Competitive Positioning](#8-competitive-positioning)
9. [Versioning and Backwards Compatibility](#9-versioning-and-backwards-compatibility)
10. [Appendix](#10-appendix)

---

## 1. Executive Summary

### Problem

Mobile applications operating in hostile environments — enterprise managed-device fleets, consumer devices with elevated privileges, adversarial lab environments — require runtime self-defense capabilities that go beyond static binary hardening. The dominant open-source option, `freerasp-react-native`, suffers from three structural limitations that enterprise and security-forward teams consistently hit:

1. **Architecture coupling**: a single vendor engine with no pluggability means teams cannot substitute their own detectors or integrate commercial threat intelligence providers without forking.
2. **JS bridge hygiene**: the legacy RCTEventEmitter bridge allows stale-closure listener bugs and provides no tamper-evident integrity guarantee on native-to-JS threat signals.
3. **Policy rigidity**: binary on/off listener callbacks with no confidence scoring, no threshold tuning, and no adaptive response gradient. A `root` detection and a `suspicion of emulator` produce identical callback shapes despite representing fundamentally different risk postures.

These limitations cause three concrete product failures: false positives that lock out legitimate users, false negatives that let bypass techniques go silent, and an inability for security teams to tune response behavior to their specific threat model without modifying SDK internals.

### Solution

`guardian-rn` is a production-grade React Native RASP SDK that solves these problems through a clean layered architecture: a TurboModule + JSI native layer, an HMAC-signed EventBus with dedup and rate-cap, a confidence-scored PolicyEngine with four graduated response tiers (`telemetry | restrict | lockout | kill`), and a pluggable Engine interface that any detector implementation can satisfy.

v1.0.0 delivered this foundation across seven development phases. v1.1.0 extends it with 13 security and operational improvements derived from academic research in mobile application security (Kouadri Mostefaoui & Tariq, "Mobile Apps Engineering Design, Development, Security, and Testing," CRC Press 2019). These improvements address the next layer of gaps: adaptive response intelligence, operational resilience, attack surface reduction, test coverage, and device security posture awareness.

### Target Users

| Persona | Description | Primary v1.1.0 Value |
|---------|-------------|----------------------|
| **Security Engineer** | Owns mobile threat posture at a fintech, healthtech, or enterprise company. Defines policies, reviews incidents, validates detection coverage. | Adaptive thresholds, behavioral baseline, signed telemetry, security integration tests |
| **Mobile Engineer** | Integrates guardian-rn into an RN app. Owns performance budget and battery impact. | Battery-aware throttling, fast-path bypass, p95 benchmarks, DeviceAuthDetector |
| **SDK Author / Engine Vendor** | Builds a custom or commercial detector engine that satisfies the `Engine` interface. | Battery-aware `Engine.throttle()`, signed telemetry session key API, offline PolicyStore |
| **Platform/MDM Administrator** | Manages Android enterprise managed profiles. Needs visibility into work-profile isolation state. | Managed-profile awareness in `EngineContext` |
| **OSS Contributor / Auditor** | Reviews guardian-rn for security properties, builds trust in the implementation. | Security integration tests, obfuscation layer, random ThreatId mapping |

---

## 2. Product Goals and Non-Goals

### Goals for v1.1.0

**Security depth**
- Raise the cost of bypass attacks through obfuscated ThreatId constants that defeat static bundle analysis.
- Detect device-level security gaps (no passcode, no biometric, sideloaded installs) and surface them as first-class threat events.
- Ensure outbound telemetry payloads are signed so backend ingest pipelines can reject tampered reports.
- Make adaptive threat response possible by having the PolicyEngine self-calibrate thresholds based on observed frequency.

**Operational resilience**
- Allow the SDK to function correctly when MDAM server connectivity is interrupted, by caching server-pushed policies locally in encrypted storage.
- Enforce session expiry so that compromised or replayed sessions cannot maintain access indefinitely.
- Prevent critical threat events from being lost inside EventBus dedup windows during an active attack.

**Performance and battery**
- Provide a configurable battery-aware scan throttle so the SDK does not degrade user experience on low-power devices or when the app is backgrounded.
- Establish CI-enforced performance benchmarks to prevent regressions in scan cycle latency.

**Device context awareness**
- Surface Android managed-profile (work profile) state as a first-class field in `EngineContext` so engine authors and app code can adapt behavior to enterprise deployment contexts.
- Detect dynamic threat frequency anomalies and escalate confidence automatically when attack patterns deviate from baseline.

**Test coverage**
- Provide a security-focused integration test suite that validates the hardest-to-test behaviors: attacker injection, policy bypass, telemetry silence, and session replay.

### Non-Goals for v1.1.0

- **Server-side policy management UI**: the `PolicyStore` improvement (item 8) provides the client-side caching infrastructure for server-pushed policies. The management console, push protocol, and MDAM server changes are out of scope for this SDK release.
- **iOS managed-profile equivalent**: Apple does not expose an equivalent to Android `DevicePolicyManager` in the same programmatic form. MDM enrollment state on iOS requires entitlements and MDM profile inspection that are out of scope here.
- **Full JS bundle encryption**: item 12 delivers random ThreatId mapping per session, which defeats static analysis. Full JS bundle encryption (e.g., Hermes bytecode encryption) is a separate initiative with significant toolchain implications and is deferred to a future roadmap cycle.
- **Malware signature database updates**: the `malware` ThreatId is already part of the v1.0.0 surface. Automated signature database refresh is a backend concern outside the SDK boundary.
- **React Native < 0.74 support**: the TurboModule-only architecture established in ADR-0001 is unchanged. No legacy bridge support will be added.
- **New threat categories beyond item 13**: DeviceAuthDetector (item 13) completes the planned threat surface expansion for v1.1.0. Additional categories are candidates for v1.2.0 based on discovery findings.

---

## 3. Architecture Baseline (v1.0.0)

This section establishes the v1.0.0 foundation that v1.1.0 improves upon. All 13 items in this document build on or extend these components.

### Component Map

```
App (React Native)
  └── useGuardian(config)            [hooks/useGuardian.ts]
        ├── Engine (1..N)            [engine/Engine.ts — interface]
        │     ├── CommunityEngine    [packages/engine-community]
        │     └── <VendorEngine>     [any impl satisfying Engine interface]
        ├── EventBus                 [core/eventbus — HMAC-verify, dedup, rate-cap]
        ├── PolicyEngine             [core/policy.ts — confidence thresholds, kill timer]
        ├── TelemetryAdapter         [telemetry/TelemetryAdapter.ts — interface]
        └── TerminatorPort           [policy/TerminatorPort.ts — interface]

Native Layer (per platform)
  ├── TurboModule (Android: GuardianRNModule.kt / iOS: GuardianRNModule.swift)
  ├── ThreatBus (Android: MutableSharedFlow / iOS: AsyncStream)
  ├── GuardianHostObject.cpp         [JSI HostObject — one-time session key delivery]
  ├── SessionKeyManager.kt           [AndroidKeyStore-backed HMAC key]
  ├── EncryptedStorageManager.kt     [AES-256-GCM, EncryptedSharedPreferences]
  └── KeychainStorageManager.swift   [Keychain, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]

Envelope Layer
  ├── CanonicalJson.ts               [RFC 8785 JCS]
  ├── HmacEnvelope.ts                [verifyEnvelope, computeHmac, constant-time compare]
  └── SequenceTracker.ts             [replay / gap / rollover / wrong-session detection]
```

### Key Contracts

**Engine interface** (`engine/Engine.ts`): `start(ctx) → Promise<void>`, `stop() → Promise<void>`, `onThreat: Observable<ThreatEvent>`, `onHealthTick: Observable<EngineHealthTick>`. Health ticks must fire at least every 60 000 ms while running.

**ThreatEvent** (`events/ThreatEvent.ts`): `threatId: ThreatId`, `severity: Severity`, `confidence: number [0.0–1.0]`, `evidence: Record<string, string>`, `ts: number`, `engineId: string`.

**PolicyEngine** (`core/policy.ts`): applies the `ResponsePolicy` for each `ThreatId` against the event's confidence score. Default thresholds: `restrict ≥ 0.5`, `lockout ≥ 0.7`, `kill ≥ 0.9`. Kill is deferred by `graceMs` and cancellable on unmount.

**GuardianConfig** (`config/GuardianConfig.ts`): `tenantId`, `engines[]`, `policies`, `confidenceThresholds`, `killPolicy`, `busConfig`, `telemetry`, `terminator`, `actions`.

**ThreatId schema** (`packages/schema/threat-schema.json`): 22 canonical IDs, codegen-driven across TypeScript, Kotlin sealed class, and Swift enum. Any addition requires a codegen run.

---

## 4. v1.1.0 Improvements — User Stories

Each improvement is presented with its design rationale, acceptance criteria, and the specific codebase contact points it touches.

---

### Item 1 — OODA Adaptive Threshold Feedback

**Academic grounding**: OODA loop (Observe, Orient, Decide, Act) applied to policy calibration. A static threshold ignores the difference between a device that has seen zero threats in 30 days and one that is under active attack. Threat frequency is a signal; the PolicyEngine should incorporate it.

**User Story**

As a security engineer, I want the PolicyEngine to automatically tighten confidence thresholds when it observes a sustained spike in threat frequency, so that a device under active attack triggers lockout and kill responses faster than the static baseline would allow — without requiring manual reconfiguration.

**Acceptance Criteria**

- [ ] `PolicyEngine` maintains a rolling threat-frequency counter per `ThreatId` over a configurable window (default: 60 000 ms).
- [ ] When the rolling frequency for any ThreatId exceeds `adaptiveThresholdConfig.spikeMultiplier` times its historical mean, the effective threshold for that ThreatId is reduced by `adaptiveThresholdConfig.tightenBy` (floor: the configured minimum, default: 0.05 below base).
- [ ] Adapted thresholds decay back toward the configured base over `adaptiveThresholdConfig.decayMs` (default: 300 000 ms) once frequency normalises.
- [ ] Threshold adaptations are observable via a new `onThresholdAdaptation` callback in `GuardianConfig.actions` (optional; non-breaking).
- [ ] Adaptation logic is covered by unit tests including: no-spike (thresholds unchanged), spike above multiplier (thresholds tighten), decay after spike (thresholds recover).
- [ ] When `adaptiveThresholdConfig` is absent from `GuardianConfig`, behavior is identical to v1.0.0 — no silent behavior change for existing integrators.

**Contact Points**: `core/policy.ts` (PolicyEngine class), `config/GuardianConfig.ts` (new `AdaptiveThresholdConfig` field), `GuardianConfig` schema entry.

---

### Item 2 — Fast-Path for Critical Events

**Academic grounding**: dedup windows exist to suppress noise from high-frequency detectors. However, they introduce latency for the highest-confidence events — exactly the events where latency is most dangerous. A hooks or tamper event at confidence ≥ kill threshold should never wait 100 ms in a dedup buffer.

**User Story**

As a mobile engineer integrating guardian-rn into a banking app, I want hook-detection and tamper events at kill-level confidence to bypass the EventBus dedup window entirely and be applied to the PolicyEngine immediately, so that process termination is not delayed by bus batching during an active instrumentation attack.

**Acceptance Criteria**

- [ ] `EventBus` inspects each incoming `ThreatEvent`'s confidence before entering the dedup window.
- [ ] If `event.confidence >= resolvedKillThreshold`, the event is dispatched directly to the PolicyEngine synchronously, bypassing the `dedupWindowMs` timer.
- [ ] Normal-confidence events continue to pass through the dedup window without change.
- [ ] The fast-path is tested with: kill-confidence event (dispatched immediately, no dedup delay), sub-kill event (dedup applies), kill-confidence event followed by duplicate within dedup window (second duplicate is still deduped even on fast path — first delivery is sufficient).
- [ ] `BusConfig` gains an optional `fastPathEnabled: boolean` (default: `true`). Setting `false` reverts to v1.0.0 behavior for environments where consistent dedup is preferred.

**Contact Points**: `core/eventbus.ts` (dedup dispatch path), `config/GuardianConfig.ts` (`BusConfig`), `packages/schema/threat-schema.json` (`BusConfig` definition).

---

### Item 3 — Battery-Aware Scan Throttling

**Academic grounding**: continuous polling-based detectors on mobile devices contribute measurably to battery drain. Foreground and background scan rates should differ. Security engineers want protection; users want battery life; this is a false dichotomy if the SDK exposes the right controls.

**User Story**

As a mobile engineer, I want to configure separate foreground and background scan intervals for all engines, and optionally call `Engine.throttle(mode)` to switch modes programmatically, so that background scan frequency is reduced without requiring a full engine restart — protecting the user's battery while maintaining meaningful coverage.

**Acceptance Criteria**

- [ ] `GuardianConfig` gains a `scanThrottle` field with shape `{ foregroundIntervalMs: number, backgroundIntervalMs: number }`. Both default to the engine's current internal scan rate if unset (no behavior change for existing configs).
- [ ] `Engine` interface gains an optional `throttle?(mode: 'foreground' | 'background' | 'suspended'): void`. Engines that do not implement `throttle` are not affected.
- [ ] `useGuardian` hook subscribes to `AppState` changes and calls `engine.throttle('background')` on `AppState.change` to `background`/`inactive`, and `engine.throttle('foreground')` on return to `active`.
- [ ] `CommunityEngine` implements `throttle()` and adjusts its polling interval accordingly.
- [ ] A `suspended` mode causes the engine to pause all scans. Useful for supervised test environments where scans must not fire.
- [ ] Battery throttle behavior is validated in a test that simulates AppState transitions and asserts the correct throttle mode was applied to all engines.

**Contact Points**: `engine/Engine.ts` (optional `throttle` method), `config/GuardianConfig.ts` (`scanThrottle`), `hooks/useGuardian.ts` (AppState subscription), `packages/engine-community` (CommunityEngine implementation).

---

### Item 4 — Signed Outbound Telemetry

**Academic grounding**: telemetry pipelines are an attack surface. An adversary who can silence or forge telemetry data can blind the backend ingest system to an active compromise. Signing telemetry payloads with the session HMAC key creates an integrity guarantee that the collector can verify before indexing.

**User Story**

As a security engineer operating a MDAM backend, I want each telemetry payload emitted by the SDK to be HMAC-signed with the session key, so that my ingest pipeline can cryptographically verify that a payload originated from a live guardian-rn session and was not forged or replayed by an attacker who gained access to the telemetry channel.

**Acceptance Criteria**

- [ ] `TelemetryAdapter` interface gains an optional `init(sessionKey: Uint8Array): void` lifecycle method. `useGuardian` calls `telemetry.init(sessionKey)` after the JSI session key is retrieved, before the first engine starts.
- [ ] Adapters that implement `init` receive the session HMAC key and are responsible for signing payloads before transmission. Adapters that do not implement `init` continue to function without signing (backwards compatible).
- [ ] The SDK ships a reference `SignedTelemetryAdapter` implementation that wraps any `TelemetryAdapter` and injects a `sha256=<hex>` HMAC signature field on every `recordThreat` call using the same HMAC-SHA256 implementation as the EventBus envelope (`HmacEnvelope.ts`).
- [ ] The session key is passed once only. Attempts to call `init` a second time on the reference adapter throw `TelemetryInitError`.
- [ ] Unit tests: unsigned adapter (no `init`) continues to work, signed adapter produces verifiable HMAC on each record, double-init throws.

**Contact Points**: `telemetry/TelemetryAdapter.ts`, `hooks/useGuardian.ts` (key delivery sequence), `core/HmacEnvelope.ts` (reused), new `telemetry/SignedTelemetryAdapter.ts`.

---

### Item 5 — InstallationSourceDetector

**Academic grounding**: applications distributed outside official app stores bypass store-side review, code signing enforcement, and update pipeline integrity checks. Sideloaded apps and apps from unofficial stores represent a meaningfully higher-risk distribution context. Detecting the installation source enables policy differentiation between store-distributed and sideloaded installs.

**User Story**

As a security engineer, I want guardian-rn to detect when an app is running from an unofficial installation source — including sideloaded APKs and third-party Android stores — and emit an `unofficialStore` threat event with appropriate confidence, so that I can apply a stricter response policy for apps that have bypassed official store review.

**Acceptance Criteria**

- [ ] Android: `InstallationSourceDetector` queries `PackageManager.getInstallSourceInfo()` (API 30+) or `PackageManager.getInstallerPackageName()` (API < 30). If the installer is not in the configured `allowedInstallerPackages` list (defaults include `com.android.vending`, `com.google.android.packageinstaller`), emits `unofficialStore` with `confidence: 0.85`, `severity: 'high'`.
- [ ] iOS: `InstallationSourceDetector` inspects the embedded provisioning profile for `ProvisionsAllDevices` (enterprise distribution) and the absence of a valid receipt (TestFlight vs. App Store). Emits `unofficialStore` with `confidence: 0.75` for enterprise-signed builds not whitelisted by the host app.
- [ ] `GuardianConfig` gains an optional `installationSource` field with `allowedInstallerPackages: string[]` (Android only) and `allowEnterpriseDistribution: boolean` (iOS, default `false`).
- [ ] The `unofficialStore` ThreatId is already in the schema and has a default policy of `restrict`. No schema codegen run required.
- [ ] Detection runs once at `engine.start()`, not on a polling interval. The result is cached and re-emitted only if the engine is restarted.
- [ ] Unit tests (mocked PackageManager / provisioning profile): official installer (no event), unofficial installer (event at correct confidence), TestFlight (no event if `allowEnterpriseDistribution: false`).

**Contact Points**: `packages/engine-community` (new detector class), `config/GuardianConfig.ts` (new `installationSource` field), Android native layer, iOS native layer.

---

### Item 6 — Session Expiry / Limited-Time Access

**Academic grounding**: indefinitely valid sessions are a session-hijacking amplifier. A compromised session token that was acquired days ago should not grant ongoing access. Bounded session lifetimes are a defense-in-depth control that limits the window of exploitation.

**User Story**

As a security engineer, I want to configure a maximum session age so that when the session exceeds `sessionMaxAgeMs`, guardian-rn automatically triggers the `onLockout` callback with a synthetic `sessionExpiry` event, forcing the app to re-authenticate — preventing stale or hijacked sessions from remaining valid indefinitely.

**Acceptance Criteria**

- [ ] `GuardianConfig` gains an optional `sessionMaxAgeMs: number` field. When set and the elapsed time since `useGuardian` mounted exceeds this value, a synthetic `ThreatEvent` is constructed with `threatId: 'sessionExpiry'`, `severity: 'high'`, `confidence: 1.0`, `engineId: 'guardian-internal'`.
- [ ] `sessionExpiry` is added to the `ThreatId` enum in `threat-schema.json`. A codegen run produces updated Kotlin and Swift artefacts.
- [ ] The synthetic event is routed through the PolicyEngine. Its default policy is `lockout`. The `onLockout` action callback is invoked with the event.
- [ ] Session expiry is implemented with a single `setTimeout` created in `useGuardian`. The timer is cleared on unmount (no leak).
- [ ] When `sessionMaxAgeMs` is absent, no timer is created. Existing behavior is entirely unaffected.
- [ ] Tests: no config (no expiry), config present (lockout fires after `sessionMaxAgeMs`), unmount before expiry (timer cleared, no lockout after unmount).

**Contact Points**: `config/GuardianConfig.ts`, `packages/schema/threat-schema.json` (new ThreatId), `hooks/useGuardian.ts` (expiry timer), `core/policy.ts` (default policy for `sessionExpiry`).

---

### Item 7 — Dynamic Behavioral Baseline Detector

**Academic grounding**: individual threat detections can be noisy. A single `debugger` event may be an artifact of a flaky detector. Ten `debugger` events within 30 seconds is a behavioral signature of active instrumentation. Frequency-based anomaly detection raises confidence on patterns that individual events cannot justify alone.

**User Story**

As a security engineer, I want the SDK to track a rolling 5-minute threat frequency histogram and automatically elevate the confidence of events whose frequency constitutes a statistically anomalous spike, so that coordinated bypass attempts that generate repeated detections are escalated to a higher policy tier without requiring manual threshold adjustments.

**Acceptance Criteria**

- [ ] A `BehavioralBaselineDetector` class maintains a per-`ThreatId` frequency histogram using 30-second buckets over a 10-bucket (5-minute) rolling window.
- [ ] When a new `ThreatEvent` arrives, if the current bucket's count exceeds `baselineConfig.spikeThreshold` times the mean of the previous 9 buckets (minimum 3 observations required), the event's confidence is boosted by `baselineConfig.confidenceBoost` (default: `0.15`, cap: `1.0`).
- [ ] The boosted event — not the original — is forwarded to the PolicyEngine.
- [ ] The detector is instantiated inside `useGuardian` and sits between the engine's `onThreat` observable and the PolicyEngine's `apply` call.
- [ ] `GuardianConfig` gains an optional `baselineConfig` field: `{ spikeThreshold: number, confidenceBoost: number }`.
- [ ] When `baselineConfig` is absent, no histogram is maintained and events pass through unmodified.
- [ ] Tests: stable frequency (no boost), spike detection (boost applied), insufficient history (no boost triggered), multiple ThreatId isolation (spike on one ID does not affect another).

**Contact Points**: new `core/BehavioralBaselineDetector.ts`, `hooks/useGuardian.ts` (instantiation), `config/GuardianConfig.ts` (`baselineConfig`).

---

### Item 8 — Offline-Resilient PolicyStore

**Academic grounding**: policies pushed from a MDAM server are more current than policies baked into an app binary. But network connectivity is not guaranteed. A RASP SDK that fails open (reverts to permissive defaults) when the policy server is unreachable creates an exploitable window that an adversary can trigger deliberately (e.g., forcing the device offline before launching an attack).

**User Story**

As a security engineer using a MDAM integration, I want server-pushed policies to be cached in the device's encrypted storage and loaded on startup, so that the last known good policy set is applied even when the MDAM server is unreachable — preventing a deliberate or incidental connectivity loss from degrading protection.

**Acceptance Criteria**

- [ ] A `PolicyStore` class is introduced that wraps `EncryptedStoragePort`. It serializes and deserializes `Partial<Record<ThreatId, ResponsePolicy>>` to/from a fixed storage key.
- [ ] `GuardianConfig` gains an optional `policyStore: PolicyStoreConfig` field with shape `{ storage: EncryptedStoragePort, remoteUrl?: string, syncIntervalMs?: number }`.
- [ ] On `useGuardian` mount: if `policyStore` is configured, `PolicyStore.load()` is called. If a cached policy is present, it overrides the in-memory `config.policies` before the first engine starts.
- [ ] When a remote URL is provided, `PolicyStore` fetches the policy document after a successful load. If the fetch succeeds, the response is validated against the `GuardianConfig.policies` schema and persisted via `EncryptedStoragePort.set`. If the fetch fails, the cached version continues to be used — no exception is thrown, a warning is logged.
- [ ] A `PolicyStore.invalidate()` method clears the cache (used in testing and forced refresh scenarios).
- [ ] When `policyStore` is absent from config, the entire subsystem is tree-shaken out. No behavior change for existing integrators.
- [ ] Tests: no cache (falls back to config.policies), stale cache loaded correctly, remote fetch succeeds (cache updated), remote fetch fails (stale cache retained, no throw), invalidate (cache cleared).

**Contact Points**: new `policy/PolicyStore.ts`, `storage/EncryptedStoragePort.ts` (existing interface consumed), `config/GuardianConfig.ts` (`PolicyStoreConfig`), `hooks/useGuardian.ts` (load sequence).

---

### Item 9 — Android Managed-Profile Awareness

**Academic grounding**: Android enterprise devices running managed profiles (work profiles) operate under corporate Device Policy Manager control. Detections that are expected (e.g., VPN enforced by MDM, debugger enabled for corporate tooling) should be distinguishable from the same signals in a personal profile context. Surface this in `EngineContext` so engine authors can adapt.

**User Story**

As a platform/MDM administrator deploying a corporate app through Android Enterprise, I want guardian-rn to detect whether it is running inside a managed work profile and surface that context in `EngineContext.managedProfile`, so that engine authors can suppress false positives that are intentional in managed environments — such as MDM-enforced VPN or debug tooling.

**Acceptance Criteria**

- [ ] `EngineContext` gains an optional `managedProfile?: boolean` field. On Android, it is populated from `DevicePolicyManager.isAdminActive()` and `DevicePolicyManager.isManagedProfile()` (API 21+) via a native call before `start()` is invoked. On iOS, it defaults to `undefined` (no equivalent API).
- [ ] The detection is executed once per session and the result is frozen into `EngineContext` before any engine's `start()` is called. Engine authors can read `ctx.managedProfile` and adjust their logic without polling.
- [ ] `GuardianRNModule.kt` gains a `getManagedProfileState(): Boolean` method that performs the `DevicePolicyManager` query. The result is passed to the JS layer as part of session initialization.
- [ ] The `CommunityEngine` uses `ctx.managedProfile` to downgrade `systemVPN` events to `telemetry`-only when `managedProfile === true`, since MDM-enforced VPN is expected in that context. This downgrade is the default behavior; it can be overridden via `config.policies`.
- [ ] Tests: non-managed device (field is `false`), managed work profile (field is `true`), iOS (field is `undefined`), engine author can read the field in `start()` context.

**Contact Points**: `engine/Engine.ts` (`EngineContext` interface), `packages/guardian-rn/android/` (GuardianRNModule.kt, new `getManagedProfileState`), `packages/engine-community` (CommunityEngine systemVPN logic), `hooks/useGuardian.ts` (context construction).

---

### Item 10 — Security Integration Tests

**Academic grounding**: unit tests validate individual components. Integration tests validate the interactions between the HMAC layer, the EventBus, the PolicyEngine, and the TelemetryAdapter under adversarial conditions. Without these, it is possible to have 100% unit test coverage and still have a policy bypass that only manifests when components compose.

**User Story**

As an OSS contributor or security auditor, I want guardian-rn to ship a security-specific integration test suite that validates attacker injection, policy bypass attempts, telemetry silencing, and session replay scenarios, so that I can verify the SDK's hardening claims independently and catch regressions introduced by future changes.

**Acceptance Criteria**

The integration test suite (`packages/guardian-rn/__tests__/security/`) must include the following four scenarios, all passing on the CI pipeline:

- [ ] **Attacker injection**: a fake engine emits a `ThreatEvent` that was not HMAC-signed with the session key. The EventBus must reject it and the PolicyEngine must never receive it. Asserted by: `PolicyEngine.apply` call count remains 0, `onFault` is called once with an `HmacVerificationError`.
- [ ] **Policy bypass**: an engine emits a kill-policy event at confidence `0.0` (below all thresholds). `onKill` must not be called. Emitting the same event at confidence `0.95` must call `onKill`. Asserted by: mock `onKill` call count.
- [ ] **Telemetry silence**: `TelemetryAdapter.recordThreat` is replaced with an implementation that throws. The PolicyEngine must continue to dispatch to `onRestrict`/`onLockout`/`onKill` correctly — telemetry failure must not propagate into the response pipeline. Asserted by: response callbacks fire despite telemetry throw.
- [ ] **Session replay**: `SequenceTracker` receives an envelope with a sequence number already seen. The EventBus must drop the event and call `onFault` with a `ReplayDetectedError`. Asserted by: downstream PolicyEngine receives 0 events from the replayed envelope.
- [ ] All four tests run in Node.js (no RN runtime dependency). All four must pass in CI without flakiness (re-run 3 times if any fail on first pass; if unstable, block merge).

**Contact Points**: new `packages/guardian-rn/__tests__/security/` directory, `core/eventbus.ts`, `core/policy.ts`, `core/HmacEnvelope.ts`, `core/SequenceTracker.ts`.

---

### Item 11 — Scan-Time Performance Benchmarks

**Academic grounding**: mobile SDK performance is observable by users and exploitable by adversaries (timing side-channels, denial of service via scan overload). CI-enforced benchmarks create a regression gate that prevents performance from silently degrading across releases.

**User Story**

As a mobile engineer integrating guardian-rn, I want the CI pipeline to enforce a p95 < 200 ms scan cycle time for the CommunityEngine, so that I have a contractual guarantee that the SDK will not silently degrade the app's UI responsiveness after any update.

**Acceptance Criteria**

- [ ] A benchmark test (`packages/engine-community/__tests__/perf/scan-cycle.bench.ts`) runs 500 iterations of the full `CommunityEngine` scan cycle on a warm instance (50 warm-up iterations discarded).
- [ ] The test fails if `p95 > 200 ms`. The p50 result is reported to stdout for reference but is not a blocking assertion.
- [ ] The benchmark is added to the CI matrix as a named job (`performance-gate`). It runs on every PR and merge to `main` on the primary CI runner (not a resource-constrained container).
- [ ] Benchmark results are reported as a PR comment by CI, showing the current p50/p95 and the delta from the previous merge.
- [ ] The EventBus processing path (HMAC verify + dedup + dispatch) is separately benchmarked with a target of p99 < 5 ms (matching the Phase 2 baseline established in v1.0.0). This is an informational metric; it does not block CI until v1.2.0.

**Contact Points**: new `packages/engine-community/__tests__/perf/`, CI workflow file, `packages/guardian-rn/src/core/` (EventBus path, separate micro-benchmark).

---

### Item 12 — JS Bundle Obfuscation + Optional Random ThreatIds

**Academic grounding**: threat ID constants in a JS bundle are static strings that an adversary can read with `strings` or a JS decompiler. Knowing which ThreatIds trigger which policies enables targeted bypass: an attacker who knows `hooks` triggers `kill` can craft an event with a different ThreatId to avoid the kill path while still poisoning detection state. Per-session random integer mapping defeats this by making the bundle-level constant non-deterministic across runs.

**User Story**

As a security engineer, I want ThreatId constants to be mapped to per-session random integers at runtime so that an attacker who has extracted the JS bundle cannot determine which threat signal maps to which policy tier — increasing the cost of a targeted policy bypass attack.

**Acceptance Criteria**

- [ ] A `ThreatIdObfuscator` class generates a random integer mapping on first instantiation per session (using `crypto.getRandomValues` or `Math.random` as fallback). The mapping is a bijection: every ThreatId maps to a unique random integer in [1, 2^31-1].
- [ ] The obfuscator is an opt-in feature enabled via `GuardianConfig.obfuscation: { enabled: boolean }`. Default: `false` (no behavior change for existing integrators).
- [ ] When enabled, the EventBus stores events internally using the obfuscated integer key. The `ThreatEvent.threatId` surface exposed to app code always returns the canonical string form — the obfuscation is internal to the bus.
- [ ] The mapping is regenerated on every `useGuardian` mount (per-session). It is never persisted.
- [ ] The obfuscation layer must not affect the HMAC verification path. HMAC envelopes continue to use the canonical string `threatId` in the JSON payload. Obfuscation is applied after verification, inside the bus.
- [ ] Tests: obfuscation off (canonical string passthrough), obfuscation on (internal storage uses integers, external event has canonical string), two sessions produce different integer mappings.

**Contact Points**: new `core/ThreatIdObfuscator.ts`, `core/eventbus.ts` (internal event storage), `config/GuardianConfig.ts` (`obfuscation` field).

---

### Item 13 — DeviceAuthDetector

**Academic grounding**: a device with no passcode or no biometric has a weaker authentication posture, making it easier for a physical adversary to access the device and the app's data. Surfacing this as a RASP signal allows apps to enforce authentication posture requirements as a condition of access.

**User Story**

As a security engineer building a financial services app, I want guardian-rn to detect when a device has no passcode configured or no biometric enrolled, and emit `passcodeMissing` and `biometricMissing` threat events respectively, so that I can apply a `restrict` or `lockout` policy for users who have not met the device authentication baseline my security policy requires.

**Acceptance Criteria**

- [ ] Android: `DeviceAuthDetector` calls `KeyguardManager.isDeviceSecure()` to check passcode/PIN/pattern. Calls `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)` for biometric enrollment status.
- [ ] iOS: `DeviceAuthDetector` calls `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)` for passcode, and `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` for biometric.
- [ ] `passcodeMissing` is emitted with `severity: 'high'`, `confidence: 1.0` when no device lock is configured.
- [ ] `biometricMissing` is emitted with `severity: 'medium'`, `confidence: 1.0` when biometric is not enrolled (passcode may still be present).
- [ ] Both `ThreatId` values are already in the schema (`passcodeMissing`, `biometricMissing`). Default policies are already set in `core/policy.ts` (`restrict` and `telemetry` respectively). No schema change required.
- [ ] Detection runs once at engine start, not on a polling interval.
- [ ] Tests (mocked platform APIs): no passcode (passcodeMissing emitted), passcode present + no biometric (biometricMissing emitted), passcode + biometric (no events), all combinations.

**Contact Points**: new `packages/engine-community/src/detectors/DeviceAuthDetector.ts`, Android `DeviceAuthDetector.kt`, iOS `DeviceAuthDetector.swift`, `packages/engine-community/src/CommunityEngine.ts` (detector registration).

---

## 5. Success Metrics

The following metrics define "working" for each v1.1.0 improvement. Measurement windows are post-GA unless otherwise noted.

### Per-Improvement Metrics

| # | Improvement | Primary Metric | Target | Window | Measurement Source |
|---|-------------|---------------|--------|--------|-------------------|
| 1 | OODA Adaptive Threshold | False positive rate change when spike detected | ≤ 5% increase in `restrict` events during threshold tightening | 30 days | TelemetryAdapter + MDAM dashboard |
| 2 | Fast-Path Critical Events | Time from kill-confidence event emission to `onKill` callback | p99 < 10 ms (vs. up to `dedupWindowMs` = 100 ms in v1.0.0) | CI benchmark (every build) | Benchmark test |
| 3 | Battery-Aware Throttling | Background scan invocation rate | ≥ 50% reduction in scan calls while app is backgrounded | 30 days | Engine health tick frequency in telemetry |
| 4 | Signed Telemetry | Fraction of telemetry records with valid HMAC at ingest | 100% of records from signed adapters pass collector HMAC check | 30 days | Collector ingest validation metric |
| 5 | InstallationSourceDetector | Detection accuracy on known-sideloaded test devices | ≥ 95% true positive in CI device farm test | Per CI run | Device farm test suite |
| 6 | Session Expiry | Session expiry lockout fires within ±500 ms of configured `sessionMaxAgeMs` | 100% of test runs within tolerance | CI | Timer precision test |
| 7 | Behavioral Baseline | Spike detection rate during simulated attack replay | ≥ 80% of 10-event replay sequences trigger confidence boost | CI + red-team exercise | Security integration test |
| 8 | Offline PolicyStore | Policy load success rate when network unavailable | 100% of sessions with prior cached policy start with that policy | 30 days | SDK log / telemetry `policySource` field |
| 9 | Managed-Profile Awareness | Correct `managedProfile` value on known enrolled test devices | 100% accuracy in CI device farm on enrolled Android device | Per CI run | Device farm assertion |
| 10 | Security Integration Tests | CI pass rate across 4 security scenarios | 100% green on every PR and merge to `main` | Every CI run | CI pipeline |
| 11 | Scan-Time Benchmarks | CommunityEngine p95 scan cycle | < 200 ms on CI runner | Every CI run | Benchmark CI job |
| 12 | ThreatId Obfuscation | No canonical string present in bundle for obfuscated ThreatIds | 0 matches when `strings` runs on obfuscated build | Per release audit | Release security scan |
| 13 | DeviceAuthDetector | Detection accuracy on no-passcode test device | 100% true positive; 0% false positive on secure device | CI device farm | Device farm assertion |

### SDK-Level Health Metrics (v1.1.0 Overall)

| Metric | Current (v1.0.0) | Target (v1.1.0 GA) |
|--------|-----------------|-------------------|
| Test suite coverage (lines) | ~83 tests, 11 suites | ≥ 120 tests, ≥ 16 suites |
| CI p95 EventBus path | < 0.05 ms (p99) | Maintained ≤ 0.05 ms |
| CommunityEngine scan p95 | Not yet benchmarked | < 200 ms |
| Security integration scenarios passing | 0 (not yet written) | 4/4 |
| Schema ThreatId count | 22 | 23 (sessionExpiry added) |
| Migration guide accuracy | freerasp-rn v6.x covered | v6.x + v1.1.0 delta documented |

---

## 6. Risk Assessment

### Item-Level Risks

| # | Improvement | Risk | Likelihood | Impact | Mitigation |
|---|-------------|------|-----------|--------|-----------|
| 1 | OODA Adaptive Thresholds | Adaptive tightening triggers false-positive lockout cascade on a device with a noisy detector | Medium | High | Enforce minimum threshold floor; add `onThresholdAdaptation` callback so app code can observe and override; gate behind explicit `adaptiveThresholdConfig` opt-in |
| 1 | OODA Adaptive Thresholds | Threshold decay logic creates oscillation if spike/decay cycles are shorter than `decayMs` | Low | Medium | Hysteresis: require frequency to fall below 50% of spike threshold before decay begins |
| 2 | Fast-Path | Fast-path bypass of dedup creates duplicate `onKill` calls if the same event fires twice at kill confidence within the dedup window | Low | Medium | Fast-path deduplication: the first kill-confidence event dispatches immediately; a duplicate within `dedupWindowMs` is still suppressed |
| 3 | Battery Throttling | `AppState` subscription inside `useGuardian` creates a memory leak if effect cleanup removes the engine subscription but not the AppState listener | Medium | Medium | Cleanup function in `useEffect` must explicitly remove the AppState listener; add leak detection test |
| 4 | Signed Telemetry | Session key passed to `TelemetryAdapter` is retained in JS memory longer than necessary | Low | Medium | Key passed as `Uint8Array`; adapter implementations should zero the buffer after use (documented in interface contract); SDK cannot enforce this |
| 5 | InstallationSource | On Android API < 30, `getInstallerPackageName()` can return null for preinstalled apps; false positives possible | Medium | Medium | Null result treated as "unknown," not "unofficial"; `evidence` field records `installerPackageName: 'unknown'`; confidence reduced to `0.6` |
| 6 | Session Expiry | `sessionMaxAgeMs` clock is device-clock-based; device clock can be spoofed (covered by `timeSpoofing` detector) | Medium | Medium | Document interaction: if `timeSpoofing` is detected before expiry, lockout fires from that detector. Clock-spoof cannot extend session because `Date.now()` at mount and expiry check are both affected equally — no differential |
| 7 | Behavioral Baseline | Rolling histogram uses memory; long-running sessions with high event volume could accumulate significant per-ThreatId data | Low | Low | Buckets are fixed at 10 × 30 s. Each bucket is a single integer counter per ThreatId (22 IDs × 10 buckets × 4 bytes = ~880 bytes max) |
| 8 | Offline PolicyStore | Cached policy from a previous version of the schema may contain unknown ThreatIds if the schema was updated between sessions | Low | Medium | `PolicyStore.load()` validates against current ThreatId enum; unknown keys are ignored with a warning; known keys are applied |
| 9 | Managed-Profile | `DevicePolicyManager` queries require appropriate permissions; missing permission returns false, not an error | Medium | Low | Fail-safe: if permission denied, `managedProfile` is `false` (conservative — no special treatment). Log warning. Document required permissions in SDK README |
| 10 | Security Tests | Tests that mock native JSI APIs may be fragile across RN versions | Medium | Low | Tests are written in pure Node.js; no RN runtime. JSI HostObject is mocked via interface injection. Tests have no RN dependency |
| 11 | Perf Benchmarks | CI runner resource variance can cause flaky p95 failures | Medium | Medium | Allow 10% tolerance above target (220 ms) on first run; report median of 3 benchmark runs; block only if 2/3 runs exceed threshold |
| 12 | ThreatId Obfuscation | Obfuscation adds per-session Map allocation; may surface in memory profilers but not functionally significant | Low | Low | Map is keyed by ThreatId (22 entries). Memory cost is negligible. Document in performance notes |
| 13 | DeviceAuthDetector | `LAContext.canEvaluatePolicy` on iOS may prompt the user for biometric permission in some OS versions | Medium | High | Call `canEvaluatePolicy` without triggering authentication (evaluation context, not authentication context). Test on iOS 15, 16, 17. Document expected behavior |

### Cross-Cutting Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| v1.1.0 schema additions (sessionExpiry) break existing codegen consumers | Low | Medium | Additive-only schema change. New ThreatId is added to the enum; existing code ignores unknown values at runtime. Documented as minor version change, not breaking |
| Battery-aware throttle + behavioral baseline together reduce detection coverage in background | Low | High | Baseline detector continues to process events even when throttle is in background mode — it receives the (reduced) event stream and does not itself throttle. Coverage is reduced; this is intentional and documented |
| OSS contributors copy security integration tests into exploit PoC | Low | Low | Tests use the real SDK interfaces, not internal bypass APIs. The knowledge they encode is that the SDK works as documented, which is the claim we want to make publicly |

---

## 7. Rollout Strategy

### Overview

v1.1.0 is a minor version release. All 13 improvements are additive to the existing API surface. No existing behavior is changed unless the integrator explicitly opts in via new configuration fields.

### Release Phases

| Phase | Audience | Gate | Target Date |
|-------|----------|------|------------|
| Alpha (tag: `1.1.0-alpha.1`) | Core engineering + invited design partners (≤ 5 apps) | No P0 bugs; CI green; all 4 security integration tests passing | T+0 (branch cut) |
| Beta (tag: `1.1.0-beta.1`) | OSS community opt-in via GitHub Discussions announcement | Error rate < 0.5% across partner telemetry; `p95 < 200 ms` CI assertion passing; no breaking type errors in compat layer | T+3 weeks |
| RC (tag: `1.1.0-rc.1`) | Any consumer willing to pin to RC | Zero known security regressions; changelog complete; migration notes published | T+5 weeks |
| GA (`1.1.0`) | All consumers via npm | 1 week RC soak with no P0/P1 issues reported | T+6 weeks |

### Feature Flags

The following v1.1.0 features are gated behind explicit opt-in configuration fields. None are enabled by default. This means upgrading from v1.0.0 to v1.1.0 with no config changes produces identical runtime behavior.

| Feature | Config Field | Default | Notes |
|---------|-------------|---------|-------|
| OODA Adaptive Thresholds | `GuardianConfig.adaptiveThresholdConfig` | `undefined` (disabled) | Opt-in |
| Fast-Path Critical Events | `BusConfig.fastPathEnabled` | `true` | Opt-out (safe default: faster response) |
| Battery-Aware Throttling | `GuardianConfig.scanThrottle` | `undefined` (engine default rate) | Opt-in |
| Signed Telemetry | `TelemetryAdapter.init()` | No-op if not implemented | Backwards compatible |
| InstallationSourceDetector | Included in CommunityEngine by default | Emits `unofficialStore` — already in default policies | No new config required |
| Session Expiry | `GuardianConfig.sessionMaxAgeMs` | `undefined` (no expiry) | Opt-in |
| Behavioral Baseline | `GuardianConfig.baselineConfig` | `undefined` (disabled) | Opt-in |
| Offline PolicyStore | `GuardianConfig.policyStore` | `undefined` (disabled) | Opt-in |
| Managed-Profile Awareness | `EngineContext.managedProfile` | Available automatically on Android | No config required; read in engine |
| Security Tests | CI job | Always runs | No flag |
| Perf Benchmarks | CI job `performance-gate` | Always runs | No flag |
| ThreatId Obfuscation | `GuardianConfig.obfuscation.enabled` | `false` | Opt-in |
| DeviceAuthDetector | Included in CommunityEngine by default | Emits `passcodeMissing` / `biometricMissing` — already in default policies | No new config required |

### MDAM Opt-In (Items 4, 8)

Signed outbound telemetry (item 4) and the offline PolicyStore (item 8) are designed with MDAM integration in mind. The SDK ships the client-side infrastructure. The server-side components (HMAC verification at ingest, policy document endpoint) are separate implementations. MDAM integrators who want to use these features during beta should:

1. Implement `TelemetryAdapter.init(sessionKey)` to sign records before transmission.
2. Update their collector to verify `sha256=` HMAC fields on ingest (reference: `packages/collector/src/index.ts`).
3. Optionally expose a policy endpoint at the URL passed to `PolicyStoreConfig.remoteUrl`.

A working reference implementation of steps 2 and 3 will be published to `packages/collector` before RC.

### Rollback Criteria

Since all v1.1.0 features are additive and opt-in, rollback in the traditional sense means disabling the new config fields and pinning to v1.0.0. The following conditions should trigger a rollback recommendation in the release notes:

- Any crash or unhandled rejection directly attributable to a v1.1.0 code path (P0).
- Fast-path (item 2) delivering duplicate `onKill` callbacks, causing double process termination (P0).
- DeviceAuthDetector (item 13) triggering biometric authentication prompt on iOS without user intent (P0 — privacy violation).
- Adaptive threshold (item 1) causing lockout cascade with > 10% increase in `onLockout` calls versus baseline over 48 hours in beta (P1).

---

## 8. Competitive Positioning

### Competitor Summary

| Dimension | guardian-rn | freerasp-react-native | Guardsquare DexGuard/iXGuard | Appdome | Arxan |
|-----------|-------------|----------------------|------------------------------|---------|-------|
| Open source | Yes (MIT) | Yes (Apache 2.0) | No | No | No |
| Pluggable engine | Yes (Engine interface) | No (vendor-only) | No | No | No |
| Confidence scoring | Yes (0.0–1.0, PolicyEngine) | No (binary callbacks) | Partial (severity tiers) | No | No |
| HMAC-signed events | Yes (per-session, JSI) | No | N/A (native-only) | N/A | N/A |
| Battery throttle | v1.1.0 | No | N/A | N/A | N/A |
| Adaptive thresholds | v1.1.0 | No | No (static rules) | No | No |
| Session expiry | v1.1.0 | No | N/A | Yes (session mgmt separate) | N/A |
| Offline policy cache | v1.1.0 | No | N/A | Yes | Yes |
| TurboModule / JSI | Yes (RN ≥ 0.74) | No (legacy bridge) | N/A | N/A | N/A |
| TypeScript-first | Yes (codegen from schema) | Partial | N/A | N/A | N/A |
| Migration from freerasp | Yes (fromTalsecConfig, fromFreeRaspListeners) | N/A | No | No | No |
| Managed-profile awareness | v1.1.0 | No | No | No | Unknown |
| Security integration tests | v1.1.0 | No | N/A | N/A | N/A |
| Pricing | Free (OSS) | Free (OSS) | Enterprise license | Enterprise SaaS | Enterprise license |

### Positioning Statement

**guardian-rn is the only open-source React Native RASP SDK that treats threat response as a programmable, evidence-based pipeline rather than a binary event bus** — giving security engineers the confidence scoring, adaptive policy, and architectural extensibility to tune their protection posture to their specific threat model, while giving mobile engineers the performance controls and observability they need to integrate without compromising user experience.

### v1.1.0 Competitive Differentiators

Three improvements in v1.1.0 create durable differentiation that commercial vendors have not addressed in the open-source space:

1. **Adaptive thresholds (item 1) + behavioral baseline (item 7)** — the combination of OODA feedback and frequency histogram analysis creates a self-calibrating defense posture. No open-source mobile SDK currently does this.
2. **Signed telemetry (item 4) + offline PolicyStore (item 8)** — treating the telemetry channel and the policy channel as attack surfaces to be hardened (not trusted communication paths) reflects a more mature threat model than any open-source alternative.
3. **Security integration tests (item 10)** — shipping adversarial tests as part of the SDK repository means that the SDK's hardening claims are falsifiable. This is a trust signal that no commercial vendor currently provides in verifiable form.

### Migration from freerasp-react-native

v1.0.0 shipped `fromTalsecConfig()` and `fromFreeRaspListeners()` in `packages/guardian-rn/src/compat/`. These adapters map the freerasp `TalsecConfig` and listener shape to `GuardianConfig` and `GuardianActions`. v1.1.0 does not change these adapters.

For teams migrating from freerasp-rn v6.x:

1. Replace `npm install freerasp-react-native` with `npm install @guardian/rn @guardian/engine-community`.
2. Replace `useFreeRasp(config)` with `useGuardian(fromTalsecConfig(config, [new CommunityEngine()]))`.
3. Optionally remove `fromTalsecConfig` wrapper and construct `GuardianConfig` directly to access confidence thresholds, kill policy, and v1.1.0 features.

Full migration guide: `docs/adopting-from-freerasp.md`.

---

## 9. Versioning and Backwards Compatibility

### Semantic Versioning Policy

guardian-rn follows [Semantic Versioning 2.0.0](https://semver.org).

| Change Type | Version Bump | Examples |
|-------------|-------------|----------|
| New required field in `GuardianConfig` | Major | Removing `tenantId`, making `engines` required with no default |
| Removal or rename of any exported type or function | Major | Renaming `ThreatEvent.confidence` to `score` |
| New optional field in `GuardianConfig` | Minor | `sessionMaxAgeMs`, `scanThrottle`, `baselineConfig` |
| New ThreatId in schema (additive) | Minor | `sessionExpiry` in v1.1.0 |
| New optional method on `Engine` interface | Minor | `throttle()` in v1.1.0 |
| New optional method on `TelemetryAdapter` | Minor | `init()` in v1.1.0 |
| Bug fix with no API change | Patch | Timer cleanup fix |
| New default policy for existing ThreatId | Minor | Changing `unofficialStore` default from `restrict` to `lockout` (with release note) |
| Security fix that changes observable behavior | Patch if scoped; Minor if API change required | HMAC timing fix, replay detection hardening |

### v1.1.0 Compatibility Guarantees

The following are guaranteed for the v1.0.0 → v1.1.0 upgrade:

- **No existing config fields are renamed, removed, or made required.**
- **No existing callback signatures change.** `onRestrict`, `onLockout`, `onKill` receive the same `ThreatEvent` shape.
- **No existing ThreatId is removed or renamed.** `sessionExpiry` is an additive schema entry.
- **Default behavior is unchanged** when v1.1.0 config additions (`adaptiveThresholdConfig`, `baselineConfig`, `sessionMaxAgeMs`, `policyStore`, `obfuscation`, `scanThrottle`) are absent.
- **Fast-path (item 2)** changes the timing of kill-confidence events but not their content or the callback signature. If this timing change is undesirable, `BusConfig.fastPathEnabled: false` restores v1.0.0 behavior exactly.
- **InstallationSourceDetector and DeviceAuthDetector** are added to `CommunityEngine` and emit ThreatIds that already exist in the schema with existing default policies. Apps that previously configured `unofficialStore: 'telemetry'` or `passcodeMissing: 'telemetry'` to suppress these signals will continue to suppress them.
- **`EngineContext.managedProfile`** is a new optional field. Code that destructures `EngineContext` without expecting this field will not break; unknown fields in TypeScript interfaces with `readonly` properties are ignored.

### Engine Interface Compatibility

The `Engine` interface gains one optional method in v1.1.0: `throttle?(mode: 'foreground' | 'background' | 'suspended'): void`. Because it is optional (`?`), all existing engine implementations that do not implement it remain valid. The `useGuardian` hook guards the call: `engine.throttle?.(mode)`.

This applies to all commercial or custom engine adapters built against v1.0.0. They do not need to be modified to work with v1.1.0.

### TelemetryAdapter Interface Compatibility

The `TelemetryAdapter` interface gains one optional method: `init?(sessionKey: Uint8Array): void`. Existing adapters that do not implement `init` continue to work without change. No telemetry signing occurs for those adapters. The `useGuardian` hook calls `telemetry.init?.(key)` — the `?` guard is required by the implementation contract.

### Schema Evolution

The JSON Schema at `packages/schema/threat-schema.json` is the single source of truth for all generated artefacts. The schema follows these evolution rules:

- **Additive changes** (new enum values, new optional object fields) are minor version changes.
- **Breaking changes** (removing enum values, narrowing types, adding required fields) are major version changes and require a deprecation notice one minor version in advance.
- Any schema change requires a `npm run codegen` run to regenerate TypeScript, Kotlin, and Swift artefacts. The pre-commit hook enforces that generated files are in sync.

For v1.1.0, the only schema change is adding `sessionExpiry` to the `ThreatId` enum. This is additive and does not affect existing generated code in Kotlin (`ThreatId.kt`) or Swift — the new sealed class entry (`SessionExpiry`) will be added, and existing `when` expressions with an `else` branch will handle it without modification.

---

## 10. Appendix

### A. Source Reference: Academic Foundation

The 13 v1.1.0 improvements are derived from: Kouadri Mostefaoui, G. & Tariq, M. (2019). *Mobile Apps Engineering Design, Development, Security, and Testing*. CRC Press. The specific chapters informing each improvement are:

| Item | Chapter Reference |
|------|------------------|
| 1, 7 | Chapter 9 — Dynamic Analysis and Runtime Monitoring; OODA loop application to mobile threat response |
| 2 | Chapter 9 — Event prioritization in real-time detection pipelines |
| 3 | Chapter 7 — Energy-aware mobile security: scan frequency vs. battery trade-offs |
| 4 | Chapter 10 — Telemetry integrity and signed reporting in MDAM architectures |
| 5 | Chapter 4 — Distribution channel integrity; APK provenance verification |
| 6 | Chapter 10 — Session security and bounded access windows |
| 8 | Chapter 10 — Offline resilience in enterprise mobile security policy delivery |
| 9 | Chapter 6 — Android Enterprise work profiles and managed device policy contexts |
| 10 | Chapter 8 — Adversarial testing: security integration tests for mobile SDKs |
| 11 | Chapter 7 — Performance budgeting and scan-time regression gating |
| 12 | Chapter 5 — Code obfuscation techniques and static analysis resistance |
| 13 | Chapter 3 — Device authentication posture as a RASP signal surface |

### B. ADR References

| ADR | Title | Relevance to v1.1.0 |
|-----|-------|---------------------|
| ADR-0001 | Architecture baseline (TurboModule, JSI, no legacy bridge) | All items inherit this constraint |
| ADR-0003 | HMAC-signed envelopes | Items 4, 12 (obfuscation applied after HMAC verify) |
| ADR-0004 | Engine interface contract | Items 3 (throttle), 9 (managedProfile in context) |
| ADR-0005 | PolicyEngine response tiers and kill opt-in | Items 1, 2, 6, 7 |

### C. Definition of Terms

| Term | Definition |
|------|-----------|
| ThreatEvent | The domain event emitted by an engine when a threat is detected. Contains `threatId`, `severity`, `confidence`, `evidence`, `ts`, `engineId`. |
| PolicyEngine | The JS-layer component that maps a ThreatEvent to a ResponsePolicy, checks confidence thresholds, and dispatches to action callbacks. |
| EventBus | The JS-layer component that receives signed envelopes from the native ThreatBus, verifies HMAC and sequence, applies dedup and rate-cap, and forwards to PolicyEngine. |
| EngineContext | The context object passed to every engine's `start()` method. Contains config, sessionId, platform, and (v1.1.0) managedProfile. |
| EncryptedStoragePort | The JS-layer interface abstracting platform encrypted storage (Android EncryptedSharedPreferences / iOS Keychain). |
| MDAM | Mobile Device and Application Management. Generic term for server-side policy management and threat intelligence distribution. |
| RASP | Runtime Application Self-Protection. A security model in which the application monitors and defends its own runtime environment. |
| TurboModule | React Native's new module system (RN ≥ 0.70), using codegen and JSI for synchronous native calls without the legacy bridge. |
| JSI | JavaScript Interface. The C++ layer that allows JS to hold direct references to native objects. Used in guardian-rn for one-time session key delivery via `GuardianHostObject`. |
| OODA | Observe, Orient, Decide, Act. A decision loop model used in item 1 to describe how the PolicyEngine adapts thresholds based on observed threat frequency. |

### D. Open Questions Before v1.1.0 RC

| Question | Owner | Deadline | Status |
|----------|-------|----------|--------|
| Does `LAContext.canEvaluatePolicy` on iOS 17 trigger a permission prompt without user interaction? | iOS platform engineer | Beta week 1 | Open |
| What is the correct `DevicePolicyManager` API path for detecting managed profiles on Android 14 + API 34 changes? | Android platform engineer | Alpha week 2 | Open |
| Should `sessionExpiry` default policy be `lockout` or `restrict`? Financial apps may prefer lockout; consumer apps may prefer restrict. | Security lead + PM | Beta week 1 | Open — leaning `lockout` pending stakeholder review |
| Should `SignedTelemetryAdapter` be in `@guardian/rn` core or a separate `@guardian/telemetry` package? | Engineering lead | Alpha week 2 | Open — preference for core to reduce install friction, but may increase bundle for apps not using telemetry |
| CI runner for benchmark job: shared GitHub Actions runner acceptable or does p95 variance require a dedicated runner? | DevOps / Engineering | Alpha week 1 | Open |

# Changelog

All notable changes to guardian-rn follow [Semantic Versioning](https://semver.org/).
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

## [1.0.0-alpha.1] — 2026-05-11

### Added

**Phase 1 — Monorepo skeleton**
- Workspace layout: `packages/guardian-rn`, `packages/schema`, `packages/codegen`, `packages/collector`
- Codegen pipeline: `packages/schema/threat-schema.json` → TS types, Kotlin sealed classes, Swift enums
- Pre-commit hook: guards generated artefacts against out-of-sync diffs
- 22 threat IDs, all domain types, `GuardianConfig`, `Engine` interface

**Phase 2 — JSI + HMAC envelope layer**
- `ThreatBus.kt` (Android): `MutableSharedFlow`, HMAC-signed envelope emission
- `ThreatBus.swift` (iOS): `AsyncStream`, `os_unfair_lock` sequence counter
- `GuardianHostObject.cpp/.h`: JSI `HostObject`; one-call-only session key via `compare_exchange_strong`
- `SessionKeyManager.kt`: AndroidKeyStore-backed HMAC key
- `CanonicalJson.ts`: RFC 8785 JCS implementation (20 RFC vector tests)
- `HmacEnvelope.ts`: `verifyEnvelope`, `computeHmac`, constant-time string comparison
- `SequenceTracker.ts`: replay, gap, rollover, wrong-session detection
- `EventBus.ts`: dedup window, per-engine rate cap, HMAC + sequence verification pipeline
- `packages/collector/src/index.ts`: Fastify v5 telemetry ingest (Elasticsearch)
- Performance baseline: p99 EventBus path < 0.05 ms (target: < 5 ms)

**Phase 3 — Community engine**
- `packages/engine-community`: pluggable `CommunityEngine`, `EngineRegistry`
- Android: `RootDetector`, `DebuggerDetector`, `EmulatorDetector`, `HookDetector`
- iOS: `JailbreakDetector`, `DebuggerDetector`, `SimulatorDetector`, `HookDetector`
- Confidence threshold (≥ 0.5) applied before bus emit

**Phase 4 — JS API**
- `core/store.ts`: `SubscriberStore` — isolated handler dispatch (crash-safe)
- `core/policy.ts`: `PolicyEngine` — default policies per threat, confidence thresholds, grace-period kill timer
- `hooks/useThreatHandler.ts`: per-threat subscription, latest-ref pattern
- `compat/useThreatActions.ts`: `fromFreeRaspListeners()` — freerasp-rn listener shape adapter

**Phase 5 — Platform polish**
- `storage/EncryptedStoragePort.ts`: platform-agnostic interface + `InMemoryEncryptedStorage`
- `EncryptedStorageManager.kt`: `EncryptedSharedPreferences` (AES-256-GCM, AndroidKeyStore)
- `KeychainStorageManager.swift`: Keychain-backed, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
- `SceneAwareScreenProtector.swift`: UIBlurEffect overlay on all `UIWindowScene`s
- `ScreenCaptureProtector.kt`: `FLAG_SECURE` + API 34 `registerScreenCaptureCallback`
- `hooks/useGuardian.ts`: PolicyEngine + health-tick telemetry wiring, kill-timer cleanup on unmount

**Phase 6 — Compat & migration**
- `compat/freerasp-rn.ts`: `fromTalsecConfig()` — maps `TalsecConfig` → `GuardianConfig`
- `isProd: false` downgrades critical threats to `telemetry` for CI/QA safety
- `docs/adopting-from-freerasp.md`: step-by-step migration guide

**Phase 7 — Hardening**
- `SECURITY.md`: private disclosure policy, PGP key, response SLA
- `docs/threat-model.md`: assets, threat actors, attack surface, trust boundary diagram
- `docs/engines.md`: detector inventory, Engine invariants, health monitoring spec
- `docs/policy-recipes.md`: 4 production-ready policy configurations
- Fuzz test scaffold: 5 000 × HMAC mutation, sequence, and canonicalJson random inputs

### Tests

83 tests / 11 suites — all green on Node 20, Apple M3.

---

## [0.0.0] — 2026-04-01 (pre-history)

Initial private repository scaffolding. Not released.

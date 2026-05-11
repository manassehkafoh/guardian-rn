# Engineering Onboarding Guide

**guardian-rn — Runtime Application Self-Protection SDK**
**Audience:** mid-level React Native engineer, new to security SDKs
**Last updated:** 2026-05-11

Welcome. This guide is meant to take you from "I can write React Native apps" to "I understand
exactly how every line in this SDK works, why it exists, and how to change it safely." Read it
once end-to-end before you open a pull request; come back to individual sections as reference.

The tone here is intentional: these concepts genuinely are unfamiliar if you have not worked on
a security library before, and there is no shame in that. The goal is to give you every
building block you need — not to assume you already have them.

---

## Table of Contents

1. [Mental Model — What Is RASP and Why Does It Exist?](#1-mental-model)
2. [Repository Walkthrough](#2-repository-walkthrough)
3. [Domain Concepts](#3-domain-concepts)
4. [Data Flows](#4-data-flows)
5. [TDD Workflow](#5-tdd-workflow)
6. [Adding a New Feature](#6-adding-a-new-feature)
7. [Native Code Bridge](#7-native-code-bridge)
8. [Common Pitfalls](#8-common-pitfalls)
9. [CI/CD Pipeline](#9-cicd-pipeline)
10. [Glossary](#10-glossary)

---

## 1. Mental Model

### What RASP is not

Before explaining what Runtime Application Self-Protection is, it helps to clear up what it is
not.

A **firewall** sits at the network boundary. It sees packets, not running code. If an attacker
roots a device and your app is happily communicating with the server over HTTPS, the firewall
cannot tell the difference between the legitimate app and the compromised one.

A **server-side integrity check** verifies that a response was not tampered with in transit —
but the server has no visibility into the environment in which the app is running. It cannot know
whether your banking app is running in a rooted Android with Frida attached, or on a real device
in the hands of a real customer.

**RASP is different.** It runs *inside* the application process, at runtime, and continuously
monitors the environment in which the application is executing. It answers questions like:

- Is this device rooted or jailbroken?
- Is a debugger attached to this process?
- Has this app binary been repackaged and re-signed with a different certificate?
- Is a hooking framework like Frida or Xposed installed?
- Is this app running on an emulator that might be a fraud detection bypass?

None of these questions can be answered from outside the process. RASP answers them from inside.

### Why it matters for mobile apps

Mobile apps handle sensitive data — authentication tokens, payment details, health records,
identity documents. The attack surface for a mobile app is qualitatively different from a web
app:

- The adversary holds the device. They can attach debuggers, modify the file system, and in the
  case of rooting/jailbreaking, modify the kernel itself.
- The app binary is shipped to millions of users. Any one of them can attempt to repackage it
  with malicious modifications and distribute it on unofficial stores.
- Mobile apps often cache credentials and session keys in local storage. Encrypted storage that
  relies on the OS's security guarantees is much weaker once the OS itself is compromised.

RASP is the layer that continuously observes these conditions and gives the app the information
it needs to decide how to react.

### What guardian-rn does specifically

guardian-rn is a React Native RASP SDK. It does not make security decisions for you — it
detects threats, assigns them a confidence score, and notifies your application. Your application
decides what to do: log the event, restrict functionality, lock the user out, or terminate.

The decision structure is captured in the concept of a **ResponsePolicy** (`telemetry`,
`restrict`, `lockout`, `kill`). The confidence score (a float between 0.0 and 1.0) lets the
PolicyEngine apply **thresholds** — a low-confidence root detection might just be logged, while
a high-confidence one locks the user out.

### The thing that makes guardian-rn different

Most React Native security SDKs are wrappers around a single detection library. guardian-rn is
built around a **pluggable Engine interface**: any detection library that implements the Engine
interface can be plugged in. The open-source `engine-community` package ships with the SDK; a
commercial engine can be swapped in without changing the application code.

The EventBus that wires engines to the PolicyEngine uses **HMAC-SHA256 signed envelopes** on
every event that crosses the native-to-JavaScript bridge. This is not paranoia — it is a defence
against a specific attack where a Frida script on a rooted device intercepts the JSI bridge and
injects synthetic "clean" events to suppress a root detection. When every event is signed with a
per-session key that only the native layer holds (backed by AndroidKeyStore or iOS Keychain),
that injection attack fails.

Keep those two ideas — pluggable engines, HMAC-signed bridge — in your head as you read the rest
of this guide. Everything else is detail.

---

## 2. Repository Walkthrough

### Monorepo layout

This is an npm workspaces monorepo. Running `npm install` at the root installs all packages.

```
guardian-rn/                          # workspace root
├── package.json                      # workspace config, shared scripts (codegen, test, lint)
├── tsconfig.base.json                # shared TypeScript compiler options, referenced by packages
├── .eslintrc.js                      # shared lint config
├── CHANGELOG.md                      # human-authored release notes
├── SECURITY.md                       # responsible disclosure policy
│
├── packages/
│   ├── schema/
│   │   └── threat-schema.json        # SINGLE SOURCE OF TRUTH — edit this to add threat IDs
│   │
│   ├── codegen/
│   │   └── src/
│   │       ├── index.ts              # reads threat-schema.json, writes TS + Kotlin + Swift
│   │       └── validate.ts           # JSON Schema validation of threat-schema.json
│   │
│   ├── guardian-rn/                  # main SDK package (published to npm)
│   │   ├── package.json
│   │   ├── GuardianRN.podspec        # CocoaPods spec for iOS
│   │   ├── react-native.config.js    # RN autolinking config
│   │   │
│   │   ├── src/
│   │   │   ├── index.ts              # public API barrel — what consumers import
│   │   │   │
│   │   │   ├── generated/            # DO NOT EDIT — output of `npm run codegen`
│   │   │   │   ├── ThreatId.ts       # TypeScript union type of all threat identifiers
│   │   │   │   ├── Severity.ts       # TypeScript union: low | medium | high | critical
│   │   │   │   ├── ResponsePolicy.ts # TypeScript union: telemetry | restrict | lockout | kill
│   │   │   │   └── index.ts          # barrel re-export
│   │   │   │
│   │   │   ├── engine/
│   │   │   │   └── Engine.ts         # Engine interface contract (ADR-0004)
│   │   │   │
│   │   │   ├── events/
│   │   │   │   └── ThreatEvent.ts    # ThreatEvent shape: threatId, severity, confidence, evidence, ts, engineId
│   │   │   │
│   │   │   ├── core/
│   │   │   │   ├── CanonicalJson.ts  # RFC 8785 JCS implementation — keys sorted, no whitespace
│   │   │   │   ├── HmacEnvelope.ts   # verifyEnvelope(), computeHmac() — the JS side of HMAC
│   │   │   │   ├── SequenceTracker.ts # replay / gap / rollover detection on envelope seq numbers
│   │   │   │   ├── ThreatPayload.ts  # the fields HMAC signs: threatId, severity, confidence, evidence, ts
│   │   │   │   ├── policy.ts         # PolicyEngine class + DEFAULT_POLICIES map + confidence thresholds
│   │   │   │   └── store.ts          # SubscriberStore — isolates handler failures from each other
│   │   │   │
│   │   │   ├── bus/
│   │   │   │   └── EventBus.ts       # merges all engine streams; HMAC verify, dedup, rate cap
│   │   │   │
│   │   │   ├── config/
│   │   │   │   └── GuardianConfig.ts # full config shape: engines, policies, thresholds, kill policy, telemetry
│   │   │   │
│   │   │   ├── hooks/
│   │   │   │   ├── useGuardian.ts    # primary React hook — starts engines, wires PolicyEngine, cleans up
│   │   │   │   └── useThreatHandler.ts # convenience hook for subscribing to a specific threat
│   │   │   │
│   │   │   ├── policy/
│   │   │   │   └── TerminatorPort.ts # port interface for process termination — injected for testability
│   │   │   │
│   │   │   ├── storage/
│   │   │   │   └── EncryptedStoragePort.ts # port interface + InMemoryEncryptedStorage for tests
│   │   │   │
│   │   │   ├── telemetry/
│   │   │   │   └── TelemetryAdapter.ts # port interface: recordThreat, recordHealthTick, flush
│   │   │   │
│   │   │   ├── types/
│   │   │   │   └── Observable.ts     # minimal Observable/Observer/Subscription types (no rxjs dependency)
│   │   │   │
│   │   │   └── compat/
│   │   │       ├── freerasp-rn.ts    # fromTalsecConfig() — migration adapter from freerasp-rn
│   │   │       └── useThreatActions.ts # maps freerasp-rn listener object to guardian-rn actions
│   │   │
│   │   ├── src/__tests__/
│   │   │   ├── CanonicalJson.test.ts  # RFC 8785 test vectors
│   │   │   ├── EventBus.test.ts       # dedup, rate cap, HMAC mismatch, replay
│   │   │   ├── HmacEnvelope.test.ts   # verifyEnvelope golden paths
│   │   │   ├── SequenceTracker.test.ts # replay, gap, rollover, wrong session
│   │   │   ├── policy.test.ts         # PolicyEngine — every policy/threshold combination
│   │   │   ├── storage.test.ts        # InMemoryEncryptedStorage CRUD
│   │   │   ├── store.test.ts          # SubscriberStore isolation
│   │   │   ├── compat.test.ts         # fromTalsecConfig() output shape
│   │   │   ├── freerasp-compat.test.ts # freerasp listener mapping
│   │   │   └── fuzz.test.ts           # 5 000 mutated envelopes, SequenceTracker, canonicalJson
│   │   │
│   │   ├── android/
│   │   │   ├── build.gradle
│   │   │   └── src/main/kotlin/com/guardian/rn/
│   │   │       ├── GuardianRNModule.kt      # TurboModule entry point
│   │   │       ├── GuardianRNPackage.kt     # RN package registration
│   │   │       ├── HmacSigner.kt            # HMAC-SHA256 sign/verify in Kotlin
│   │   │       ├── CanonicalJsonSerializer.kt # RFC 8785 JCS in Kotlin
│   │   │       ├── SessionKeyManager.kt     # AndroidKeyStore-backed session key, one-call-only
│   │   │       ├── EncryptedStorageManager.kt # EncryptedSharedPreferences (AES-256-GCM)
│   │   │       ├── ScreenCaptureProtector.kt  # FLAG_SECURE + API-34 capture callback
│   │   │       ├── ThreatBus.kt             # Kotlin SharedFlow-based native event bus
│   │   │       └── generated/               # DO NOT EDIT — codegen output (ThreatId.kt etc.)
│   │   │
│   │   └── ios/
│   │       ├── GuardianRN.mm            # Objective-C++ bridge, installs JSI HostObject
│   │       ├── GuardianHostObject.h     # JSI HostObject declaration (getSessionKey, subscribe, unsubscribe)
│   │       ├── GuardianHostObject.cpp   # JSI HostObject implementation
│   │       ├── Sources/GuardianRN/
│   │       │   ├── GuardianRNModule.swift      # TurboModule entry point
│   │       │   ├── HmacSigner.swift            # HMAC-SHA256 via CommonCrypto
│   │       │   ├── CanonicalJSONEncoder.swift  # RFC 8785 JCS in Swift
│   │       │   ├── SessionKeyManager.swift     # SecRandomCopyBytes key, NSLock-guarded one-call-only
│   │       │   ├── KeychainStorageManager.swift # Keychain CRUD with kSecAttrAccessibleAfterFirstUnlock
│   │       │   ├── SceneAwareScreenProtector.swift # blur overlay on willResignActive
│   │       │   └── ThreatBus.swift             # Combine Publisher-based native event bus
│   │       └── Generated/               # DO NOT EDIT — codegen output (ThreatId.swift etc.)
│   │
│   ├── engine-community/             # open-source detection engine (separate package)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts              # barrel export: CommunityEngine, EngineRegistry
│   │   │   ├── CommunityEngine.ts    # orchestrates detectors via Promise.allSettled
│   │   │   ├── EngineRegistry.ts     # manages multiple Engine instances, startAll/stopAll
│   │   │   └── detectors/
│   │   │       ├── Detector.ts       # Detector interface: threatId, severity, run()
│   │   │       ├── RootDetector.ts   # checks for root binaries + su paths
│   │   │       ├── JailbreakDetector.ts
│   │   │       ├── DebuggerDetector.ts
│   │   │       ├── EmulatorDetector.ts
│   │   │       ├── SimulatorDetector.ts
│   │   │       └── HookDetector.ts
│   │   ├── src/__tests__/
│   │   │   └── CommunityEngine.test.ts
│   │   ├── android/                  # Kotlin detector implementations (native checks)
│   │   └── ios/                      # Swift detector implementations (native checks)
│   │
│   ├── collector/                    # telemetry collector reference implementation
│   │   ├── src/index.ts             # Fastify server: /health, /ingest, /session (Phase 3 stubs)
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   └── logstash/                 # Logstash pipeline config for ECS normalization
│   │
│   └── schema/
│       └── threat-schema.json        # the one file you edit to add a new ThreatId
│
├── docs/                             # all documentation lives here
│   ├── 05-wiki/
│   │   └── adr/                     # Architecture Decision Records (read these!)
│   └── ...
│
└── .github/
    └── workflows/
        ├── ci.yml                    # PR and push validation pipeline
        └── release.yml               # tag-triggered publish pipeline
```

### The codegen pipeline

This is one of the most important things to understand. We have three languages (TypeScript,
Kotlin, Swift) that all need to agree on the same set of threat identifiers, severity levels,
and response policies. Keeping those in sync by hand would be error-prone, so we generate them.

The flow is:

```
packages/schema/threat-schema.json
         |
         | npm run codegen
         | (runs packages/codegen/src/index.ts)
         |
         +---> packages/guardian-rn/src/generated/ThreatId.ts
         |     packages/guardian-rn/src/generated/Severity.ts
         |     packages/guardian-rn/src/generated/ResponsePolicy.ts
         |
         +---> packages/guardian-rn/android/.../generated/ThreatId.kt
         |     packages/guardian-rn/android/.../generated/Severity.kt
         |     packages/guardian-rn/android/.../generated/ResponsePolicy.kt
         |
         +---> packages/guardian-rn/ios/Generated/ThreatId.swift
               packages/guardian-rn/ios/Generated/Severity.swift
               packages/guardian-rn/ios/Generated/ResponsePolicy.swift
```

When you add a new ThreatId (say `installationSource`) to `threat-schema.json` and run
`npm run codegen`, you get:

**TypeScript output:**
```typescript
// AUTO-GENERATED by packages/codegen — do not edit by hand
export type ThreatId =
  | 'root'
  | ...
  | 'installationSource';
```

**Kotlin output:**
```kotlin
// AUTO-GENERATED by packages/codegen — do not edit by hand
sealed class ThreatId {
    data object Root : ThreatId()
    ...
    data object InstallationSource : ThreatId()
}
```

**Swift output:**
```swift
// AUTO-GENERATED by packages/codegen — do not edit by hand
public enum ThreatId: String, CaseIterable, Codable {
    case root
    ...
    case installationSource
}
```

All three artefacts are committed. A pre-commit hook and a CI job both verify that the committed
artefacts match what codegen would produce from the current schema — so you cannot accidentally
commit stale generated code.

**Rule:** Never edit files in any `generated/` or `Generated/` directory by hand. Always edit
`threat-schema.json` and run codegen.

---

## 3. Domain Concepts

Each concept below is explained as if you are encountering it for the first time. The "Why does
this exist?" sections explain the design motivation, which is important background for making
good decisions when you need to change something.

### Engine

**What it is:** An `Engine` is anything that can detect threats. It exposes four things: a stable
string `id`, a `start(context)` method, a `stop()` method, and two Observable streams —
`onThreat` and `onHealthTick`.

```typescript
interface Engine {
  readonly id: string;
  start(context: EngineContext): Promise<void>;
  stop(): Promise<void>;
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;
}
```

**Why does this exist?** The Engine interface is a deliberate abstraction boundary. Historically,
React Native RASP SDKs were monolithic — one library, one detection strategy, no extensibility.
The commercial detection market (DexProtect, Guardsquare, etc.) needs a way to plug in without
the app developer rewriting their integration. This interface is that plug point.

**What you need to know:**
- `start()` must resolve *before* any event is emitted. An engine that emits before `start()`
  resolves has violated the contract and its events will be silently dropped by the EventBus.
- `stop()` must be idempotent — calling it twice must not throw.
- `onHealthTick` must emit at least once per 60,000 ms while the engine is running. Absence of
  a health tick triggers an observability alert.
- If `start()` throws, the engine transitions to FAULTED. Other engines continue running.

### Detector

**What it is:** A Detector is the atomic unit of detection inside the `CommunityEngine`. Each
Detector checks for one specific threat and returns a result.

```typescript
interface Detector {
  readonly threatId: ThreatId;
  readonly severity: Severity;
  run(): Promise<DetectorResult>;
}

interface DetectorResult {
  readonly detected: boolean;
  readonly confidence: number; // 0.0 to 1.0
  readonly evidence: Readonly<Record<string, string>>;
}
```

**Why does this exist?** Separating each check into its own class makes testing straightforward.
You can test `RootDetector` in complete isolation without spinning up the full engine. It also
makes it easy to add or remove individual checks without modifying `CommunityEngine` itself —
you just pass a different array of detectors to the constructor.

**What you need to know:**
- `confidence` is the probability that the detector is correct. 0.0 means "certainly not
  detected", 1.0 means "absolute certainty". Most real detectors operate in the 0.7–0.95 range.
- `evidence` is an arbitrary string-to-string map. Include enough information for a security
  analyst to understand what triggered the detection. Bad: `{ method: 'path' }`. Good:
  `{ method: 'path', path: '/system/xbin/su', foundAt: 'step3' }`.
- Never make a network call inside `run()`. Detectors must be synchronous in their observations
  (file system, environment variables, native APIs). Async is fine for scheduling but not for
  external I/O.

### PolicyEngine

**What it is:** The PolicyEngine receives a ThreatEvent, looks up the configured ResponsePolicy
for that threat, checks whether the event's confidence score meets the threshold for that policy,
and then calls the appropriate action callback.

```typescript
class PolicyEngine {
  apply(event: ThreatEvent): void { ... }
  cancelPendingKills(): void { ... }
}
```

The four policies, in escalating severity:

| Policy | What it means |
|--------|---------------|
| `telemetry` | Record the event, do nothing else. Default for benign signals like emulator or simulator. |
| `restrict` | Call `onRestrict`. The app should hide sensitive features, enforce step-up auth. |
| `lockout` | Call `onLockout`. The app should show a locked screen and prevent interaction. |
| `kill` | Call `onKill`, then (after a grace period) terminate the process via `TerminatorPort`. |

**Why does this exist?** Policy decisions live here, not in individual detectors. A detector
produces a signal; the PolicyEngine translates that signal into a business action. This
separation matters because different customers have different risk tolerances. One bank may want
`root` → `lockout`; a developer tools app may want `root` → `telemetry`. The detector is the
same; the policy is per-configuration.

**The confidence threshold design:** Rather than having a binary detected/not-detected, the
confidence float allows the PolicyEngine to apply graduated responses. The defaults are:

- `restrict` fires at confidence ≥ 0.5
- `lockout` fires at confidence ≥ 0.7
- `kill` fires at confidence ≥ 0.9

This means a low-confidence root signal (e.g., 0.6) triggers only a restriction, not a full
lockout. A high-confidence signal (0.9+) triggers lockout. These thresholds are configurable.

**Kill timer deduplication:** When the `kill` policy fires, a timer is set via `setTimeout`. If
the same `threatId` fires again before the timer expires, a second timer is *not* started —
`this.killTimers.has(event.threatId)` prevents it. This avoids the app being "killed twice" and
prevents potential timer leaks.

### EventBus

**What it is:** The EventBus is the wiring layer between engines and the rest of the SDK. It
subscribes to every engine's `onThreat` and `onHealthTick` streams, applies three safety
mechanisms — HMAC verification, deduplication, and rate capping — and then dispatches to
registered handlers.

**Why does this exist?** Without a bus, each consumer (the PolicyEngine, the telemetry adapter)
would have to subscribe directly to each engine, manage their own dedup and rate limiting, and
re-implement HMAC verification. The EventBus centralises all of that. It also provides the
`processEnvelope` method for the native JSI path, where events arrive as HMAC-signed JSON rather
than as native TypeScript objects.

**The three safety mechanisms:**

1. **HMAC verification** (`processEnvelope` path only): every envelope arriving from the native
   bridge is verified before its payload is unpacked. A mismatch routes to `onFault`, not
   `onThreat`.

2. **Deduplication window (100 ms):** if the same `threatId` is seen more than once within 100
   ms, only the first event is forwarded. This handles the case where a polling engine emits
   `root` on every 30-second interval scan — without dedup, stopping the poll then restarting
   would flood subscribers.

3. **Per-engine rate cap (50 events/second):** a single misbehaving engine cannot flood the JS
   bridge. Events beyond the cap are counted (`bus.dropped`) and dropped.

### TelemetryAdapter

**What it is:** A port interface for shipping events to an external observability system. Three
methods: `recordThreat(event)`, `recordHealthTick(tick)`, `flush()`.

```typescript
interface TelemetryAdapter {
  recordThreat(event: ThreatEvent): void;
  recordHealthTick(tick: EngineHealthTick): void;
  flush(): Promise<void>;
}
```

**Why does this exist?** Telemetry is a cross-cutting concern that different customers implement
differently — some use the reference `collector` package, others send to Datadog, others to a
home-grown SIEM. By defining a port interface, the SDK is agnostic about the destination. The
`PolicyEngine` calls `telemetry?.recordThreat(event)` on every single event, even ones with
`telemetry` policy, so the adapter always gets a complete picture regardless of whether any
action was taken.

**What you need to know:** `flush()` is called during graceful shutdown. Do not make it throw;
make it resolve even if the flush partially fails.

### EncryptedStoragePort

**What it is:** A port interface for encrypted key-value storage. Four methods: `set`, `get`,
`remove`, `clear`.

```typescript
interface EncryptedStoragePort {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

Implementations:
- **Android:** `EncryptedStorageManager` → `EncryptedSharedPreferences` (AES-256-GCM,
  backed by AndroidKeyStore, `MasterKey.KeyScheme.AES256_GCM`)
- **iOS:** `KeychainStorageManager` → iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`)
- **Tests:** `InMemoryEncryptedStorage` (in-process Map, no persistence)

**Why does this exist?** Policy caching (the `PolicyStore`) needs to persist between app
restarts. The data it stores — offline policy configurations — must not be readable by another
app or accessible via iCloud backup. `EncryptedSharedPreferences` and the Keychain both provide
hardware-backed AES encryption that satisfies this requirement. By hiding both behind a port,
the JS layer never deals with platform-specific encrypted storage APIs.

**Why `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` on iOS?** The `ThisDeviceOnly` suffix
prevents the Keychain item from migrating in an iCloud backup to another device. The
`AfterFirstUnlock` portion means the item is accessible after the device is unlocked for the
first time after a reboot — which is correct for a background service that monitors the app even
when it is not in the foreground.

### SessionKeyProvider

**What it is:** The native component responsible for generating, holding, and delivering the
per-session HMAC key. It is implemented as `SessionKeyManager` in both Kotlin and Swift.

**Why does this exist?** The HMAC session key is the root of trust for the entire event signing
scheme. If an attacker can extract the key, they can forge events. The key is therefore generated
using platform cryptographic facilities (`AndroidKeyStore` / `SecRandomCopyBytes`), held in
native memory (never exposed to the JS heap), and delivered to JS exactly **once** per session
via the JSI HostObject's `getSessionKey()` method.

The one-call restriction (`AtomicBoolean.compareAndSet(false, true)` on Android,
`NSLock`-guarded flag on iOS) means that even if an attacker calls `getSessionKey()` from a
Frida script after the legitimate call has completed, they receive an error. The key was already
delivered, zeroed in native memory, and is now only present in the `Uint8Array` the JS runtime
holds. Getting the key at that point requires access to the JS heap, which is harder than calling
a public method.

---

## 4. Data Flows

### 4a: A root detection from detector to `onLockout` callback

Walk through what happens when `RootDetector.run()` returns a positive result with confidence
0.95.

**Step 1 — Detector runs.**

`CommunityEngine.runScan()` calls `Promise.allSettled` on every detector:

```typescript
const results = await Promise.allSettled(
  this.detectors.map((d) => d.run().then((r) => ({ d, r })))
);
```

`RootDetector.run()` returns:

```typescript
{ detected: true, confidence: 0.95, evidence: { method: 'path', path: '/system/xbin/su' } }
```

**Step 2 — Confidence gate.**

Still inside `runScan()`, the CommunityEngine checks `r.detected && r.confidence >= 0.5`. Both
conditions are true. It calls:

```typescript
this.threatSubject.emit({
  threatId: 'root',
  severity: 'high',
  confidence: 0.95,
  evidence: { method: 'path', path: '/system/xbin/su' },
  ts: Date.now(),
  engineId: 'community@1.0.0',
});
```

**Step 3 — EventBus receives the event.**

`useGuardian` subscribed to `engine.onThreat` when it started the engine. The subscription's
`next` callback is `(event) => policyEngine.apply(event)`. This is called with the ThreatEvent.

If this event came via the JSI native bridge instead (the `processEnvelope` path), the EventBus
would first call `verifyEnvelope`, then check the SequenceTracker, then apply dedup and rate
cap, and only then call handlers. In the TypeScript-only community engine path, it goes directly
to dedup and rate cap.

**Step 4 — Dedup check.**

The EventBus calls `isDuplicate('root')`. If `root` was not seen in the last 100 ms, this
returns false. The event is forwarded.

**Step 5 — Rate cap check.**

The EventBus calls `isRateCapped('community@1.0.0')`. If this engine has sent fewer than 50
events in the last second, this returns false. The event is forwarded.

**Step 6 — PolicyEngine.apply().**

```typescript
apply(event: ThreatEvent): void {
  const policy = this.resolvePolicy(event.threatId); // → 'lockout' (from DEFAULT_POLICIES)
  const thresholds = { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...this.config.confidenceThresholds };

  this.config.telemetry?.recordThreat(event); // telemetry adapter always gets the event

  // policy is 'lockout', confidence is 0.95, threshold is 0.7
  if (policy === 'lockout' && event.confidence >= thresholds.lockout) {
    this.config.actions.onLockout?.(event); // the app's callback is called here
    return;
  }
}
```

**Step 7 — The app's `onLockout` callback runs.**

Whatever the app developer put in `onLockout` — typically navigation to a locked screen — runs
here. The entire path from detector to callback is synchronous in the JS layer once the initial
`Promise.allSettled` resolves.

### 4b: Session key handshake

This describes the one-time delivery of the HMAC session key from native to JS.

**Step 1 — App calls `useGuardian(config)`.**

The `useGuardian` hook runs `startAll()` in a `useEffect`. `startAll()` calls `engine.start(ctx)`
for each engine.

**Step 2 — Native `start()` runs.**

When a native TurboModule engine calls its `start()` (Android: `GuardianRNModule.start()`,
iOS: `GuardianRNModule.start()`), it:
1. Creates a `SessionKeyManager` and generates the session key via `AndroidKeyStore` or
   `SecRandomCopyBytes`.
2. Assigns a UUID as the `sessionId`.
3. Creates the `ThreatBus` with the session key.
4. Installs the JSI `GuardianHostObject` into the JS runtime.

**Step 3 — JS calls `NativeGuardianRN.getSessionKey()`.**

Inside the JSI HostObject, `getSessionKeyImpl()` is called. It:
1. Checks `keyDelivered_` (an `std::atomic<bool>`). If already true, throws
   `GUARDIAN_KEY_ALREADY_DELIVERED`.
2. Sets `keyDelivered_` to true.
3. Returns the key as a JS `ArrayBuffer` (32 bytes).
4. Zeroes the native-side key buffer.

**Step 4 — The `Uint8Array` arrives in JS.**

The JS layer wraps it and passes it to the `EventBus` constructor. From this point forward, every
envelope arriving from native is verified against this key.

**The one-call guarantee in practice:** If a Frida script calls `getSessionKey()` after the
legitimate handshake, it receives `GUARDIAN_KEY_ALREADY_DELIVERED`. The key is not re-extractable
without reading the JS heap, which requires a different class of attack.

### 4c: HMAC verification failure — the dropped event path

This describes what happens when a tampered envelope arrives on the bridge.

**Scenario:** An attacker's Frida script intercepts a `ThreatEnvelope` on the JSI bridge after a
root detection and changes `payload.confidence` from 0.95 to 0.1, hoping to avoid a lockout.

**Step 1 — The attacker changes `payload.confidence`.**

The envelope now looks like:

```json
{
  "seq": 42,
  "sessionId": "abc-...",
  "ts": 1715350800000,
  "hmac": "sha256=<original HMAC computed over confidence=0.95>",
  "payload": {
    "threatId": "root",
    "severity": "high",
    "confidence": 0.1,
    "evidence": { "method": "path" },
    "ts": 1715350800000
  }
}
```

The `hmac` field was not changed. It still contains the HMAC of the canonical JSON of the
**original** payload (confidence = 0.95).

**Step 2 — `EventBus.processEnvelope()` is called.**

```typescript
processEnvelope(envelope: GuardianEnvelope, engineId: string): void {
  const result = verifyEnvelope(envelope, this.sessionKey);
  if (!result.ok) {
    this.routeFault(engineId, new Error(`HMAC_MISMATCH — seq ${envelope.seq}`));
    return;
  }
  // ...
}
```

**Step 3 — `verifyEnvelope()` recomputes the HMAC.**

```typescript
const canonical = canonicalJson(envelope.payload);
// canonical = '{"confidence":0.1,"evidence":{"method":"path"},"severity":"high","threatId":"root","ts":1715350800000}'
// (keys sorted alphabetically by RFC 8785)
const expected = computeHmac(canonical, key);
// expected = sha256=<HMAC of confidence=0.1 payload>
// envelope.hmac = sha256=<HMAC of original confidence=0.95 payload>
// These differ. constantTimeEqual returns false.
return { ok: false, reason: 'HMAC_MISMATCH' };
```

**Step 4 — The fault path fires.**

`routeFault` is called with `engineId` and `Error('HMAC_MISMATCH — seq 42')`. Fault handlers
(typically the telemetry adapter) are notified. The event is dropped. `policyEngine.apply()` is
never called. The lockout that should have fired does not fire — but the `HMAC_MISMATCH` event
is itself logged, so the analyst sees both the attempted suppression and the lack of lockout.

**The key insight:** The HMAC covers only the `payload` object (the fields that matter for policy
decisions). The attacker cannot change `confidence` without invalidating the HMAC, and cannot
regenerate a valid HMAC without the session key.

---

## 5. TDD Workflow

### Getting your environment ready

```bash
# from the workspace root
node --version          # must be >= 20
npm --version           # must be >= 10
npm install             # installs all packages
npm run codegen         # generates TS/Kotlin/Swift artefacts (required before first test run)
npm test                # runs the full test suite
```

You should see output like:

```
PASS packages/guardian-rn/src/__tests__/policy.test.ts
PASS packages/guardian-rn/src/__tests__/EventBus.test.ts
PASS packages/guardian-rn/src/__tests__/fuzz.test.ts
...
Test Suites: 9 passed, 9 total
```

### Running specific tests

```bash
# run a single test file
npx jest packages/guardian-rn/src/__tests__/policy.test.ts

# run tests matching a description string
npx jest --testNamePattern="kill timer"

# run with coverage
npx jest --coverage

# run the extended fuzz (100 000 iterations — used in CI on main)
FUZZ_ITERATIONS=100000 npx jest --testPathPattern=fuzz
```

### Type-checking and lint

```bash
npm run typecheck    # tsc --noEmit over all packages
npm run lint         # eslint over all .ts / .tsx files
```

### The test pyramid

guardian-rn tests are organized into four levels:

**Unit tests** — the bulk of the suite. These test a single class or function in isolation,
with all dependencies mocked. Examples: `policy.test.ts`, `storage.test.ts`,
`CanonicalJson.test.ts`. Run on every commit. Fast (< 5 seconds total). If a unit test fails,
you know exactly which component is broken.

**Integration tests** — test two or more components working together, with only the native layer
mocked. Example: `CommunityEngine.test.ts` tests the engine and its detectors together; the
native bridge is never called. These are slightly slower but still run on every commit.

**Fuzz tests** — `fuzz.test.ts` runs 5,000 random mutation iterations (100,000 on `main`) on
three subsystems: `verifyEnvelope`, `SequenceTracker`, and `canonicalJson`. The goal is to prove
that no combination of malformed input causes an unhandled exception or a false-pass
verification. These are security-critical tests.

**Performance tests** — in `docs/perf/phase2-latency-baseline.md`. Not automated yet; run
manually before performance-sensitive changes.

### Writing a new detector test: red → green → refactor

Let us say you are adding `InstallationSourceDetector`, which should return `detected: true` with
high confidence if the app was installed from an unofficial source. Here is the full TDD cycle.

**Red — write a failing test first.**

Create `packages/engine-community/src/__tests__/InstallationSourceDetector.test.ts`:

```typescript
import { InstallationSourceDetector } from '../detectors/InstallationSourceDetector.js';

describe('InstallationSourceDetector', () => {
  afterEach(() => {
    delete process.env['GUARDIAN_SIMULATE_UNOFFICIAL_STORE'];
  });

  test('returns detected: false when not simulated', async () => {
    const detector = new InstallationSourceDetector();
    const result = await detector.run();
    expect(result.detected).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  test('returns detected: true with high confidence when simulated', async () => {
    process.env['GUARDIAN_SIMULATE_UNOFFICIAL_STORE'] = '1';
    const detector = new InstallationSourceDetector();
    const result = await detector.run();
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.evidence['source']).toBeDefined();
  });

  test('threatId is unofficialStore', () => {
    const detector = new InstallationSourceDetector();
    expect(detector.threatId).toBe('unofficialStore');
  });

  test('severity is high', () => {
    const detector = new InstallationSourceDetector();
    expect(detector.severity).toBe('high');
  });
});
```

Run `npm test` — the tests fail with `Cannot find module '../detectors/InstallationSourceDetector.js'`.
That is correct. We have a failing test.

**Green — write the minimum implementation.**

Create `packages/engine-community/src/detectors/InstallationSourceDetector.ts`:

```typescript
import type { Detector, DetectorResult } from './Detector.js';

export class InstallationSourceDetector implements Detector {
  readonly threatId = 'unofficialStore' as const;
  readonly severity = 'high' as const;

  async run(): Promise<DetectorResult> {
    const simulate = process.env['GUARDIAN_SIMULATE_UNOFFICIAL_STORE'] === '1';
    if (!simulate) {
      return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.9,
      evidence: {
        method: 'simulated',
        source: 'unknown',
      },
    };
  }
}
```

Run `npm test` — the tests pass.

**Refactor — improve without breaking.**

The real implementation will call a native method via TurboModule to check the installation
source on Android (`PackageManager.getInstallerPackageName()`) and on iOS
(`LSApplicationQueriesSchemes` or `MobileProvision` parsing). Add those checks inside the
`run()` method, making sure your tests still pass after each change.

After refactoring, look at the implementation again: Is there duplicated logic? Are the evidence
keys consistent with other detectors? Is the confidence score calibrated against the other
detectors? Address those before opening a PR.

---

## 6. Adding a New Feature

This section walks through adding a completely new detector — `installationSource` — from schema
change to merged PR. Follow these steps in order.

### Step 1: Update the JSON schema

Edit `packages/schema/threat-schema.json`. Find the `ThreatId` enum and add your new value:

```json
"ThreatId": {
  "type": "string",
  "enum": [
    "root",
    "jailbreak",
    ...
    "hardwareBackedKeysMissing",
    "engineFault",
    "installationSource"
  ]
}
```

Also check whether you need a new `Severity` value or `ResponsePolicy` value. In most cases you
will not — `installationSource` uses the existing `high` severity and `unofficialStore` is
already there (actually, check: is this the same thing? In this example we are adding a new
concept, so we add a new ThreatId).

### Step 2: Run codegen

```bash
npm run codegen
```

Check the output:

```
[codegen] ✓ packages/guardian-rn/src/generated/ThreatId.ts
[codegen] ✓ packages/guardian-rn/android/.../generated/ThreatId.kt
[codegen] ✓ packages/guardian-rn/ios/Generated/ThreatId.swift
[codegen] done
```

Open `packages/guardian-rn/src/generated/ThreatId.ts` and confirm `installationSource` appears
in the union type. Do the same for the Kotlin and Swift files.

Commit the schema change and the generated artefacts together. The pre-commit hook runs codegen
and checks for drift — if you forgot to run it, the hook will run it for you and abort the commit
with a diff so you can review before re-committing.

### Step 3: Write a failing test

Follow the red → green → refactor example in Section 5. Write the test before writing any
implementation. Name the test file after the class it tests.

### Step 4: Implement the detector

Create `packages/engine-community/src/detectors/InstallationSourceDetector.ts` following the
Detector interface. The stub (simulation via env var) is enough to make the tests pass. The real
native implementation comes in later steps.

For the native checks:
- **Android:** use `PackageManager.getInstallerPackageName()` (API 11+) or
  `PackageInstaller.SessionInfo.getInstallerPackageName()` (API 29+). The list of approved
  installer package names for production (e.g. `com.android.vending`) is configurable.
- **iOS:** check `AppStoreReceiptURL` and the provisioning profile's certificates. A missing
  receipt combined with an ad-hoc distribution profile signals unofficial distribution.

### Step 5: Add to CommunityEngine

Edit `packages/engine-community/src/CommunityEngine.ts`. Import your new detector and add it to
the default detector array in the constructor:

```typescript
// Before:
this.detectors = detectors ?? [
  new RootDetector(),
  new JailbreakDetector(),
  new DebuggerDetector(),
  new EmulatorDetector(),
  new SimulatorDetector(),
  new HookDetector(),
];

// After:
import { InstallationSourceDetector } from './detectors/InstallationSourceDetector.js';

this.detectors = detectors ?? [
  new RootDetector(),
  new JailbreakDetector(),
  new DebuggerDetector(),
  new EmulatorDetector(),
  new SimulatorDetector(),
  new HookDetector(),
  new InstallationSourceDetector(),
];
```

Run `npm test` — everything should still pass, including the engine tests that verify the
`activeChecks` list in the health tick.

### Step 6: Add a DEFAULT_POLICY entry

Edit `packages/guardian-rn/src/core/policy.ts`. Add an entry for your new ThreatId:

```typescript
export const DEFAULT_POLICIES: Partial<Record<ThreatId, ResponsePolicy>> = {
  root: 'lockout',
  ...
  installationSource: 'restrict', // new
};
```

Think carefully about the default policy. Ask yourself: what is the expected behavior for an
application developer who has not explicitly configured this threat? `telemetry` means "log but
do nothing" — appropriate for environmental signals that might not indicate malicious intent.
`restrict` means "reduce functionality" — appropriate for signals that indicate a higher-risk
environment but not certain compromise. `lockout` and `kill` are reserved for signals with very
high confidence that the environment is actively hostile.

Add a test in `policy.test.ts` verifying that the new threat maps to the correct default policy:

```typescript
test('installationSource defaults to restrict', () => {
  expect(DEFAULT_POLICIES['installationSource']).toBe('restrict');
});
```

### Step 7: Update documentation

Update the relevant documentation files:
- `docs/engines.md` — add `installationSource` to the detector catalogue table
- `CHANGELOG.md` — add an entry under the `Unreleased` section
- The ADR if this decision required one (new ThreatIds rarely do unless they involve a novel
  detection strategy)

---

## 7. Native Code Bridge

### The JSI / TurboModule pattern

React Native's legacy architecture used the **Bridge** — an asynchronous JSON serialization layer
between JS and native. Every call crossed a serialization boundary, every value was
JSON-serialized and deserialized, and the whole thing was asynchronous.

**TurboModule** (the New Architecture) replaces this with a JSI (JavaScript Interface) binding.
JSI gives JavaScript direct access to C++ objects. There is no serialization cost. Calls can be
synchronous. The native module is accessed as a JavaScript object.

The flow for guardian-rn is:

```
JS layer                    JSI layer                    Native layer
---------                   ---------                    ------------
NativeGuardianRN.start()  → TurboModuleRegistry         GuardianRNModule.kt / .swift
                              getEnforcing('GuardianRN') → start(configJson)
                                                            creates SessionKeyManager
                                                            creates ThreatBus
                                                            installs GuardianHostObject
                                                               into JS runtime
```

**`NativeGuardianRN.ts`** is the TypeScript declaration of the TurboModule spec. React Native
codegen reads this file and generates C++ bridge boilerplate automatically. You never write the
C++ bridge code by hand.

```typescript
export interface Spec extends TurboModule {
  start(configJson: string): Promise<string>;
  stop(): Promise<void>;
  getSessionKey(): Promise<string>;
  installJSIBindings(): Promise<void>;
}
```

**`GuardianHostObject`** (C++/Objective-C++) is a JSI HostObject — a C++ class that appears as
a JavaScript object. It exposes `getSessionKey()`, `subscribe(filter, fn)`, and
`unsubscribe(subscriberId)` directly in the JS runtime without any serialization.

### When to add a new native method

Before adding a new native method, ask whether the functionality genuinely requires native code:
- Does it access a hardware-backed API (Keystore, Keychain, Secure Enclave)?
- Does it read OS-level state that is not accessible from JS (process list, file system at
  privileged paths, kernel properties)?
- Does it need to run off the JS thread for performance reasons?

If the answer to all three is no, implement it in TypeScript. Native code multiplies the
maintenance surface by three (Kotlin + Swift + C++ bridge spec).

When adding a new native method, follow these steps:
1. Add the method signature to `NativeGuardianRN.ts` (the TypeScript TurboModule spec).
2. Implement it in `GuardianRNModule.kt` on Android and `GuardianRNModule.swift` on iOS.
3. Test the Android implementation with a unit test (use Robolectric for local runs).
4. Test the iOS implementation with an XCTest unit test.
5. Write a TypeScript integration test that mocks the native module and verifies the JS-side
   behavior.

### Android Kotlin structure

```
GuardianRNModule.kt     — TurboModule: @ReactMethod-annotated start/stop/getSessionKey
GuardianRNPackage.kt    — registers GuardianRNModule with the RN runtime
SessionKeyManager.kt    — generates and holds the HMAC key (AndroidKeyStore-backed)
HmacSigner.kt           — HMAC-SHA256 sign + constant-time verify
CanonicalJsonSerializer.kt — RFC 8785 JCS for Kotlin
ThreatBus.kt            — Kotlin SharedFlow emitting ThreatEnvelope (signed, sequenced)
EncryptedStorageManager.kt — EncryptedSharedPreferences
ScreenCaptureProtector.kt  — FLAG_SECURE + API-34 screen capture callback
generated/              — ThreatId.kt, Severity.kt, ResponsePolicy.kt (DO NOT EDIT)
```

Android Kotlin uses `kotlinx.coroutines.flow.SharedFlow` for the native event stream. Kotlin's
structured concurrency handles backpressure. The `ThreatBus` uses `MutableSharedFlow(replay = 32,
extraBufferCapacity = 64)` so that a slow consumer does not block the native detector thread.

### iOS Swift structure

```
GuardianRN.mm           — Objective-C++ bridging file, installs GuardianHostObject into JSI
GuardianHostObject.h/cpp — JSI HostObject (C++), one-call key delivery, subscribe/unsubscribe
Sources/GuardianRN/
  GuardianRNModule.swift — TurboModule entry point (@objc class, @objc methods)
  SessionKeyManager.swift — SecRandomCopyBytes key, NSLock-guarded
  HmacSigner.swift        — HMAC-SHA256 via CommonCrypto
  CanonicalJSONEncoder.swift — RFC 8785 JCS for Swift
  ThreatBus.swift         — Combine Publisher-based native event bus
  KeychainStorageManager.swift — Keychain CRUD
  SceneAwareScreenProtector.swift — blur overlay on willResignActive
Generated/              — ThreatId.swift, Severity.swift, ResponsePolicy.swift (DO NOT EDIT)
```

iOS Swift uses Combine's `AnyPublisher` for the native event stream. `@MainActor` is used on
`SceneAwareScreenProtector` because it interacts with `UIKit`, which must be called on the main
thread.

### Why `require('react-native').Platform` instead of compile-time checks

In `useGuardian.ts`, the platform is detected at runtime:

```typescript
function getPlatform(): 'android' | 'ios' {
  try {
    const { Platform } = require('react-native') as { Platform: { OS: string } };
    return Platform.OS === 'android' ? 'android' : 'ios';
  } catch {
    return 'ios'; // Node test environment — no react-native module
  }
}
```

Why not `import { Platform } from 'react-native'` at the top of the file, or a compile-time
`#ifdef`?

**For `import` at module scope:** The `guardian-rn` package is tested in a Node.js environment
via Jest. Node.js does not have a `react-native` module. A static top-level import would fail
in the test environment. Using a dynamic `require` inside a `try/catch` allows the test
environment to fall back gracefully.

**For compile-time switches:** React Native does not have a standard compile-time preprocessor
that works across both platforms and TypeScript. We could use Metro's platform-specific file
resolution (`getPlatform.android.ts`, `getPlatform.ios.ts`) but that creates two files for one
function. The `require`-at-runtime pattern is the standard React Native approach for this case.

**For native code:** The native layer (Kotlin and Swift) uses platform-specific APIs directly —
there is no cross-platform branching at the native layer. The `platform` field in `EngineContext`
is available to engine implementations that need to branch logic in TypeScript.

---

## 8. Common Pitfalls

### Stale closures in `useEffect` and why `configRef` is used

React closures in `useEffect` capture the values that existed at the time the effect ran. If you
write:

```typescript
// WRONG — stale closure
useEffect(() => {
  const engine = new CommunityEngine();
  engine.onThreat.subscribe({
    next: (event) => {
      config.actions.onLockout?.(event); // captures config from mount-time
    }
  });
}, []);
```

The `config` captured here is the value that existed when `useEffect` ran (on mount). If the
parent component passes a new `config` object on re-render, the subscription still holds the old
reference. The `onLockout` callback from the previous render is what gets called.

`useGuardian` solves this with `configRef`:

```typescript
// CORRECT — always uses latest config
const configRef = useRef(config);
configRef.current = config; // updated on every render

useEffect(() => {
  const startAll = async () => {
    policyEngine = new PolicyEngine(configRef.current); // fresh reference at call time
    ...
    engine.onThreat.subscribe({
      next: (event) => policyEngine.apply(event), // policyEngine was built from configRef.current
    });
  };
}, []); // effect only runs once — no stale closure because configRef.current is mutable
```

The `[]` dependency array is intentional and correct here. Engines are started once and stopped
on unmount. The `configRef.current` assignment on every render ensures the subscription always
dispatches to the latest config.

### Why `stop()` must be idempotent

The `useEffect` cleanup runs on unmount. If React strict mode re-mounts the component (which it
does in development), `stop()` may be called twice. If `stop()` is not idempotent, the second
call may throw, clear state that was already cleared, or cancel timers that were already
cancelled.

The pattern is to guard with a `running` flag:

```typescript
async stop(): Promise<void> {
  if (!this.running) return; // idempotency guard
  this.running = false;
  clearInterval(this.pollTimer);
  // ...
}
```

Follow this pattern in every engine and every component that has cleanup logic.

### Why engines must not emit before `start()` resolves

The `EventBus.attachEngine()` call subscribes to `engine.onThreat`. If an engine emits an event
before `start()` resolves — for example, by starting a background timer in the constructor — that
event arrives on the stream before `attachEngine` has been called. The event is lost.

The lifecycle contract (from ADR-0004) is explicit:

> start() must resolve before any event is emitted.

In practice: do not start polling timers in the constructor. Start them in `start()`, after the
promise resolves. If your engine runs initial checks synchronously inside `start()`, emit events
only after `await` points that follow the start of the subscription.

### Why HMAC only covers payload fields, not the envelope header

The HMAC is computed over `canonicalJson(envelope.payload)`. It does not cover `seq`,
`sessionId`, `ts`, or `hmac` itself.

This is intentional. `seq`, `sessionId`, and `ts` are transport metadata — they are verified by
the collector at the batch level (mTLS + batch idempotency key). Including them in the HMAC
would require the native signer to know the HMAC before setting the `hmac` field, which is a
circularity. The payload — `threatId`, `severity`, `confidence`, `evidence`, `ts` — is what
matters for policy decisions. That is what is protected.

The consequence: an attacker can modify `seq` without invalidating the HMAC. The
`SequenceTracker` handles replay attacks against `seq` independently of HMAC verification. The
two mechanisms are complementary, not redundant.

### Why fuzz tests only mutate HMAC-covered fields

The fuzz test `mutateEnvelope()` modifies either the `hmac` string or the `payload` content:

```typescript
function mutateEnvelope(base: GuardianEnvelope, seed: number): GuardianEnvelope {
  const branch = seed % 5;
  switch (branch) {
    case 0: return { ...base, hmac: 'sha256=' + randomString(64) };
    case 1: return { ...base, hmac: randomString(72) };
    case 2: return { ...base, payload: { ...base.payload, threatId: 'debugger' } };
    case 3: return { ...base, hmac: '' };
    default: return { ...base, hmac: base.hmac.slice(0, -1) + 'x' };
  }
}
```

It does not mutate `seq`, `sessionId`, or `ts`. This is correct because `verifyEnvelope` only
checks the HMAC — it does not check sequence numbers. Mutating `seq` would not cause
`verifyEnvelope` to fail; the SequenceTracker handles that. Including `seq` mutations in the
`verifyEnvelope` fuzz would cause false test failures and obscure what the test is actually
proving.

When you write fuzz tests for a new component, be precise about what the component is
responsible for and only fuzz those inputs.

### `cancelPendingKills()` must be called on cleanup

The `useGuardian` cleanup function calls:

```typescript
return () => {
  policyEngine?.cancelPendingKills();
  for (const sub of subscriptions) sub.unsubscribe();
  for (const engine of configRef.current.engines) void engine.stop();
};
```

`cancelPendingKills()` is called first. If the app unmounts while a kill timer is pending (for
example, in a test environment that mounts and unmounts quickly), failing to cancel the timer
would call `terminator.terminate()` after unmount. In development with strict mode, this would
cause confusing errors in the following test.

---

## 9. CI/CD Pipeline

### `ci.yml` — runs on every push and PR

The CI pipeline has five jobs that run in a directed graph:

```
codegen-check ──┬─→ typecheck
                └─→ test
schema-validate
lint
fuzz-extended (main only)
```

**`codegen-check`** — the most important job for day-to-day development. It runs `npm run codegen`
and then `git diff --exit-code` over the three generated directories. If the generated artefacts
in the PR differ from what codegen would produce, this job fails with:

```
Stale generated artefacts — run `npm run codegen` and commit
```

This is the safety net for the rule "never edit generated files by hand." A PR that edits
`ThreatId.ts` directly (instead of editing `threat-schema.json` and running codegen) will fail
this job.

**`schema-validate`** — runs `packages/codegen/src/validate.ts` which checks that
`threat-schema.json` is valid JSON Schema draft-07. This prevents malformed schema from causing
cryptic errors in codegen.

**`typecheck`** — runs `tsc --noEmit` after first running codegen. `typecheck` depends on
`codegen-check` passing, because if the schema has changed and codegen has not been run, the
type imports would be stale.

**`test`** — runs `npm test` (Jest). Also depends on `codegen-check` because tests import from
the generated files.

**`lint`** — runs ESLint. Currently non-blocking (`|| true`) while the lint config is being
finalised for the native TypeScript interop types. This will become blocking in Phase 2.

**`fuzz-extended`** — runs only on pushes to `main`, not on PRs. Runs the fuzz tests with
`FUZZ_ITERATIONS=100000`, 20× the default. This catches statistical edge cases that the 5,000
iteration test might miss.

### `release.yml` — runs on version tags

A release is triggered by pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+*` (for example `v1.2.0`
or `v1.2.0-beta.1`).

**`verify` job** — re-runs the full verification suite on the tagged commit: codegen freshness,
typecheck, lint, test. This is intentionally redundant with CI because a human may push a tag
to a commit that did not go through CI.

**`publish` job** — requires `verify` to pass, and additionally requires **manual approval** via
the `npm-publish` GitHub Environment. This means someone with repo admin access must click
"Approve" in the GitHub UI before npm publish runs. This is a human gate that prevents an
accidental tag from publishing to npm.

The publish step runs:

```bash
npm publish --workspace=packages/guardian-rn --provenance --access public
```

**npm provenance attestation** (`--provenance`) means npm will record a signed SLSA provenance
attestation for this package — proof that this specific version was built from this specific
commit in this specific GitHub Actions run. Consumers can verify this on `npmjs.com` or via
`npm audit signatures`. It protects against supply-chain attacks where an attacker publishes a
malicious version of the package with a stolen npm token.

The `id-token: write` permission in the workflow grants the GitHub Actions runner permission to
request an OIDC token, which is what npm uses to generate the provenance attestation.

After publishing, the `softprops/action-gh-release` action creates a GitHub Release. If the tag
contains `-alpha`, `-beta`, or `-rc`, the release is marked as pre-release. The release body is
taken from `CHANGELOG.md`.

---

## 10. Glossary

**ADB** (Android Debug Bridge) — a command-line tool that communicates with Android devices.
Having ADB enabled in developer mode is a weaker signal than root but is still captured by the
`adbEnabled` detector. Default policy: `telemetry`.

**AndroidKeyStore** — hardware-backed cryptographic key storage on Android. Keys stored here
cannot be extracted; cryptographic operations are performed inside the secure hardware. Used by
`SessionKeyManager.kt` to generate the HMAC session key.

**Backpressure** — the condition where a producer is generating events faster than a consumer
can process them. In guardian-rn, the rate cap (50 events/second per engine) is the backpressure
mechanism on the JS-side EventBus. On the Android native side, Kotlin's `SharedFlow` with
`extraBufferCapacity` handles native-side backpressure.

**BehavioralBaseline** — a v1.1.0 detector concept that establishes a baseline of "normal"
sensor and interaction patterns for this device and flags significant deviations. Relevant in
BYOD and MDAM scenarios where automated or scripted interaction may indicate a fraud attempt.

**BYOD** (Bring Your Own Device) — an enterprise deployment model where employees use their
personal devices for work. BYOD environments have higher variance in device security posture
than MDM-managed fleets. The `passcodeMissing` and `biometricMissing` detectors are especially
relevant in BYOD contexts.

**Canonical JSON (JCS)** — JSON Canonicalization Scheme, defined by RFC 8785. Produces a
deterministic byte-for-byte representation of a JSON value: object keys sorted by Unicode code
point, no insignificant whitespace, shortest IEEE 754 number representations. Required so that
the HMAC computed in Kotlin, Swift, and TypeScript from the "same" JSON value produces
identical bytes.

**Confidence threshold** — the minimum confidence score required for a ResponsePolicy to fire.
Defaults: `restrict` ≥ 0.5, `lockout` ≥ 0.7, `kill` ≥ 0.9. Configurable per tenant via
`GuardianConfig.confidenceThresholds`.

**Confidence score** — a float between 0.0 and 1.0 representing how certain a detector is
about its detection. Used by the PolicyEngine to decide whether a detection is strong enough
to act on for a given policy level.

**CommunityEngine** — the open-source `Engine` implementation shipped in `packages/engine-community`.
Uses `Promise.allSettled` to fan out across all registered detectors, so a single crashing
detector does not prevent others from running. Confidence gate of 0.5 before emitting any event.

**ConstantTimeEqual** — a comparison function that takes the same amount of time regardless of
where the strings first differ. Used for HMAC comparison to prevent timing attacks where an
attacker repeatedly submits slightly-modified HMACs and measures response time to learn the
correct value.

**Dedup window** — the 100 ms sliding window during which the EventBus suppresses duplicate
`threatId` emissions from the same engine. Prevents a high-frequency polling engine from
producing multiple identical callbacks in rapid succession.

**Detector** — the atomic unit of threat detection in `engine-community`. Each Detector
implements the `Detector` interface and checks for one specific threat. Detectors are
independent; they are fanned out via `Promise.allSettled`.

**DevMode** — Android developer mode / iOS developer mode enabled on the device. A weak signal
(many developers and power users enable this legitimately) captured for telemetry. Default
policy: `telemetry`.

**EncryptedStoragePort** — a port interface abstracting over `EncryptedSharedPreferences`
(Android) and Keychain (iOS). Consumers depend on the interface, not the platform
implementation.

**Engine** — anything that implements the `Engine` interface: `id`, `start(context)`, `stop()`,
`onThreat`, `onHealthTick`. The pluggable extension point for detection libraries.

**EngineContext** — the struct passed to `engine.start()`: `config`, `sessionId`, `platform`,
`onFault`. Provides everything an engine needs to operate without hard-coding dependencies.

**EngineRegistry** — a helper class that holds multiple `Engine` instances and provides
`startAll`/`stopAll` with idempotency guards. Used by advanced integrations that manage engines
outside of `useGuardian`.

**EventBus** — the central routing layer. Subscribes to all engine streams, applies HMAC
verification, dedup, and rate capping, then dispatches to registered handlers. Isolates engine
faults from consumers.

**Evidence** — the `Record<string, string>` field on a ThreatEvent. Contains all context a
security analyst needs to understand what triggered the detection. Values must be string-
serializable. Example: `{ path: '/sbin/su', method: 'filesystem_check' }`.

**FLAG_SECURE** — an Android window flag that prevents the OS from including the window contents
in screenshots and screen recordings. Set by `ScreenCaptureProtector` on every Activity.

**Frida** — a dynamic instrumentation toolkit commonly used to hook mobile app functions at
runtime. The `hooks` detector targets Frida injection. The HMAC signing scheme specifically
defends against Frida hooking the JSI bridge to inject or suppress events.

**HealthTick** — a periodic heartbeat emitted by an engine confirming it is still running.
Must be emitted at least once per 60,000 ms. Absence triggers alert A-2 in the collector's
Grafana dashboard.

**HMAC** (Hash-based Message Authentication Code) — a keyed cryptographic hash. In guardian-rn,
HMAC-SHA256 with a 32-byte session key signs every ThreatPayload before it crosses the native-
to-JS bridge. Provides integrity and authenticity: any modification to the payload invalidates
the HMAC, and computing a valid HMAC requires the session key.

**JSI** (JavaScript Interface) — React Native's New Architecture mechanism for zero-copy
synchronous access to native objects from JavaScript. Replaces the legacy async JSON bridge.
guardian-rn requires JSI (ADR-0001; no legacy bridge fallback).

**Jailbreak** — the iOS equivalent of root: exploiting a kernel vulnerability to bypass
sandboxing and code-signing enforcement, granting root access to the file system. The
`JailbreakDetector` checks for Cydia, substrate injection paths, and other known jailbreak
indicators.

**Kill timer** — a `setTimeout` set by the PolicyEngine when the `kill` policy fires. After
`graceMs` (default: 3,000 ms), `TerminatorPort.terminate()` is called. Only one timer per
`threatId` is active at a time (dedup guard). Cancelled by `cancelPendingKills()` on cleanup.

**Keychain** (iOS) — the iOS secure credential store. guardian-rn uses it (via
`KeychainStorageManager`) with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` for policy
caching. The `ThisDeviceOnly` suffix prevents iCloud backup migration.

**Lockout** — a ResponsePolicy that calls `onLockout`. The app should prevent all user
interaction. Fires at confidence ≥ 0.7 by default. Used for `root`, `jailbreak`,
`privilegedAccess`, `malware`, `taskHijacking`.

**MDAM** (Mobile Device and Application Management) — enterprise software that manages and
monitors mobile devices. The `ManagedProfileDetector` (v1.1.0) detects Android Work Profiles
created by MDM software, relevant in enterprise contexts.

**Monorepo** — a single git repository containing multiple packages. guardian-rn uses npm
workspaces. `npm install` at the root installs all packages. `npm run codegen` and `npm test`
at the root operate on the entire monorepo.

**OODA** (Observe, Orient, Decide, Act) — a decision-making loop framework. The
`OODAController` (v1.1.0) implements an adaptive policy adjustment loop: it observes rolling
threat frequency, orients by comparing to historical baseline, decides whether to tighten
thresholds, and acts by adjusting the confidence threshold multiplier. Under active attack, OODA
makes the PolicyEngine more sensitive.

**Pluggable engine** — an `Engine` implementation that satisfies the `Engine` interface. The
`CommunityEngine` is the reference implementation; commercial engines (from security vendors)
can be provided as alternatives or in addition to it.

**PolicyEngine** — the class in `core/policy.ts` that maps a ThreatEvent to an action. Consults
`DEFAULT_POLICIES` and `config.policies`, checks confidence thresholds, calls the appropriate
action callback, and manages kill timers.

**PolicyStore** — an `EncryptedStoragePort`-backed cache for offline policy configurations.
Allows the SDK to continue enforcing policies when the device is offline and cannot fetch the
latest policy from the server.

**Provenance attestation** — a signed record (generated by npm during publish) that links a
published npm package version to the exact source commit and CI run that produced it. Verifiable
via `npm audit signatures` or on `npmjs.com/package/guardian-rn`. Protects against supply-chain
attacks.

**RASP** (Runtime Application Self-Protection) — security technology that instruments an
application to detect and respond to attacks at runtime, from inside the application process.
Unlike perimeter defenses, RASP observes the execution context directly.

**Rate cap** — the EventBus mechanism that drops events from an engine that exceeds 50
events/second. The dropped count is accessible via `bus.dropped`. Prevents a misbehaving engine
from flooding the JS bridge.

**Replay attack** — an attack where a valid message is captured and re-sent later. The
`SequenceTracker` detects replay attacks on HMAC envelopes: if a `seq` number is seen that is
≤ the last accepted `seq`, it is classified as `replay` and dropped.

**ResponsePolicy** — one of four values: `telemetry`, `restrict`, `lockout`, `kill`. Determines
what the PolicyEngine does when a detector fires. Generated from `threat-schema.json`.

**Restrict** — a ResponsePolicy that calls `onRestrict`. The app should reduce functionality,
require step-up auth, or display a warning. Fires at confidence ≥ 0.5 by default.

**RFC 8785** — the IETF standard for JSON Canonicalization Scheme (JCS). Defines the
deterministic JSON serialization used before HMAC signing. See https://www.rfc-editor.org/rfc/rfc8785.

**Root** — the state of an Android device where the OS restrictions on the root superuser
have been removed, typically via Magisk or SuperSU. The `RootDetector` checks for known root
binaries (`su`, `busybox`, `magisk`) and root path indicators.

**SceneAwareScreenProtector** — iOS-specific: adds a `UIBlurEffect` overlay to every `UIWindowScene`
when the app transitions to inactive/background state. Prevents the OS screenshot thumbnail and
App Switcher preview from exposing sensitive content.

**ScreenCaptureProtector** — Android-specific: registers `WindowManager.FLAG_SECURE` on every
Activity, and on API 34+ registers a capture callback to emit a `screenCapture` ThreatEvent.

**SecRandomCopyBytes** — the iOS cryptographically secure random byte generator used by
`SessionKeyManager.swift` to generate the 32-byte HMAC session key.

**SequenceTracker** — tracks monotonic `uint32` sequence numbers per session. Detects `replay`
(seq ≤ last), `gap` (seq > last + 1), `rollover` (seq wrapped from max to near-zero), and
`wrong_session` (sessionId mismatch).

**Session key** — the 32-byte HMAC key generated fresh on every `start()` call. Backed by
AndroidKeyStore (Android) or SecRandomCopyBytes (iOS). Delivered to JS exactly once via the
JSI HostObject. Zeroed in native memory after delivery.

**SessionId** — a UUID v4 generated once per native `start()` call. Included in every envelope.
Used by `SequenceTracker` to detect cross-session replay.

**sessionMaxAgeMs** — the maximum age of a session before the SDK triggers a re-key. After this
duration, `start()` must be called again to generate a new session key and session ID.

**Severity** — one of `low`, `medium`, `high`, `critical`. Set by the detector based on the
potential impact of the threat. `root` is `high`; `timeSpoofing` is `medium`. Generated from
`threat-schema.json`.

**SLSA** (Supply-chain Levels for Software Artifacts) — a framework for supply-chain integrity.
npm provenance attestation provides SLSA Build Level 3 for guardian-rn.

**TEE** (Trusted Execution Environment) — hardware-isolated computing environment separate from
the main OS. AndroidKeyStore and iOS Secure Enclave are TEE-backed. Session keys generated using
TEE APIs cannot be extracted even by a root-level attacker.

**TelemetryAdapter** — port interface for shipping events to an observability system. Three
methods: `recordThreat`, `recordHealthTick`, `flush`. Injected via `GuardianConfig.telemetry`.

**TerminatorPort** — port interface for process termination. One method: `terminate(reason)`.
Injected via `GuardianConfig.terminator`. In tests, a mock implementation is used instead of
actually calling `process.exit`.

**ThreatBus** — the native-side event bus (in both `ThreatBus.kt` and `ThreatBus.swift`).
Holds the sequence counter, signs each payload with HMAC, serializes to JSON, and emits onto a
SharedFlow (Kotlin) / Combine publisher (Swift).

**ThreatEvent** — the object that flows through the JS layer: `threatId`, `severity`,
`confidence`, `evidence`, `ts`, `engineId`. Produced by the CommunityEngine from detector
results, or by the EventBus from a verified native envelope.

**ThreatId** — a string literal union type generated from `threat-schema.json`. Every threat
that guardian-rn can detect has a ThreatId. Adding a new detector requires adding a ThreatId
to the schema and running codegen.

**ThreatPayload** — the HMAC-signed subset of a GuardianEnvelope: `threatId`, `severity`,
`confidence`, `evidence`, `ts`. The fields that matter for policy decisions. Transport fields
(`seq`, `sessionId`, `ts` in the envelope, `hmac`) are not signed.

**TurboModule** — the React Native New Architecture mechanism for native modules. Uses JSI
(JavaScript Interface) for zero-serialization-cost synchronous or asynchronous calls between
JS and native. guardian-rn requires TurboModule; there is no legacy bridge fallback (ADR-0001).

**useGuardian** — the primary React hook. Starts all configured engines on mount, wires the
PolicyEngine to every threat event via subscriptions, and stops all engines (cancels kill timers,
unsubscribes, calls `stop()`) on unmount.

**`wrong_session`** — a `SequenceTracker` result indicating that the `sessionId` in an envelope
does not match the tracker's expected session. The event is dropped. Indicates either a
programming error (two engines using the same bus instance across restarts) or a cross-session
replay attack.

---

*Questions, corrections, and improvements to this guide are welcome. Open a PR with the change
and the reason — the guide should stay accurate as the codebase evolves.*

# A Superior Mobile RASP for React Native — `guardian-rn` Proposal

> **Companion to:** `01-product-and-solution-design.md`.
> **Goal:** Take every weakness identified in §6 of the PSDD and design a next-generation RASP-for-RN library that resolves them, without losing the strengths of the original.
> **Codename:** `guardian-rn` (working name; not affiliated with Talsec).

This is a *design* document — it specifies a concrete architecture, public API, file layout, and migration path. Code excerpts are illustrative TypeScript / Kotlin / Swift, not finished implementations.

---

## 1. Design Goals (Non-Negotiables)

| # | Goal | Why |
|---|---|---|
| G1 | **TurboModule + Fabric (New Architecture) first**, with codegen specs as the source of truth. | freeRASP-RN ships only the legacy bridge; RN ≥ 0.74 is moving toward New Architecture as default. |
| G2 | **Type-safe end-to-end**: native event payloads, threat enums, and host actions share one codegen-derived type. No more 22-arm `switch` keyed off untyped `NativeEvent`. | Eliminates W4, W10. |
| G3 | **Multi-tenant in JS**: any number of `useGuardian()` mounts, with per-mount listeners. The native engine starts once; subscribers are tracked separately. | Eliminates W2, W3, W20. |
| G4 | **Pluggable detection engines.** The same JS API can sit on top of Talsec, Promon, in-house, or a fully open-source detector. Default: open-source community detectors, with adapters for Talsec/Promon. | Removes W-vendor-lock. Strategic. |
| G5 | **Rich threat metadata** (severity, confidence, evidence) — not just a binary "this happened". | Eliminates W13. |
| G6 | **First-class telemetry seam** — host apps wire `onThreat` once and ship to whatever observability stack they like. Built-in adapters for Sentry, Datadog, Firebase. | Eliminates W21. |
| G7 | **Cryptographically authenticated bridge** — the random-ID trick is good; a HMAC over each event payload is better. Tampering with the bridge is detectable, not just statically obscured. | Strengthens against W19. |
| G8 | **Graceful degradation, not `abort()`.** Configurable response policy (telemetry-only, restrict, lock-out, kill). Default is "isolate the user from sensitive surfaces, not crash". | Eliminates W-self-protection-UX. |
| G9 | **Tested.** Unit tests for the JS layer (Jest), native unit tests (JUnit/Robolectric, XCTest), and an instrumented E2E suite using Detox. | Eliminates W9. |
| G10 | **No vendor maven required to build.** Engine binaries are vendored in the npm tarball, mirrored to a public registry, and signed. Optional remote update channel for threat-feed-only data. | Eliminates W-availability-risk. |
| G11 | **iOS multi-scene, multi-window aware.** Mac Catalyst, iPad split-view, CarPlay, Vision Pro spatial — all handled. | Eliminates W6. |
| G12 | **Encrypted storage by default** for `externalId` (Keychain on iOS, EncryptedSharedPreferences on Android). | Eliminates W8. |
| G13 | **Documented, formal threat model** for the package itself, published in-repo, reviewed annually. | Eliminates W-no-threat-model. |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      React Native App (JS / TS)                     │
│                                                                     │
│  GuardianProvider (React context)                                   │
│   └── useGuardian({                                                 │
│         policy,    // ResponsePolicy: telemetry|restrict|lockout|kill│
│         engines,   // ['talsec', 'community', 'custom-adapter']      │
│         onThreat,  // (ThreatEvent) => void                          │
│         onState,   // (EngineState) => void                          │
│       })                                                             │
│                                                                     │
│  Type-safe runtime, codegen'd from a single .schema.json             │
│  ────────────────────────────────────────────────────────            │
│  ThreatEvent  = SignedEnvelope<ThreatPayload>   (HMAC verified)      │
│  ThreatPayload = { id: ThreatId, severity, confidence, evidence,     │
│                    capturedAt, engine, sessionId, sequenceNumber }   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │   TurboModule (codegen)                  ▲
          ▼                                          │
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Android (Kotlin, JSI)       │   │  iOS (Swift, JSI)            │
│                              │   │                              │
│  GuardianHostObject          │   │  GuardianHostObject          │
│    • registerEngine(name)    │   │    • registerEngine(name)    │
│    • addSubscriber(id, sel)  │   │    • addSubscriber(id, sel)  │
│    • removeSubscriber(id)    │   │    • removeSubscriber(id)    │
│    • signedEvent → JSI Value │   │    • signedEvent → JSI Value │
│                              │   │                              │
│  EngineRegistry              │   │  EngineRegistry              │
│   ├── TalsecEngineAdapter    │   │   ├── TalsecEngineAdapter    │
│   ├── CommunityEngine        │   │   ├── CommunityEngine        │
│   └── CustomEngine (host)    │   │   └── CustomEngine (host)    │
│                              │   │                              │
│  ThreatBus (Kotlin Flow,     │   │  ThreatBus (AsyncSequence)   │
│   replay-cache 32, conflate) │   │                              │
│                              │   │                              │
│  HMAC signer                 │   │  HMAC signer                 │
│   • per-process key in       │   │   • per-process key in       │
│     EncryptedSharedPrefs     │   │     Keychain (kSecAttr...)   │
│   • SHA-256 over payload     │   │   • SHA-256 over payload     │
│                              │   │                              │
│  Lifecycle owner             │   │  Scene-aware lifecycle       │
│   • flow lifecycle-bound     │   │   • per-scene window list    │
│   • multi-process safe       │   │   • UISceneSession aware     │
└──────────────────────────────┘   └──────────────────────────────┘
```

### 2.1 Why TurboModule + JSI

- **JSI** (the C++ host-object layer) is **synchronous** — `getThreatIdentifiers` becomes a regular function call, not a `Promise`. The 4-step channel-negotiation dance from freerasp-rn (Section 3.1 of PSDD) collapses into a single host-object access.
- **Codegen** (`react-native-codegen`) reads `src/specs/NativeGuardian.ts`, emits the JNI/Obj-C glue, and gives both sides the same TS types. No more loosely-typed `NativeEvent`.
- **TurboModule** loads on demand instead of at app start, reducing TTI.

```ts
// src/specs/NativeGuardian.ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  start(config: GuardianConfig): Promise<StartResult>;
  stop(): Promise<void>;
  registerEngine(name: string): Promise<void>;
  setExternalId(value: string, options: ExternalIdOptions): Promise<void>;
  getExternalId(): Promise<string | null>;
  blockScreenCapture(enable: boolean, sceneId?: string): Promise<boolean>;
  isScreenCaptureBlocked(sceneId?: string): Promise<boolean>;
  getAppIcon(packageName: string): Promise<string | null>;
  // The bus comes through JSI HostObject, not through this spec.
}
export default TurboModuleRegistry.getEnforcing<Spec>('Guardian');
```

The **threat bus** is an installed JSI `HostObject` exposing `subscribe(filter, handler)` synchronously and emitting via direct C++ → JS callback (no main-queue hop, no event-emitter overhead).

### 2.2 Replacing the `Threat`-class trick with codegen'd ADTs

```ts
// generated from src/schema/threats.schema.json
export type ThreatId =
  | 'privilegedAccess' | 'debug' | 'simulator' | 'appIntegrity'
  | 'unofficialStore' | 'hooks' | 'deviceBinding' | 'deviceID'
  | 'passcode' | 'secureHardwareNotAvailable' | 'obfuscationIssues'
  | 'devMode' | 'systemVPN' | 'malware' | 'adbEnabled'
  | 'screenshot' | 'screenRecording' | 'multiInstance'
  | 'timeSpoofing' | 'locationSpoofing' | 'unsecureWifi' | 'automation';

export type ThreatSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ThreatPayload = {
  id: ThreatId;
  severity: ThreatSeverity;
  confidence: number;          // 0..1
  evidence?: ThreatEvidence;   // shape depends on id
  capturedAt: string;          // ISO-8601 with ms
  engine: EngineName;
  sessionId: string;           // per-process UUID
  sequenceNumber: number;      // monotonic per-session
};

export type ThreatEvidence =
  | { kind: 'hooks'; framework: 'frida'|'xposed'|'shadow'|'unknown'; signatures: string[] }
  | { kind: 'malware'; suspiciousApps: SuspiciousAppInfo[] }
  | { kind: 'unofficialStore'; installer: string | null }
  | { kind: 'simulator'; signals: string[] }
  | { kind: 'generic'; signals: string[] };
```

Generators (`scripts/codegen.ts`) read `threats.schema.json` and emit:
- TS types,
- Kotlin sealed classes (replacing manual `ThreatEvent.kt`),
- Swift enums (replacing manual `SecurityThreat.swift` mapping).

**Adding a new threat is now a one-file change** (the schema), eliminating the three-way coupling (W10).

### 2.3 Cryptographically authenticated bridge (G7)

Each native-emitted event:

```
SignedEnvelope = {
  payload: ThreatPayload (JSON-serialised, canonical),
  sig:     base64( HMAC-SHA256( sessionKey, payload || sequenceNumber ) ),
  seq:     sequenceNumber (uint64, monotonic)
}
```

- `sessionKey` is generated once per process (`SecureRandom` 32 bytes Android, `SecRandomCopyBytes` iOS), stored in `Keystore`/`Keychain` only for the process lifetime.
- The key is **handed to JS via JSI HostObject** at start-up (a single sync read), not via the bridge — never serialised through the legacy bridge where it could be tapped.
- JS re-computes HMAC on every event; mismatch → invariant breach → call configured response policy.
- Sequence numbers prevent replay; gaps are logged. Strict monotonicity catches a tampering layer that drops events.

This is meaningfully stronger than the existing random-id trick because:
- An attacker hooking the JSI bridge can't forge events without the per-process key.
- An attacker hooking the JS layer can't fake a "no threat" response without breaking sequence-number monotonicity.
- The system is auditable post-incident from the seq-number trail.

### 2.4 Engine pluggability (G4)

```kotlin
// android/src/main/java/com/guardian/engine/Engine.kt
interface Engine {
    val name: String
    val capabilities: Set<ThreatId>
    fun start(context: Context, config: GuardianConfig, bus: ThreatBus)
    fun stop()
}

class TalsecEngineAdapter(private val tal: Talsec) : Engine { /* … */ }
class CommunityEngine : Engine { /* OWASP-MASVS aligned, MIT, no binary blob */ }
```

Engines run in **parallel** and emit into the same `ThreatBus`. Two engines reporting the same `ThreatId` in the same window are **merged** (taking max severity, union of evidence) by the bus's conflation step. Hosts pick engines via `engines: ['community', 'talsec']` with priority.

The community engine implements *the basics* — root binaries scan, debugger attached, simulator props — without any closed-source binary. This gives a baseline level of protection even if the host can't ship Talsec.

### 2.5 Response policy (G8)

```ts
type ResponsePolicy =
  | { kind: 'telemetry' }                                  // observe, never act
  | { kind: 'restrict'; sensitiveScreens: string[] }       // disable navigation
  | { kind: 'lockout'; redirectTo: string }                // log out, require re-auth
  | { kind: 'kill'; gracePeriodMs?: number }               // last resort
  | { kind: 'custom'; handler: (e: ThreatEvent) => Promise<ResponseAction> };
```

The library **never calls `abort()` for an honest user**. The `kill` policy is opt-in and is the only one with a graceful warning surface. Even then, before kill: log a final telemetry beacon, give the host 1s to flush, then exit cleanly.

The `restrict` mode is the recommended default for fintech: when `hooks` fires, the app navigates away from balance/transfer screens and shows a "we detected a security issue" sheet — the user can still close the app cleanly, contact support, etc.

---

## 3. Public API

```ts
// Single canonical entry-point
export const useGuardian = (
  config: GuardianConfig,
  options?: {
    policy?: ResponsePolicy;
    engines?: EngineName[];                 // default: ['community']
    onThreat?: (e: ThreatEvent) => void;    // optional firehose
    onState?: (s: EngineState) => void;     // ready / running / degraded / stopped
    enableTelemetry?: boolean;              // ship to Talsec watcher mail (opt-in)
  },
) => GuardianHandle;

// Per-threat selectors as React hooks (subscribe-fine-grained)
export const useThreatHandler = <Id extends ThreatId>(
  id: Id,
  handler: (e: ThreatEventOf<Id>) => void,
  deps?: React.DependencyList,
): void;

// Lower-level imperative API
export const guardian = {
  start, stop, isRunning,
  setExternalId, getExternalId, removeExternalId,
  blockScreenCapture, isScreenCaptureBlocked,
  on, off,                          // event-emitter style
  getEvidence,                      // pull evidence for the last threat of an id
  registerCustomEngine,             // host-supplied JS-implemented engine
};

// Type-safe action map (back-compat with freerasp-rn shape)
export const useThreatActions = (actions: ThreatActions): void;
```

`GuardianHandle` is a stable object across renders (returned from a memoised internal store), so consumers can pass it down without re-mounting causing churn.

### 3.1 Multi-instance JS hygiene (G3)

Internal state lives in a **module-level singleton store** (Zustand-style) but distinguishes:

- **Engine state**: `started | running | degraded | stopped` — singleton per process.
- **Subscribers**: `Map<subscriberId, Filter>` where each `useGuardian` mount registers a UUID. Native dispatches once; the JS bus fans out to all matching subscribers. Unmounting decrements the refcount; the engine stops only when refcount hits zero (or a `stopOnUnmount: false` flag is set, which is the recommended default for app-wide protection).

Race-free because:
- Subscriber ID is created in `useState` initializer (stable across renders, fresh per mount).
- `useEffect` registers/unregisters with the store; the store de-dupes engine start.
- Action handlers are kept in a `useRef` so the **stale-closure bug (W3)** is gone — the latest handler is always invoked.

```tsx
// Inside library
export const useGuardian = (config, options) => {
  const handlers = useRef(options);
  handlers.current = options;       // always-fresh ref

  const subId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    store.attach(subId, config, () => handlers.current);
    return () => store.detach(subId);
  }, [subId, hashConfig(config)]);
  // …
};
```

---

## 4. File / Module Layout

```
guardian-rn/
├── src/
│   ├── specs/                        # codegen specs (TurboModule contract)
│   │   ├── NativeGuardian.ts
│   │   └── NativeGuardianHost.ts     # JSI host-object surface
│   ├── schema/
│   │   ├── threats.schema.json
│   │   └── config.schema.json
│   ├── codegen/                      # generated TS / Kotlin / Swift
│   │   └── (gitignored, regenerated by `yarn codegen`)
│   ├── core/
│   │   ├── store.ts                  # Zustand store (subscribers, engine state)
│   │   ├── verifier.ts               # HMAC envelope verification
│   │   ├── policy.ts                 # ResponsePolicy implementations
│   │   ├── telemetry.ts              # opt-in shipping to host observability
│   │   └── engine-state-machine.ts
│   ├── hooks/
│   │   ├── useGuardian.ts
│   │   ├── useThreatHandler.ts
│   │   └── useThreatActions.ts       # back-compat shim for freerasp-rn shape
│   ├── api/
│   │   ├── guardian.ts               # imperative facade
│   │   └── adapters/
│   │       ├── sentry.ts
│   │       ├── datadog.ts
│   │       └── firebase.ts
│   ├── types/                        # public types (re-exported from codegen)
│   ├── compat/
│   │   └── freerasp-rn.ts            # drop-in shim for existing useFreeRasp callers
│   └── index.ts
│
├── android/src/main/java/com/guardian/
│   ├── GuardianModule.kt             # TurboModule entry
│   ├── GuardianHostObject.kt         # JSI host-object
│   ├── engine/
│   │   ├── Engine.kt                 # interface
│   │   ├── EngineRegistry.kt
│   │   ├── TalsecEngineAdapter.kt    # opt-in Talsec adapter
│   │   ├── CommunityEngine/
│   │   │   ├── RootDetector.kt
│   │   │   ├── DebuggerDetector.kt
│   │   │   ├── EmulatorDetector.kt
│   │   │   └── HookDetector.kt
│   ├── bus/ThreatBus.kt              # SharedFlow(replay=32, conflate)
│   ├── crypto/SessionKey.kt          # Keystore / EncryptedSharedPrefs
│   ├── crypto/Hmac.kt
│   ├── lifecycle/LifecycleAwareDispatcher.kt
│   ├── screen/ScreenProtector.kt     # API 34/35, multi-activity safe
│   └── codegen/                      # generated sealed classes (gitignored)
│
├── ios/Sources/Guardian/
│   ├── GuardianModule.swift          # TurboModule entry
│   ├── GuardianHostObject.swift      # JSI host-object via React-Codegen
│   ├── Engine/
│   │   ├── Engine.swift
│   │   ├── EngineRegistry.swift
│   │   ├── TalsecEngineAdapter.swift
│   │   └── CommunityEngine/
│   ├── Bus/ThreatBus.swift           # AsyncStream-backed
│   ├── Crypto/SessionKey.swift       # Keychain SecItem
│   ├── Crypto/Hmac.swift
│   ├── Lifecycle/SceneAwareDispatcher.swift
│   ├── Screen/ScreenProtector.swift  # multi-scene, multi-window
│   └── Codegen/
│
├── plugin/                           # Expo
│   └── src/
│       ├── ios.ts                    # multi-scene plist, NSAppTransportSec, etc.
│       └── android.ts                # Talsec maven (opt-in), permissions
│
├── tests/
│   ├── unit/                         # Jest
│   ├── e2e/                          # Detox
│   └── android/                      # JUnit + Robolectric
│
├── docs/
│   ├── threat-model.md               # G13
│   ├── adopting-from-freerasp.md
│   ├── engines.md
│   └── policy-recipes.md
│
└── package.json
```

---

## 5. Key Design Details

### 5.1 Lifecycle correctness (Android)

- Replace the `lateinit var listener` in `ThreatDispatcher` with a `MutableSharedFlow<ThreatEnvelope>(replay = 32, onBufferOverflow = SUSPEND)`. Subscribers `collect` from the flow inside their own `CoroutineScope` tied to the React context's lifecycle. No singleton-listener overwrite (W17).
- Replay buffer of 32 covers the realistic case of a JS bundle that takes 1–2s to attach. Old events are not dropped silently; they are replayed in order.
- Foreground gating becomes a `combine(flow, foregroundFlow) { event, fg -> if (fg) emit else cache }` — declarative and testable.

```kotlin
class ThreatBus {
    private val _events = MutableSharedFlow<ThreatEnvelope>(replay = 32)
    val events: SharedFlow<ThreatEnvelope> = _events.asSharedFlow()
    suspend fun emit(e: ThreatEnvelope) = _events.emit(e)
}
```

### 5.2 Multi-scene iOS (G11)

```swift
final class ScreenProtector {
    // Per-scene blocking state, indexed by UISceneSession.persistentIdentifier
    private var perScene: [String: SceneState] = [:]

    func block(enable: Bool, sceneId: String?) {
        // Walk *all* connected scenes if sceneId is nil
        let scenes = sceneId.flatMap(sceneById) ?? UIApplication.shared.connectedScenes
        for case let ws as UIWindowScene in scenes {
            ws.windows.forEach { applyBlock(on: $0, enable: enable) }
            perScene[ws.session.persistentIdentifier]?.enabled = enable
        }
    }
}
```

The TurboModule spec accepts an optional `sceneId` so apps with multi-window Mac Catalyst / iPad split-view can address a specific scene; default behaviour is "all scenes".

### 5.3 Encrypted external-ID storage (G12)

```swift
// iOS — Keychain-backed
let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: "app.guardian.externalid",
    kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    kSecValueData: data,
]
SecItemAdd(query as CFDictionary, nil)
```

```kotlin
// Android — EncryptedSharedPreferences
val prefs = EncryptedSharedPreferences.create(
    context, "guardian-secure",
    MasterKey.Builder(context).setKeyScheme(AES256_GCM).build(),
    PrefKeyEncryptionScheme.AES256_SIV, PrefValueEncryptionScheme.AES256_GCM
)
```

`getExternalId()` returns `null` on missing-key (no exception path that could leak via timing). Migration: detect plaintext `UserDefaults`/SharedPreferences value, copy into Keychain/EncryptedPrefs, delete plaintext.

### 5.4 No-vendor-required builds (G10)

- The Talsec adapter is split into its own optional package: `@guardian/engine-talsec`. Apps that don't install it never touch Talsec's maven.
- The community engine has zero closed-source dependencies and is published from npm with the source.
- Threat-feed updates (e.g., new malware hashes) ship via a signed JSON bundle from a CDN with reproducible-build verification (signature pinned to a public key embedded at compile time). The host can opt out of remote updates entirely (`engines: { community: { remoteUpdates: false } }`).

### 5.5 Telemetry seam (G6)

```ts
guardian.telemetry.use([
  guardianAdapters.sentry({ dsn: SENTRY_DSN, sampleRate: 1.0 }),
  guardianAdapters.datadog({ rum: rum }),
  // host-defined
  (event) => fetch('/api/sec', { method: 'POST', body: JSON.stringify(event) }),
]);
```

Adapters are simple `(ThreatEvent) => void` functions. Backpressure is handled by the bus (replay buffer + conflation by `(threatId, severity)` within a 250ms window).

### 5.6 Compat shim for `freerasp-react-native` users

```ts
// src/compat/freerasp-rn.ts
import { useGuardian } from '../hooks/useGuardian';
import type { TalsecConfig, ThreatEventActions } from './freerasp-types';

export const useFreeRasp = (
  config: TalsecConfig,
  actions: ThreatEventActions,
  raspExecutionStateActions?: { allChecksFinished?: () => void },
) => {
  useGuardian(translateConfig(config), {
    engines: ['talsec'],         // adapter routes to original Talsec SDK
    onThreat: (e) => {
      const cb = (actions as any)[e.id];
      if (typeof cb === 'function') cb(e.evidence?.suspiciousApps ?? undefined);
    },
    onState: (s) => {
      if (s === 'running') raspExecutionStateActions?.allChecksFinished?.();
    },
  });
};
```

A single import-replacement (`freerasp-react-native` → `guardian-rn/compat/freerasp-rn`) gets existing apps onto the new platform with zero behaviour change. This addresses adoption friction.

---

## 6. Threat Model (Summary — see `docs/threat-model.md` for full)

**In scope:**
- An attacker on a rooted/jailbroken device attempting to instrument the app with Frida/Xposed.
- An attacker statically analysing the JS bundle to find hook points.
- An attacker in a hostile network injecting fake bridge messages.
- A malicious app on the same device attempting to read `externalId` from disk.

**Out of scope:**
- An attacker who fully owns the device kernel and can swap binary signatures (game over by definition).
- Side-channel attacks against the HMAC implementation (TLS-class timing leaks).

**Assets:**
- `sessionKey` (HMAC key) — must never leave process memory; never serialised via legacy bridge.
- `externalId` — encrypted at rest.
- Threat events themselves — integrity, not confidentiality.

**Mitigations map** to design sections — bridge HMAC (5.1, G7), encrypted storage (5.3, G12), multi-engine corroboration (G4), graceful response (G8), pluggable telemetry (G6), and codegen-removed-coupling for fewer implementation bugs (G2).

---

## 7. Migration Path from `freerasp-react-native`

**Phase 0 — wrap (zero code change for consumers):**
- Publish `guardian-rn` 0.1 with the `compat/freerasp-rn` shim and only the Talsec adapter.
- Existing apps replace the npm dep; no API changes.

**Phase 1 — add value (opt-in):**
- Apps adopt `useGuardian` directly to get severity/evidence/multi-engine.
- Community engine ships as `engines: ['community']`; can run alongside Talsec.

**Phase 2 — replace (optional):**
- Apps that don't need Talsec drop the adapter; community engine becomes default.
- Remote signed threat-feed handles the "weekly bypass tools" cadence problem without a new release.

---

## 8. Quantitative Targets (proposed SLOs)

| Metric | Target |
|---|---|
| Cold-start overhead (release build, mid-range Android) | < 30 ms before first frame |
| Threat-fire-to-JS-handler latency | p99 < 5 ms |
| Memory footprint | < 6 MB resident |
| New-threat onboarding (PR → release) | < 1 calendar day (single-file schema change) |
| False-positive rate per release | < 0.1% of installs |
| Test coverage | > 85% line, 100% of public surface |
| New-Architecture compatibility | RN 0.74 → current |

---

## 9. Comparison Table — `freerasp-react-native` vs `guardian-rn`

| Dimension | freerasp-react-native | guardian-rn |
|---|---|---|
| RN architecture | Legacy bridge only | TurboModule + JSI |
| Type safety on events | Loose `NativeEvent` + 22-arm switch | Codegen ADT, exhaustive switch checked at compile |
| Multi-instance JS | Singleton; second mount races | Refcounted store, per-mount subscribers |
| Threat metadata | id only | id + severity + confidence + evidence + sessionId + seq |
| Bridge integrity | Random IDs (static obscurity) | Random IDs **+** HMAC envelope (active integrity) |
| Detection engine | Talsec (closed-source binary, vendor-locked) | Pluggable: community (OSS), Talsec, Promon, custom |
| Self-protection | `abort()` / `killProcess` | Configurable policy (telemetry/restrict/lockout/kill) |
| iOS multi-scene | First scene only | Per-scene addressable |
| External ID storage | iOS UserDefaults plaintext | Keychain / EncryptedSharedPreferences |
| Telemetry | Talsec watcher email only | Pluggable adapters (Sentry/Datadog/custom) + opt-in Talsec |
| Test surface | None | Jest + JUnit + XCTest + Detox |
| Adding a threat | 5+ files, manual order alignment | 1 schema file, codegen does the rest |
| Vendor maven dep | Required | Optional (only if Talsec adapter installed) |
| New-arch ready | No | Yes |
| Threat model published | No | Yes (in repo) |

---

## 10. Risks of the New Design

Honest accounting of where `guardian-rn` could go wrong:

- **More moving parts** → higher cognitive cost. Mitigation: the `useGuardian` hook is intentionally as simple as `useFreeRasp`; complexity hides behind defaults.
- **Community engine quality risk** — without the Talsec heuristics catalogue, the OSS engine may have higher FP rate. Mitigation: ship as opt-in initially; recommend Talsec adapter for production fintech until community engine reaches parity (tracked publicly).
- **HMAC key distribution risk** — if JSI is somehow circumvented, the key falls back through bridge. Mitigation: hard-fail (refuse to start) if JSI HostObject install fails, rather than silently downgrade.
- **Adopter friction** — TurboModule requires RN ≥ 0.68 for codegen; older apps need to upgrade. Mitigation: legacy bridge fallback published as a separate `guardian-rn-legacy` for apps stuck on RN < 0.68 (best-effort, no JSI features).
- **Maintenance** — multi-engine + multi-platform multiplies test matrix. Mitigation: CI matrix ([RN 0.74, 0.75, 0.76] × [iOS 16/17/18, Android 9/12/14/15]) baked in from day one; test pyramid heavy at unit, light at E2E.

---

## 11. What Stays the Same

Worth being explicit about what **not** to change, because freerasp-rn got these right:

- The **single-hook ergonomic** (`useFreeRasp` → `useGuardian`).
- The **cache-and-replay** dispatcher pattern (we just upgrade the storage primitive).
- The **per-process random identifiers** as one layer of static obscurity.
- The **Expo plugin** auto-injecting maven repos (we just make Talsec opt-in).
- The **lazy app-icon retrieval** for malware payloads.
- The **lifecycle-aware foreground gating** on Android.
- The **closed-source-engine as commercial seam** — adapters keep this option open without forcing it.

---

## 12. TL;DR

`guardian-rn` keeps everything `freerasp-react-native` does well — the hook ergonomics, the random-ID protocol, the cache-and-replay dispatcher, the Expo plugin — and rebuilds the rest on a foundation that is **type-safe end-to-end (codegen)**, **integrity-checked (HMAC bridge)**, **multi-instance correct (refcounted store)**, **vendor-pluggable (engine adapters)**, **scene-aware on iOS**, **encrypted at rest for `externalId`**, **graceful by default (response policies, never `abort()` for honest users)**, and **tested (Jest/JUnit/XCTest/Detox)**. A drop-in compat shim makes adoption a one-line dependency swap, and the Talsec adapter preserves access to the commercial detection engine for shops that want it. Net result: the same security posture with measurably higher engineering quality, lower vendor risk, and a much faster path to shipping new threat detections.

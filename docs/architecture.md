# Guardian-RN — Detailed Architecture

> **Grounded in:** *Mobile Apps Engineering Design, Development, Security, and Testing* (Kouadri Mostefaoui & Tariq, CRC Press 2019) §§ 1–2 (security lifecycle, threat taxonomy, TEE/TrustZone, MDAM frameworks, BYOD schemes) and the guardian-rn implementation (Phases 1–8).

---

## Part I — Guardian-RN as a Standalone SDK

### 1. Layered Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║  PUBLIC JS / TYPESCRIPT API                                              ║
║                                                                          ║
║   useGuardian(config)          useThreatHandler(handlers)                ║
║   GuardianConfig / ThreatId    CompatLayer (fromTalsecConfig)            ║
╠══════════════════════════════════════════════════════════════════════════╣
║  POLICY & ROUTING LAYER                                                  ║
║                                                                          ║
║   PolicyEngine                 SubscriberStore                           ║
║     DEFAULT_POLICIES             ref-counted dispatch                    ║
║     kill-timer dedup             crash-isolated handlers                 ║
║     confidence thresholds      EventBus                                  ║
║     (restrict 0.5 / lock 0.7 /   100 ms dedup window                    ║
║      kill 0.9)                   50 events/s per-engine cap              ║
║                                  HMAC-SHA256 envelope verify             ║
╠══════════════════════════════════════════════════════════════════════════╣
║  ENGINE ORCHESTRATION LAYER                                              ║
║                                                                          ║
║   Engine interface               EngineRegistry                          ║
║     start(ctx) / stop()            parallel start/stop                   ║
║     onThreat: Observable<…>        duplicate-ID guard                    ║
║     onHealthTick: Observable<…>  CommunityEngine                         ║
║       (≤60 s interval)             Promise.allSettled detector fan-out   ║
║                                    confidence gate ≥0.5                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  DETECTION LAYER  (runs per-engine scan cycle)                           ║
║                                                                          ║
║   RootDetector       DebuggerDetector    EmulatorDetector                ║
║   JailbreakDetector  HookDetector        TamperDetector                  ║
║   (community-tier open-source; premium-tier adds: malware, screen caps,  ║
║    location spoofing, network MiTM, clipboard hijack, …)                 ║
╠══════════════════════════════════════════════════════════════════════════╣
║  CRYPTOGRAPHIC ENVELOPE LAYER                                            ║
║                                                                          ║
║   SessionKeyProvider             CanonicalJson (RFC 8785 JCS)            ║
║     one-call-only delivery         deterministic serialisation           ║
║     compare_exchange_strong        no whitespace, sorted keys            ║
║   HMAC-SHA256 signer/verifier    SequenceTracker                         ║
║     per-session key from            monotonic uint32                     ║
║     AndroidKeyStore / iOS           replay-window guard                  ║
║     SecRandomCopyBytes                                                    ║
╠══════════════════════════════════════════════════════════════════════════╣
║  JSI / NATIVE BRIDGE LAYER                                               ║
║                                                                          ║
║   TurboModule (New Architecture)   codegen from JSON Schema              ║
║   JSI HostObject                   no legacy Bridge dependency           ║
╠══════════════════════════════════════════════════════════════════════════╣
║  PLATFORM NATIVE LAYER                                                   ║
║                                                                          ║
║  Android                           iOS                                   ║
║   EncryptedStorageManager           KeychainStorageManager               ║
║     EncryptedSharedPrefs              kSecAttrAccessible                 ║
║     AES-256-GCM MasterKey               AfterFirstUnlock                 ║
║                                           ThisDeviceOnly                 ║
║   ScreenCaptureProtector            SceneAwareScreenProtector            ║
║     FLAG_SECURE all Activities        UIBlurEffect overlay               ║
║     API 34 registerScreen-            all UIWindowScenes                 ║
║       CaptureCallback                 willResignActive /                  ║
║                                        didBecomeActive                   ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

### 2. Security Lifecycle Mapping

We define a three-phase mobile security lifecycle: **Prevention → Monitoring → Reaction / Mitigation**. Guardian-RN maps directly onto this model.

#### 2.1 Prevention

Prevention limits attack surface before any hostile event occurs.

| Concept | Guardian-RN implementation |
|---|---|
| OS sandboxing / process isolation | SDK runs inside the RN process; no cross-process surface is exposed |
| TEE-backed key storage | `AndroidKeyStore` hardware-backed AES-256-GCM key; iOS `SecRandomCopyBytes` in Secure Enclave–eligible keychain |
| Permission minimisation | No manifest permissions declared beyond what individual detectors explicitly need; `EncryptedStoragePort` interface isolates storage from detection logic |
| Screen-data leakage prevention | `FLAG_SECURE` + `registerScreenCaptureCallback`; `UIBlurEffect` overlay on scene transitions — prevents an attacker passively screen-recording session data without triggering an event |
| Supply-chain integrity | GitHub Actions provenance attestation (`--provenance`) on every npm publish; lock-file in repo |
| HMAC envelope on all cross-layer events | Each `ThreatEvent` crossing the internal EventBus carries an HMAC-SHA256 signature over the canonical JSON payload; an attacker who spoofs a bus message cannot forge a valid HMAC without the per-session key |

#### 2.2 Monitoring

Monitoring is the continuous detection pipeline that runs during app execution.

| Concept | Guardian-RN implementation |
|---|---|
| Runtime integrity checks | CommunityEngine scans all 6 detectors every cycle via `Promise.allSettled`; faults are surfaced through `onFault` without crashing the scan loop |
| Continuous health telemetry | Every engine must emit `onHealthTick` at ≤60 s intervals; silence is observable. `useGuardian` forwards ticks to `config.telemetry.recordHealthTick` |
| Confidence-scored signals | Detectors return `{ detected, confidence }`. Only signals at confidence ≥ 0.5 leave the engine layer; the PolicyEngine applies tighter thresholds (0.5 / 0.7 / 0.9) per action class |
| Replay / duplicate attack prevention | `SequenceTracker` enforces monotonic uint32; 100 ms dedup window in EventBus suppresses burst duplicates; 50 events/s rate cap prevents resource-exhaustion from a rogue engine |
| IDS/IDPS analogy | PolicyEngine is the guardian-rn equivalent of a mobile IDPS: it matches events to policies, issues graded responses (telemetry, restrict, lockout, kill), and can be operated in shadow-mode (all actions → telemetry only) during roll-out |

#### 2.3 Reaction / Mitigation

When a threat exceeds the kill threshold, the SDK must respond without creating denial-of-service risk against honest users.

| Concept | Guardian-RN implementation |
|---|---|
| Graduated response | Three tiers: restrict (degrade UX, 0.5 threshold) → lockout (block session, 0.7) → kill (terminate process, 0.9). Host app owns the response implementation |
| Grace-period kill | `killPolicy.graceMs` delays process termination to allow UX messaging; `cancelPendingKills()` ensures cleanup on unmount so tests and CI aren't killed |
| Kill-timer deduplication | `PolicyEngine.killTimers: Map<ThreatId, Timer>` — a second identical threat during the grace window does not restart the timer |
| MDAM integration point | `config.telemetry` interface is the seam for a Mobile Device/App Management backend (Intune, JAMF, VMware Workspace ONE) to receive structured health and threat data without changes to the SDK |
| Post-incident reporting | All events carry `sessionId`, `ts` (epoch), and `threatId`; an injected `telemetry` adapter can forward these to SIEM/ELK without SDK changes |

---

### 3. Threat Taxonomy Coverage

We classify mobile threats across seven attack vectors. The table below maps each to current and planned guardian-rn coverage.

| Book threat vector | Specific attack | Covered by | Status |
|---|---|---|---|
| **Compromised OS** | Root (Magisk, KernelSU, Dopamine) | `RootDetector`, `JailbreakDetector` | Community tier |
| **Dynamic instrumentation** | Frida, Xposed, Cydia Substrate hooks | `HookDetector` | Community tier |
| **Dynamic instrumentation** | Attached debugger, Android Debug Bridge | `DebuggerDetector` | Community tier |
| **Tampered execution environment** | Emulator / simulator | `EmulatorDetector` | Community tier |
| **Repackaging / supply chain** | Resigned APK, modified bundle | `TamperDetector` | Community tier |
| **Data exfiltration** | Screenshot, screen recording | `ScreenCaptureProtector` / `SceneAwareScreenProtector` | Native layer (prevention) |
| **Data exfiltration** | Screen mirroring | `SceneAwareScreenProtector` scene-blur | Native layer (prevention) |
| **Malware** | Hostile co-installed app, PHA | Planned premium engine | Road-map |
| **Social engineering** | Phishing overlay, notification hijack | Planned premium engine | Road-map |
| **USB / physical access** | ADB sideload, backup extraction | `DebuggerDetector` (partial) | Community tier |
| **Network / Internet** | MiTM certificate pinning bypass, SSL strip | Planned premium engine | Road-map |
| **NFC / Bluetooth / contactless** | Relay attack, tag cloning | Host-app responsibility | Out of scope |
| **Identity / fraud** | Device cloning, location spoofing | Planned premium engine | Road-map |

---

### 4. Cryptographic Trust Chain

```
  Process start
       │
       ▼
  SessionKeyProvider
  ┌─────────────────────────────────────────────────────────────┐
  │  Android                        iOS                         │
  │  AndroidKeyStore.generate()     SecRandomCopyBytes(32)      │
  │  hardware-backed AES key        32-byte secret in RAM       │
  │  atomic compare_exchange        atomic compare_exchange     │
  │  → one-call-only delivery       → one-call-only delivery    │
  └─────────────────────────────────────────────────────────────┘
       │   session key (delivered once)
       ▼
  Detector emits DetectorResult
       │
       ▼
  CommunityEngine wraps into ThreatEvent
       │
       ▼
  EventBus.publish()
  ┌───────────────────────────────────────┐
  │  canonicalJson(payload)  ← RFC 8785   │
  │  HMAC-SHA256(key, canonical)          │
  │  seq++  (uint32, monotonic)           │
  │  envelope = {payload, hmac, seq, ts}  │
  └───────────────────────────────────────┘
       │
       ▼
  EventBus.subscribe() consumer
  ┌───────────────────────────────────────┐
  │  verify HMAC                          │
  │  verify seq > last_seen               │
  │  verify ts within replay window       │
  │  → ok:true  or drop silently          │
  └───────────────────────────────────────┘
       │
       ▼
  PolicyEngine.apply(event)
       │
       ├─ confidence < 0.5  → telemetry only
       ├─ 0.5 ≤ conf < 0.7 → onRestrict
       ├─ 0.7 ≤ conf < 0.9 → onLockout
       └─ conf ≥ 0.9       → onKill (+ grace timer)
```

The chain guarantees that no event reaching the PolicyEngine can have been injected by a process-local attacker who lacks the session key. The one-call-only delivery via `compare_exchange_strong` means the key cannot be retrieved by a second caller after initial handshake — even from within the same process via reflection.

---

### 5. CompatLayer (Migration Seam)

The `CompatLayer` (`src/compat/freerasp-rn.ts`) is a first-class architectural component, not an afterthought. It implements the adapter pattern over the freerasp-rn v4.x API surface.

```
TalsecConfig  ──► fromTalsecConfig() ──► GuardianConfig
{                                        {
  iosConfig,                               tenantId,
  androidConfig,                           engines,     ← caller supplies
  watcherMail,                             actions,     ← fromFreeRaspListeners()
  isProd,                                  policies,    ← isProd-gated
  listeners { onRootDetected, … }          telemetry?
}                                        }
```

`fromFreeRaspListeners` maps all 16 named freerasp listener properties to the 22 canonical `ThreatId`s, leaving unmapped IDs as no-ops rather than throwing. This ensures a freerasp-rn consumer can switch engines (closed-source → community open-source) by changing one line of configuration with zero handler rewrites.

---

### 6. Extensibility Contracts

The SDK defines three explicit extension points.

| Extension point | Interface / location | Purpose |
|---|---|---|
| Custom engine | `Engine` interface (`src/engine/Engine.ts`) | Add a premium, enterprise, or domain-specific detection engine without touching SDK internals |
| Telemetry sink | `TelemetryAdapter` (`config.telemetry`) | Forward health ticks and threat events to any observability backend (ELK, Datadog, Sentry, JAMF, Intune) |
| Encrypted storage | `EncryptedStoragePort` (`src/storage/`) | Swap AES-GCM storage for a hardware-security-module backend in regulated environments |

The `Engine` interface contract (ADR-0004) requires:
- `start(ctx)` is idempotent — calling it twice must not double-subscribe
- `stop()` is idempotent — calling it on an already-stopped engine must be a no-op
- `onHealthTick` must emit at least once per 60 seconds; silence is treated as a fault
- Detectors must not throw — exceptions must be caught and surfaced via `ctx.onFault`

---

## Part II — Guardian-RN as Part of a Larger Mobile App

### 7. Full-Stack React Native App Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║  UI LAYER                                                                ║
║                                                                          ║
║   React Native screens / navigators  (React Navigation, Expo Router)    ║
║   Lockout screen / session-degraded modal  ← driven by guardian actions ║
║   Screen-obscured placeholder  ← driven by FLAG_SECURE / UIBlurEffect   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  APPLICATION STATE & BUSINESS LOGIC                                      ║
║                                                                          ║
║   Auth service (biometrics, OAuth, PKCE)                                 ║
║   Feature flags / access control                                         ║
║   Crash reporting (Sentry, Crashlytics)                                  ║
║   Analytics (Amplitude, Mixpanel)                                        ║
╠══════════════════════════════════════════════════════════════════════════╣
║  GUARDIAN-RN SDK  ← this is where the SDK is mounted                    ║
║                                                                          ║
║   useGuardian(config)  (in a high-mount, always-rendered component)      ║
║   useThreatHandler(handlers)  (in screens that need per-threat response) ║
║   PolicyEngine  →  actions injected from app layer                       ║
║   TelemetryAdapter  →  forwards to app's own observability stack         ║
╠══════════════════════════════════════════════════════════════════════════╣
║  REACT NATIVE RUNTIME                                                    ║
║                                                                          ║
║   Hermes JS engine       Metro bundler                                   ║
║   New Architecture JSI   TurboModules / Fabric renderer                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  OPERATING SYSTEM                                                        ║
║                                                                          ║
║  Android                           iOS                                   ║
║   Activity / Fragment lifecycle     UIViewController / UIScene           ║
║   AndroidKeyStore TEE               Secure Enclave / Keychain            ║
║   SEAndroid mandatory access ctrl   iOS sandbox / entitlements           ║
║   DAC uid/gid process isolation     App Store signing / notarisation     ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

### 8. Mount Point and Lifecycle Integration

Guardian-RN must be mounted **above** any conditional navigation or authentication gate so that security monitoring begins before the user reaches any sensitive screen.

```tsx
// App.tsx — recommended mount topology
export function App() {
  const guardianConfig = useGuardianConfig();   // derive from env / remote config
  useGuardian(guardianConfig);                  // starts all engines on mount

  return (
    <AuthProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
```

**Why above AuthProvider?** The book (§1.3) notes that the security lifecycle must begin during the prevention phase, before any user credential is presented. Mounting below an auth gate means an attacker who bypasses auth never triggers the RASP instrumentation.

**Lifecycle interactions:**

| App event | Guardian-RN behaviour |
|---|---|
| Component mount | `useGuardian` `useEffect` fires: all engines start in parallel via `Promise.allSettled`; PolicyEngine instantiated |
| Re-render with new config | `configRef.current` updated atomically — no re-subscription; always-fresh config at call-time |
| App to background | Platform native layer: Android `LifecycleEventListener.onPause` gates threat dispatch; iOS scene observers fire `willResignActive` → blur overlay applied |
| App to foreground | Android flush; iOS overlay removed on `didBecomeActive` |
| Component unmount | Cleanup: `policyEngine.cancelPendingKills()`, all `onThreat` / `onHealthTick` subscriptions unsubscribed, all `engine.stop()` called |

---

### 9. MDAM / Enterprise Integration

We define a Mobile Device and App Management (MDAM) framework as the enterprise control plane sitting above individual app security. Guardian-RN is designed to be a MDAM-aware sensor.

```
┌──────────────────────────────────────────────────────────┐
│  MDAM Control Plane (Intune / JAMF / Workspace ONE)      │
│                                                          │
│   Policy push  ◄──────────────────────────────────────  │
│   Compliance report  ◄────── TelemetryAdapter ─────────  │
│   Remote wipe trigger  ◄──────────────────────────────  │
└──────────────────────┬───────────────────────────────────┘
                       │  MDM profile / policy
                       ▼
          ┌────────────────────────┐
          │  Guardian-RN SDK       │
          │  config.telemetry      │──► POST /api/guardian/events
          │  (MDAMTelemetryAdapter)│       { sessionId, threatId,
          └────────────────────────┘         confidence, ts, platform }
```

Implementing a MDAM integration requires only an injected `TelemetryAdapter`:

```ts
// Illustrative MDAM adapter — no SDK changes required
const guardianConfig: GuardianConfig = {
  tenantId: 'my-enterprise',
  engines: [communityEngine],
  actions: {
    onRestrict: (event) => Navigation.navigate('AccessDegradedScreen', { event }),
    onLockout: (event) => Navigation.navigate('SessionLockedScreen', { event }),
    onKill: (event) => console.error('[guardian] kill:', event),
  },
  telemetry: {
    recordHealthTick: (tick) => MDAMClient.sendHealthTick(tick),
  },
};
```

The book's MDAM framework (§1.4.3) distinguishes four BYOD schemes. Guardian-RN's `tenantId` field carries the device-ownership context so the backend can apply different policies:

| BYOD scheme | Policy implication for guardian-rn |
|---|---|
| COCE (Corporate-Owned, Corporate-Enrolled) | Full kill policy enabled; all detectors active; strict telemetry forwarding |
| COPE (Corporate-Owned, Personally-Enabled) | Kill policy enabled; screen-capture protection mandatory; user-facing lockout messages |
| POCE (Personally-Owned, Corporate-Enrolled) | Kill policy optional; shadow-mode telemetry preferred to avoid surprising personal-use sessions |
| POPE (Personally-Owned, Personally-Enrolled) | SDK provides telemetry-only mode; kill disabled by corporate policy |

---

### 10. Trusted Execution Environment (TEE) Integration

We identify the TEE as the hardware root-of-trust for key material and sensitive computations. Guardian-RN integrates with platform TEEs at two points.

```
┌─────────────────────┐      ┌──────────────────────────────────────┐
│  Android            │      │  iOS                                 │
│                     │      │                                      │
│  TrustZone (ARM)    │      │  Secure Enclave (Apple T2/M-series)  │
│   ├─ TEE OS (OP-TEE │      │   ├─ Keychain item                   │
│   │   or proprietary│      │   │   kSecAttrAccessible             │
│   │   e.g. Kinibi)  │      │   │   AfterFirstUnlock               │
│   └─ AndroidKeyStore│      │   │   ThisDeviceOnly                 │
│       hardware-     │      │   └─ SecRandomCopyBytes (CSPRNG)     │
│       backed key    │      │       feeds SessionKeyProvider        │
│       AES-256-GCM   │      │                                      │
└─────────────────────┘      └──────────────────────────────────────┘
         │                                  │
         └──────────────┬───────────────────┘
                        ▼
             SessionKeyProvider (TS)
              one-call-only delivery
              compare_exchange_strong
                        │
                        ▼
             HMAC-SHA256 on every
             cross-layer ThreatEvent
```

The session key never leaves the TEE-backed storage layer in plaintext. The `EncryptedStoragePort` interface ensures that a future premium engine can escalate to full TEE-computed HMAC (via Android Keystore `Mac` provider or iOS `SecKeyCreateSignature`) without touching the engine contract.

---

### 11. Navigation Integration Patterns

Guardian-RN's action handlers bridge the SDK's event model to the app's navigation layer.

#### Pattern A — Global lockout screen

```
PolicyEngine.onLockout
    │
    ▼
Navigation.reset({ routes: [{ name: 'SessionLocked' }] })
    │
    ▼
<SessionLockedScreen>
  "Your session has been locked due to a security event."
  [Re-authenticate]  →  resumes normal navigation stack
```

#### Pattern B — Per-screen threat handling

```tsx
// Screens handling their own threat context (e.g. a payment screen)
function PaymentScreen() {
  useThreatHandler({
    root: () => Alert.alert('Secure payment unavailable on rooted devices'),
    hooks: () => Navigation.goBack(),
  });
  // ... payment UI
}
```

#### Pattern C — Degraded-mode UX

```
PolicyEngine.onRestrict (confidence 0.5–0.69)
    │
    ▼
featureFlags.set('highValueTransactions', false)
    │
    ▼
UI renders degraded state without revealing the security reason
(defence-in-depth: attacker learns less from the UX than from an error message)
```

---

### 12. Multi-Engine Orchestration in an App Context

An app may run engines at different privilege levels simultaneously.

```
App startup
     │
     ├─► CommunityEngine.start()       ← free tier, runs always
     │     6 detectors, 30-second scan cycle
     │
     ├─► EnterpriseEngine.start()      ← premium tier, licensed
     │     malware list (cloud-updated), location spoofing, MiTM
     │     higher scan frequency, network-dependent detectors
     │
     └─► CustomDomainEngine.start()    ← app-specific
           e.g. game: cheat-detection engine
           e.g. banking: transaction-signing integrity check
```

`EngineRegistry` starts all three in parallel and registers their `onThreat` and `onHealthTick` subscriptions. The same `PolicyEngine` receives events from all engines — threat ID namespacing in `ThreatId` (generated by codegen from the JSON Schema) prevents collisions across engine tiers.

---

### 13. Observability Architecture

```
Guardian-RN SDK
      │
      ├─── onHealthTick ──────────────► TelemetryAdapter.recordHealthTick()
      │     { engineId, ts,              │
      │       status: 'ok'|'fault',      ├──► Datadog / Prometheus push metric
      │       detectorResults[] }        └──► MDAM compliance feed
      │
      └─── onThreat ──────────────────► TelemetryAdapter (optional)
            { threatId, confidence,       │
              sessionId, ts, platform }   ├──► Sentry.captureEvent()  (non-PII)
                                          ├──► Crashlytics breadcrumb
                                          └──► ELK / SIEM ingest

Health monitoring contract:
  - Engine silent for > 60 s → alert: engine may have stopped
  - Engine fault rate > 5% → alert: detector reliability degradation
  - Threat confidence cluster > 0.9 across multiple sessions
    → alert: coordinated attack pattern
```

The `onHealthTick` SLO (≤60 s) means an ops team can configure a simple absent-metric alert in any time-series database to detect a guardian-rn engine crash or wedge without needing to instrument the SDK itself.

---

### 14. Trust Boundary Summary

```
╔══════════════════════════════════════════════════════╗
║  TRUSTED (SDK-controlled)                            ║
║                                                      ║
║  SessionKeyProvider  EncryptedStoragePort            ║
║  HMAC signer/verifier  SequenceTracker               ║
║  PolicyEngine  SubscriberStore                       ║
║  Platform native: AndroidKeyStore / Keychain         ║
╠══════════════════════════════════════════════════════╣
║  SEMI-TRUSTED (app-supplied, SDK-sandboxed)          ║
║                                                      ║
║  Engine implementations (custom engines)             ║
║  TelemetryAdapter (injected, no SDK side-effects)    ║
║  Terminator (injected, process-kill callback)        ║
╠══════════════════════════════════════════════════════╣
║  UNTRUSTED (host app / user space)                   ║
║                                                      ║
║  React Native UI layer                               ║
║  Navigation / auth layer                             ║
║  Third-party RN libraries                            ║
╠══════════════════════════════════════════════════════╣
║  ADVERSARIAL (threat model boundary)                 ║
║                                                      ║
║  Rooted / jailbroken OS                              ║
║  Frida / Xposed / debugger                           ║
║  Repackaged / tampered bundle                        ║
║  Co-installed malware                                ║
╚══════════════════════════════════════════════════════╝
```

The HMAC envelope on internal events ensures that a threat event cannot be injected from the semi-trusted or untrusted zone into the PolicyEngine without possession of the session key — which lives exclusively in the trusted zone.

---

## Appendix A — Design Decisions vs. Book Frameworks

| The framework | Guardian-RN design decision | Rationale |
|---|---|---|
| Security lifecycle (prevention → monitoring → reaction) | Three-phase architecture: native prevention layer, engine scan loop, policy response | Matches the book's model directly; each phase is independently replaceable |
| TEE / TrustZone as root of trust | AndroidKeyStore hardware-backed key; iOS Secure Enclave via Keychain | Cryptographic root-of-trust cannot be extracted even on a rooted device with an unlocked bootloader |
| MDAM as enterprise control plane | `TelemetryAdapter` interface; `tenantId` in config; no vendor lock-in | Host app (or MDM SDK) owns the reporting channel; guardian-rn is the sensor, not the policy database |
| Confidence-based threat classification | Three-threshold PolicyEngine (0.5 / 0.7 / 0.9) | Avoids binary pass/fail; mirrors IDS/IDPS scoring models from the book |
| BYOD ownership context | `tenantId` field; COCE/COPE/POCE/POPE policy mapping in CompatLayer | Policy must vary by device ownership; single config field is sufficient for backend differentiation |
| App sandboxing / DAC isolation | All inter-layer communication via typed interfaces; no shared mutable globals | Cannot fully sandbox within a single JS process, but interface contracts enforce separation of concerns |
| IDS/IDPS mitigation | PolicyEngine with grace-period kill, kill-timer dedup, shadow mode | Graceful response reduces false-positive UX damage; shadow mode enables safe roll-out |
| Trusted vs. untrusted execution context | HMAC-SHA256 envelope on every cross-layer event | Internal event forgery requires session key; per-session key limits blast radius of a key compromise |

# guardian-rn Threat Model

## Scope

guardian-rn is a Runtime Application Self-Protection (RASP) SDK for React Native apps.
It detects hostile runtime conditions on the device and responds with configurable policies.
It does **not** attempt to prevent determined attackers with physical device access or root privileges
from bypassing detection entirely — that is outside any software-only RASP scope.

---

## Assets

| Asset | Confidentiality | Integrity | Availability |
|---|---|---|---|
| Per-session HMAC key | Critical | Critical | High |
| ThreatPayload envelope contents | Medium | Critical | High |
| PolicyEngine kill decision | Low | Critical | High |
| Telemetry events | Medium | Medium | Medium |

---

## Threat actors

| Actor | Motivation | Capability |
|---|---|---|
| Automated cheating tool | Bypass game integrity checks | Medium (off-the-shelf tools) |
| Targeted app reverse engineer | Bypass licence or paywalls | High |
| Malware on device | Steal session tokens | Medium |
| Nation-state / advanced attacker | Surveillance bypass | Very high |

---

## Attack surface

### JS Layer

| Attack | Mitigation |
|---|---|
| Replay a valid envelope with old sequence number | SequenceTracker: replays return `SEQUENCE_REPLAY`, envelopes are dropped |
| Send a gap-injected envelope to hide a threat | SequenceTracker: `SEQUENCE_GAP` fires a fault event |
| Forge an envelope with a different HMAC | `constantTimeEqual` comparison, `HMAC_MISMATCH` → fault |
| Flood EventBus with 50 000 events/s | Per-engine rate cap (default 50/s), excess dropped |
| Subscribe multiple handlers to observe all events | Intended; no mitigation (handler isolation is responsibility of host app) |

### Native Layer (Android / iOS)

| Attack | Mitigation |
|---|---|
| Extract session key via memory dump | AndroidKeyStore / `SecRandomCopyBytes`; key never written to JS heap after delivery |
| Deliver the key twice to re-derive HMAC | `AtomicBoolean.compareAndSet` / `std::atomic<bool>.compare_exchange_strong` — one-call-only |
| Inject into JSI HostObject to intercept events | All subscriptions require a `callInvoker` hop; JSI memory is managed by Hermes GC |
| Replace native library (repackaging) | `tamper` / `repackaging` detector; HMAC of the app binary (Phase 7 full impl) |

### Supply Chain

| Attack | Mitigation |
|---|---|
| Tampered npm package | npm provenance attestation (CI signs releases via `--provenance`) |
| Compromised CI pipeline | OIDC token pinning; signed git tags required for release workflow |
| Malicious dependency update | Dependabot auto-merge is disabled; security reviews required |

---

## Trust boundaries

```
┌──────────────────────────────────────────────────────────────┐
│  Host App (JS / React Native)                                │
│  ┌─────────────────┐   ┌────────────────────────────────┐   │
│  │  useGuardian()  │   │  PolicyEngine  SubscriberStore │   │
│  └────────┬────────┘   └──────────────┬─────────────────┘   │
│           │ EventBus                  │                      │
│  ─ ─ ─ ─ ┼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ JSI Bridge ─ ─ ─ │
│           │                           │                      │
│  ┌────────▼────────────────────────── ▼ ─────────────────┐  │
│  │  Native Engine (Kotlin / Swift)                        │  │
│  │  ThreatBus  SessionKeyManager  CommunityEngine         │  │
│  └────────────────────────────────────────────────────────┘  │
│                          │                                    │
│                  AndroidKeyStore / Keychain                   │
└──────────────────────────────────────────────────────────────┘
```

The HMAC key **never crosses the JS trust boundary** after initial delivery.
All envelope verification happens on the native side before dispatch over JSI.

---

## Residual risks

1. **Hermes JIT compromise** — if an attacker can execute arbitrary code in the JS heap,
   all JS-layer controls are bypassable. Mitigation: keep Hermes up-to-date; use native-layer
   kill policy for highest-severity threats.

2. **Root with kernel-level hooking** — a fully rooted device with a kernel module
   (e.g., LKM rootkit) can suppress `/proc/self/status` `TracerPid` and file checks.
   Mitigation: multi-signal confidence scoring reduces single-vector bypass effectiveness.

3. **Supply chain via indirect dependencies** — guardian-rn has zero runtime JS dependencies
   (Node built-in `crypto` only). Indirect native dependencies (AndroidX, iOS Security.framework)
   are OS-vendor managed.

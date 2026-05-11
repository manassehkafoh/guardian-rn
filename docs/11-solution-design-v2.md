# guardian-rn v1.1.0 — Solution Design Document

**Status:** Proposed  
**Version:** 1.1.0  
**Date:** 2026-05-11  
**Authors:** Architecture team  
**Supersedes:** `docs/02-superior-solution-proposal.md` (v1.0 design)

---

## Table of Contents

1. [Document Purpose and Scope](#1-document-purpose-and-scope)
2. [Architecture Baseline Recap](#2-architecture-baseline-recap)
3. [Dependency Graph — v1.1.0 Features](#3-dependency-graph--v110-features)
4. [Cross-Cutting Concerns](#4-cross-cutting-concerns)
5. [Feature Designs](#5-feature-designs)
   - [F-01 OODAController](#f-01-oodacontroller)
   - [F-02 EventBus Fast-Path](#f-02-eventbus-fast-path)
   - [F-03 Engine.throttle(mode)](#f-03-enginethrottlemode)
   - [F-04 Signed Telemetry](#f-04-signed-telemetry)
   - [F-05 InstallationSourceDetector](#f-05-installationsourcedetector)
   - [F-06 Session Expiry](#f-06-session-expiry)
   - [F-07 BehavioralBaselineDetector](#f-07-behavioralbaselinedetector)
   - [F-08 PolicyStore](#f-08-policystore)
   - [F-09 ManagedProfileDetector](#f-09-managedprofiledetector)
   - [F-10 Security Tests](#f-10-security-tests)
   - [F-11 Scan Benchmarks](#f-11-scan-benchmarks)
   - [F-12 ThreatId Obfuscation](#f-12-threatid-obfuscation)
   - [F-13 DeviceAuthDetector](#f-13-deviceauthdetector)
6. [ADR Entries ADR-0011 through ADR-0023](#6-adr-entries)
7. [Backwards Compatibility Summary](#7-backwards-compatibility-summary)
8. [Open Questions and Risks](#8-open-questions-and-risks)

---

## 1. Document Purpose and Scope

This document specifies the full technical solution for the thirteen improvements that constitute guardian-rn v1.1.0. Each feature section provides the domain model, component relationships, TypeScript interface contracts, data flow narrative, error handling strategy, and TDD test strategy. ADR entries capture the significant architectural decisions, and a dependency graph shows which features are prerequisite to others.

The primary audience is the engineering team implementing v1.1.0. A secondary audience is security reviewers and adopters who need to understand the trust boundaries introduced or changed in this version.

### What this document does not cover

- Native (Kotlin/Swift) implementation of new NativeModules — those are specified in the companion platform implementation notes.
- Collector-side changes (ELK schema updates, Grafana dashboard changes).
- Migration guide for adopters — that will be `docs/08-migration-v1.1.md`.

---

## 2. Architecture Baseline Recap

The v1.0.0 architecture establishes the following layered structure that v1.1.0 extends without breaking:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host Application (React Native)                                    │
│  useGuardian(config)  ──►  PolicyEngine.apply()                     │
└────────────────────┬────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│  guardian-rn SDK (packages/guardian-rn)                             │
│  EventBus ─ SequenceTracker ─ HmacEnvelope ─ PolicyEngine          │
│  EncryptedStoragePort   TelemetryAdapter   TerminatorPort           │
└────────────────────┬────────────────────────────────────────────────┘
                     │ Engine interface
┌────────────────────▼────────────────────────────────────────────────┐
│  engine-community (packages/engine-community)                       │
│  CommunityEngine — 6 Detectors (Promise.allSettled, 30s interval)  │
└────────────────────┬────────────────────────────────────────────────┘
                     │ NativeModules / JSI HostObject
┌────────────────────▼────────────────────────────────────────────────┐
│  Native layer  (Kotlin / Swift)                                     │
│  ThreatBus, SessionKeyManager, EncryptedStorageManager              │
└─────────────────────────────────────────────────────────────────────┘
```

Key invariants that v1.1.0 must preserve:

- Every threat event crossing the native bridge carries a valid HMAC-SHA256 signature over the canonical JSON payload.
- `SequenceTracker` rejects replays and wrong-session events before they reach `PolicyEngine`.
- `PolicyEngine.apply()` is the single point of policy enforcement; no engine or detector bypasses it.
- `TerminatorPort` is the only point of process termination; tests inject a spy.
- All timers created inside the SDK are cancelled on `useGuardian` unmount.

---

## 3. Dependency Graph — v1.1.0 Features

The following shows which features must be implemented before others can build on them. A feature is listed as a dependency when its types, interfaces, or runtime behaviour are directly required by the dependent.

```
F-08 PolicyStore
  └── (provides merged policies to) F-01 OODAController
                                    F-06 Session Expiry

F-04 Signed Telemetry
  └── (provides SessionKeyProvider to) F-07 BehavioralBaselineDetector

F-01 OODAController
  └── (injected into) PolicyEngine.apply()
      └── (used by) F-02 EventBus Fast-Path  [reads effectiveKillThreshold]
                    F-06 Session Expiry       [reads config thresholds]

F-02 EventBus Fast-Path
  └── (prerequisite for) F-07 BehavioralBaselineDetector  [emits synthetic events]

F-03 Engine.throttle(mode)
  └── (extends) CommunityEngine  [independent of other features]

F-05 InstallationSourceDetector
  └── (independent; new Detector in engine-community)

F-09 ManagedProfileDetector
  └── (independent; sets EngineContext, no threat emitted)

F-12 ThreatId Obfuscation
  └── (wraps) EventBus output, GuardianConfig
      └── (affects) F-07 BehavioralBaselineDetector  [must use real IDs internally]

F-13 DeviceAuthDetector
  └── (independent; new Detector in engine-community)

F-10 Security Tests
  └── depends on: F-01, F-02, F-04  [tests their security properties]

F-11 Scan Benchmarks
  └── depends on: F-03  [benchmarks throttle mode transitions]
```

Implementation order recommendation:

1. F-08 PolicyStore (unblocks F-01, F-06)
2. F-04 Signed Telemetry (unblocks F-07)
3. F-01 OODAController (unblocks F-02)
4. F-02 EventBus Fast-Path
5. F-03 Engine.throttle, F-05 InstallationSourceDetector, F-09 ManagedProfileDetector, F-13 DeviceAuthDetector (all independent; parallelisable)
6. F-06 Session Expiry
7. F-07 BehavioralBaselineDetector
8. F-12 ThreatId Obfuscation
9. F-10 Security Tests, F-11 Scan Benchmarks (verification layer; implement last)

---

## 4. Cross-Cutting Concerns

### 4.1 Error Isolation

Every component introduced in v1.1.0 must follow the existing SDK error isolation principle: a failure inside any single component must not propagate to the caller and must not crash the host application. The mechanism is:

- Detectors (F-05, F-09, F-13): `Promise.allSettled` in `CommunityEngine.runScan()` already catches individual detector rejections and routes them to `context.onFault()`. New detectors inherit this for free.
- `OODAController` (F-01): its `apply()` method is wrapped in a try/catch inside `PolicyEngine.apply()`. An `OODAController` crash degrades to non-escalated thresholds, never to a crash.
- `PolicyStore` (F-08): all network and storage operations are wrapped in try/catch. Failure paths always resolve to `DEFAULT_POLICIES`.
- `BehavioralBaselineDetector` (F-07): subscriptions to `EventBus` are try/catch wrapped. A spike-detection failure emits nothing; it does not re-throw.
- `ThreatId ObfuscationLayer` (F-12): a missing mapping key returns the original `ThreatId` string as a fallback rather than throwing.
- Telemetry adapter throws (F-04, F-10): `PolicyEngine.apply()` already calls `telemetry?.recordThreat(event)` without awaiting or propagating. The test in F-10 validates this property.

### 4.2 Memory Management

New structures with unbounded growth potential:

| Structure | Location | Bound | Eviction |
|---|---|---|---|
| `RollingWindow<ThreatId>` | OODAController | `windowMs` (default 5 min) | Timestamp-based expiry on every `push()` and `getActive()` call |
| `BehavioralBaseline` per-ID frequency map | BehavioralBaselineDetector | 22 ThreatIds (bounded by schema) | No eviction needed; fixed key space |
| `ObfuscationLayer` Map<ThreatId, number> | ObfuscationLayer | 22 entries | Cleared on session end |
| `PolicyStore` cached JSON | PolicyStore | One serialised policy object | Replaced on each successful remote fetch |
| Session expiry timer ref | useGuardian | One timer per mount | Cleared in useEffect cleanup |

The `RollingWindow` is the only structure whose size scales with event rate rather than a bounded constant. The eviction strategy on every read/write ensures the window never grows beyond `windowMs / minimumEventInterval` entries. At the SDK's 50-events/second rate cap, a 5-minute window holds at most 15,000 entries — approximately 480 KB at 32 bytes per entry — which is acceptable. Applications may configure a shorter `windowMs` to reduce this.

### 4.3 Timer Cleanup

v1.1.0 introduces three new timer sources that must be cleaned up on `useGuardian` unmount:

1. Session expiry timer (`setTimeout`) — cleared in the `useEffect` cleanup function.
2. `BehavioralBaselineDetector` — implements the `Engine` interface; `stop()` clears its internal subscription and any internal intervals. `useGuardian` calls `engine.stop()` on unmount already.
3. `PolicyStore` fetch timeout (`AbortController` with timeout) — the `AbortController` is scoped to the `load()` call; it does not persist between calls.

The `OODAController.RollingWindow` uses wall-clock timestamps and no timers; it is purely passive.

### 4.4 Thread Safety

guardian-rn's JS layer runs on a single thread (the React Native JS thread). All state mutations in JS are inherently single-threaded. The only concern is native-to-JS callbacks arriving on an unexpected thread — this is already handled by the existing `ThreatBus` architecture which routes everything through the JS event loop before reaching `EventBus`.

The new native modules added by F-05, F-09, and F-13 must ensure their completion handlers are dispatched to the main queue (iOS: `DispatchQueue.main.async`; Android: post to `ReactApplicationContext.runOnJSQueueThread`). This is a native implementation constraint, not a JS-layer concern.

---

## 5. Feature Designs

---

### F-01 OODAController

**File:** `packages/guardian-rn/src/core/ooda.ts`

#### 5.1.1 Domain Model

The OODA (Observe–Orient–Decide–Act) loop applied to threat detection: when one threat is confirmed at kill-level confidence, the system should be in a heightened state for correlated threats. For example, a hook detection increases the likelihood that a debugger is also attached; the policy engine should lower the confidence threshold needed to act on the debugger signal.

```
Entities:
  OODAController         — aggregate root; holds RollingWindow and escalation map
  RollingWindow<ThreatId> — value object; a time-bounded set of observed threat IDs

Value Objects:
  EscalationConfig       — maps a ThreatId (the trigger) to a list of correlated ThreatIds
  EffectiveThresholds    — the resolved confidence thresholds after escalation is applied
  WindowEntry            — { threatId: ThreatId, ts: number } — one observation record

Domain Events (conceptual, not published to EventBus):
  ThresholdEscalated     — emitted internally when a correlation lowers a threshold
```

#### 5.1.2 Component Diagram

```
PolicyEngine.apply(event)
        │
        ▼
┌───────────────────────────────────┐
│  OODAController                   │
│  ┌─────────────────────────────┐  │
│  │  RollingWindow<ThreatId>    │  │
│  │  push(threatId, ts)         │  │
│  │  getActive() → ThreatId[]   │  │
│  └─────────────────────────────┘  │
│  computeThresholds(base, event)   │
│    → EffectiveThresholds          │
└───────────────────────────────────┘
        │ EffectiveThresholds
        ▼
PolicyEngine — threshold checks use effective values, not base config values
```

#### 5.1.3 Interface Contracts

```typescript
// packages/guardian-rn/src/core/ooda.ts

export interface EscalationRule {
  /** The threat whose kill-confidence detection triggers this rule. */
  readonly trigger: ThreatId;
  /** Threats whose thresholds are lowered when the trigger fires. */
  readonly correlates: readonly ThreatId[];
}

export interface OODAConfig {
  /** Duration in ms of the rolling window. Default: 300_000 (5 minutes). */
  readonly windowMs?: number;
  /**
   * Multiplicative factor applied to correlated thresholds.
   * A factor of 0.8 means each correlated threshold is multiplied by 0.8.
   * Must be in (0, 1). Default: 0.8.
   */
  readonly escalationFactor?: number;
  /**
   * Escalation rules. If not supplied, the default correlation map is used.
   * Default map: hooks → lowers debugger; root → lowers hooks, tamper;
   *              jailbreak → lowers hooks, tamper, repackaging.
   */
  readonly rules?: readonly EscalationRule[];
}

export interface EffectiveThresholds {
  readonly restrict: number;
  readonly lockout: number;
  readonly kill: number;
}

export class OODAController {
  constructor(config: OODAConfig);

  /**
   * Called by PolicyEngine before every threshold check.
   * Records the event in the rolling window if confidence >= killThreshold.
   * Returns effective thresholds for the given threatId, potentially lowered
   * by active escalation rules.
   */
  computeThresholds(
    base: EffectiveThresholds,
    event: ThreatEvent,
    killThreshold: number,
  ): EffectiveThresholds;

  /** Visible for testing. Returns all threat IDs currently active in the window. */
  getActiveThreats(): readonly ThreatId[];

  /** Visible for testing. Clears the rolling window. */
  reset(): void;
}
```

#### 5.1.4 Default Correlation Map

```
hooks        → correlates: ['debugger', 'tamper']
root         → correlates: ['hooks', 'tamper', 'repackaging', 'privilegedAccess']
jailbreak    → correlates: ['hooks', 'tamper', 'repackaging']
malware      → correlates: ['hooks', 'overlay', 'taskHijacking']
repackaging  → correlates: ['hooks', 'tamper']
```

#### 5.1.5 Data Flow

1. `PolicyEngine.apply(event)` is called with a raw `ThreatEvent`.
2. Before computing the policy tier, `PolicyEngine` calls `oodaController.computeThresholds(baseThresholds, event, killThreshold)`.
3. `computeThresholds` first checks if `event.confidence >= killThreshold`. If so, it pushes `event.threatId` into the `RollingWindow`.
4. `computeThresholds` then inspects the active window. For each rule whose `trigger` is present in the window, it applies `escalationFactor` to the thresholds of the correlated threats.
5. If the incoming `event.threatId` is a correlated threat with at least one active trigger, its effective thresholds are multiplied by `escalationFactor` (floor: 0.1 to prevent thresholds reaching zero).
6. `PolicyEngine` uses the returned `EffectiveThresholds` for its policy tier checks.

#### 5.1.6 RollingWindow Implementation Notes

```typescript
// Internal structure — not exported
class RollingWindow<T> {
  private readonly entries: Array<{ value: T; ts: number }> = [];
  private readonly windowMs: number;

  push(value: T): void {
    this.evict();
    this.entries.push({ value, ts: Date.now() });
  }

  getActive(): readonly T[] {
    this.evict();
    return this.entries.map((e) => e.value);
  }

  private evict(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.entries.length > 0 && this.entries[0].ts < cutoff) {
      this.entries.shift();
    }
  }
}
```

Amortised eviction on every read/write keeps the structure self-cleaning without background timers.

#### 5.1.7 Integration into PolicyEngine

`PolicyEngine` gains an optional `oodaController` constructor parameter:

```typescript
export class PolicyEngine {
  private readonly oodaController?: OODAController;

  constructor(config: GuardianConfig, oodaController?: OODAController) {
    this.config = config;
    this.oodaController = oodaController;
  }

  apply(event: ThreatEvent): void {
    const baseThresholds = { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...this.config.confidenceThresholds };
    const thresholds = this.oodaController
      ? this.oodaController.computeThresholds(baseThresholds, event, baseThresholds.kill)
      : baseThresholds;

    // ... rest of apply() uses `thresholds` instead of the base object
  }
}
```

`GuardianConfig` gains an optional `ooda?: OODAConfig` field. `useGuardian` constructs `OODAController` from `config.ooda` if present and injects it.

#### 5.1.8 Error Handling

`computeThresholds` is wrapped in a try/catch inside `PolicyEngine.apply()`. Any exception inside `OODAController` (e.g., a corrupt window entry) causes `apply()` to fall back to `baseThresholds` and calls `context.onFault()`. The kill timer is not affected.

#### 5.1.9 Test Strategy (TDD)

**Red:** Write failing tests for:
- `computeThresholds` returns base thresholds when window is empty.
- After pushing `hooks` at kill confidence, `computeThresholds` for `debugger` returns `kill * escalationFactor`.
- Entries older than `windowMs` do not affect thresholds.
- `escalationFactor` is clamped: effective threshold never drops below 0.1.
- Multiple triggers compound: two active triggers do not compound multiplicatively; the lowest factor wins (not `factor²`).

**Green:** Implement `RollingWindow` then `OODAController.computeThresholds`.

**Refactor:** Extract the correlation lookup as a pure function to simplify testing. Ensure `PolicyEngine` integration test covers the full `apply()` path.

#### 5.1.10 Backwards Compatibility

`OODAController` is opt-in. `GuardianConfig.ooda` is optional. `PolicyEngine`'s second constructor parameter is optional. All existing behaviour is preserved when `ooda` is absent.

---

### F-02 EventBus Fast-Path

**File:** `packages/guardian-rn/src/bus/EventBus.ts` (modification)

#### 5.2.1 Domain Model

The existing `EventBus` applies a 100 ms deduplication window and a 50-events/second rate cap to every threat event. High-confidence kill-level events must reach subscribers without delay — a kill-level `hooks` detection that is deduplicated or dropped is a security failure. The fast-path lane bypasses both controls for events whose confidence meets or exceeds `effectiveKillThreshold`.

```
Value Objects:
  FastPathConfig — { effectiveKillThreshold: number }

The fast-path is a routing decision, not a new subscription mechanism.
Handlers registered via onThreat() receive both normal and fast-path events.
```

#### 5.2.2 Interface Contracts

`BusConfig` gains one new optional field:

```typescript
export interface BusConfig {
  readonly dedupWindowMs: number;       // existing
  readonly rateCapPerSecond: number;    // existing
  /**
   * Events with confidence >= this value bypass dedupWindow and rateCapPerSecond.
   * Delivered synchronously before the normal-path subscribers.
   * Default: uses the PolicyEngine kill threshold (0.9) if not supplied.
   * Set to Infinity to disable fast-path (not recommended in production).
   */
  readonly fastPathThreshold?: number;
}
```

No new subscription API is introduced. `onThreat()` subscribers receive fast-path events synchronously; the call to subscriber handlers happens inline in `routeThreat()` before the method returns.

#### 5.2.3 Data Flow

```
routeThreat(event, engineId)
  │
  ├─ isFastPath? (event.confidence >= fastPathThreshold)
  │    ├─ YES: skip isRateCapped(), skip isDuplicate()
  │    │        markSeen(event.threatId)  ← still update dedup map to prevent
  │    │        dispatch to threatHandlers synchronously        normal-path dupe
  │    │        return
  │    │
  │    └─ NO:  isRateCapped?  → drop, increment droppedCount
  │             isDuplicate?  → drop silently
  │             markSeen(), dispatch
```

Marking `seen` even on the fast-path prevents the same event from being double-delivered via the normal path within the dedup window if the engine emits it twice.

#### 5.2.4 Error Handling

Fast-path subscribers are called synchronously. If a subscriber throws, the exception is caught per-subscriber (the existing `forEach` is replaced with a try/catch loop for all handler invocations). A throwing subscriber does not prevent other subscribers from receiving the event.

#### 5.2.5 Test Strategy (TDD)

**Red:**
- A kill-confidence event is received by subscribers even when 51 events/second have already been sent from the same engine.
- A kill-confidence event is received even within the dedup window for the same `threatId`.
- A below-threshold event is still deduplicated normally.
- A throwing fast-path subscriber does not prevent other subscribers from receiving the event.
- `droppedCount` does not increment for fast-path events.

**Green:** Add `fastPathThreshold` to `BusConfig`, add the fast-path branch in `routeThreat()`, replace handler loops with try/catch wrappers.

**Refactor:** Extract the fast-path check into a private `isFastPath(event: ThreatEvent): boolean` predicate for readability.

#### 5.2.6 Backwards Compatibility

`fastPathThreshold` is optional with a default of `0.9`. All existing tests pass unchanged because the default only affects events with confidence ≥ 0.9, which existing tests do not rely on passing through dedup or rate checks.

---

### F-03 Engine.throttle(mode)

**Files:**
- `packages/guardian-rn/src/engine/Engine.ts` (modification)
- `packages/engine-community/src/CommunityEngine.ts` (modification)
- `packages/guardian-rn/src/hooks/useGuardian.ts` (modification)

#### 5.3.1 Domain Model

When the host application moves to the background, the OS constrains CPU time. Running a 30-second scan interval in the background is wasteful and increases battery drain. The `throttle(mode)` method lets the engine adapt its scan cadence to app foreground/background state.

```
Value Object:
  ThrottleMode = 'foreground' | 'background'

Engine interface addition:
  throttle?(mode: ThrottleMode): void  — optional method
```

#### 5.3.2 Interface Contracts

`Engine` interface addition:

```typescript
export type ThrottleMode = 'foreground' | 'background';

export interface Engine {
  readonly id: string;
  start(context: EngineContext): Promise<void>;
  stop(): Promise<void>;
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;
  /** Optional. If absent, the engine runs at a fixed interval regardless of app state. */
  throttle?(mode: ThrottleMode): void;
}
```

`GuardianConfig` gains two optional fields consumed by `CommunityEngine`:

```typescript
export interface GuardianConfig {
  // ... existing fields
  /** Scan interval in foreground (ms). Default: 30_000. */
  readonly foregroundScanIntervalMs?: number;
  /** Scan interval in background (ms). Default: 120_000. */
  readonly backgroundScanIntervalMs?: number;
}
```

`CommunityEngine.throttle()` implementation:

```typescript
throttle(mode: ThrottleMode): void {
  if (!this.running) return;
  const interval =
    mode === 'background'
      ? (this.context?.config.backgroundScanIntervalMs ?? BACKGROUND_POLL_INTERVAL_MS)
      : (this.context?.config.foregroundScanIntervalMs ?? POLL_INTERVAL_MS);

  if (this.pollTimer) clearInterval(this.pollTimer);
  this.pollTimer = setInterval(() => { void this.runScan(); }, interval);
}
```

`useGuardian` wires `AppState`:

```typescript
// Inside useEffect in useGuardian.ts
const appStateSub = AppState.addEventListener('change', (nextState) => {
  const mode: ThrottleMode = nextState === 'active' ? 'foreground' : 'background';
  for (const engine of configRef.current.engines) {
    engine.throttle?.(mode);
  }
});
// cleanup:
appStateSub.remove();
```

#### 5.3.3 Data Flow

```
AppState.change event
  │
  ▼
useGuardian — maps AppState 'active' → 'foreground', else → 'background'
  │
  ▼
engine.throttle?(mode)  — no-op if engine does not implement throttle
  │
  ▼
CommunityEngine.throttle() — clears existing pollTimer, sets new interval
```

The in-flight `runScan()` call (if any) is not cancelled — `Promise.allSettled` completes normally. The new interval takes effect for the next scheduled scan.

#### 5.3.4 Error Handling

`throttle()` is called inside a try/catch in `useGuardian`. An engine that throws in `throttle()` has the error routed to `ctx.onFault()` and does not affect other engines.

#### 5.3.5 Test Strategy (TDD)

**Red:**
- `CommunityEngine` uses `BACKGROUND_POLL_INTERVAL_MS` after `throttle('background')`.
- `CommunityEngine` uses `POLL_INTERVAL_MS` after `throttle('foreground')`.
- Calling `throttle('background')` when stopped is a no-op (does not throw).
- An engine without `throttle` does not cause an error when `useGuardian` calls `engine.throttle?.()`.

**Green:** Add optional `throttle()` to Engine interface, implement in `CommunityEngine`, wire AppState in `useGuardian`.

**Refactor:** Extract interval resolution to `resolveInterval(mode, config)` pure function.

#### 5.3.6 Backwards Compatibility

`throttle` is an optional method on the `Engine` interface. Existing custom engine implementations that do not implement it continue to compile and run correctly. No existing tests are affected.

---

### F-04 Signed Telemetry

**Files:**
- `packages/guardian-rn/src/telemetry/TelemetryAdapter.ts` (modification)
- `packages/guardian-rn/src/core/SessionKeyProvider.ts` (new)
- `packages/guardian-rn/src/core/policy.ts` (modification)
- `packages/guardian-rn/src/hooks/useGuardian.ts` (modification)

#### 5.4.1 Domain Model

Telemetry records leaving the device can be tampered with in transit if the collector does not verify their origin. Providing the per-session HMAC key to adapters enables them to sign outgoing payloads, allowing the collector to verify that a telemetry record was produced by a legitimate SDK session.

```
Entity:
  SessionKeyProvider — produces and holds the per-session Uint8Array key

Value Object:
  SignedTelemetryPayload — { event, sessionId, hmac } — adapter-specific shape
  (the SDK does not define this; adapters construct it as they see fit)
```

The SDK's responsibility is to deliver `sessionKey: Uint8Array` to the adapter. What the adapter does with it is outside the SDK's boundary.

#### 5.4.2 Interface Contracts

`TelemetryAdapter` interface modification:

```typescript
export interface TelemetryAdapter {
  /**
   * Called for every threat event that passes the PolicyEngine.
   * sessionKey is the per-session HMAC-SHA256 key from SessionKeyProvider.
   * Adapters MAY use it to sign the outgoing payload.
   * Adapters MUST NOT store sessionKey beyond the lifetime of this call
   * if they cannot guarantee secure storage.
   */
  recordThreat(event: ThreatEvent, sessionKey: Uint8Array): void;
  recordHealthTick(tick: EngineHealthTick): void;
  flush(): Promise<void>;
}
```

`SessionKeyProvider` interface:

```typescript
// packages/guardian-rn/src/core/SessionKeyProvider.ts
export interface SessionKeyProvider {
  /**
   * Returns the per-session key. Called once during useGuardian mount.
   * In production: reads from the JSI HostObject (getSessionKey()).
   * In tests: returns a deterministic mock key.
   */
  getKey(): Uint8Array;
}

export class JsiSessionKeyProvider implements SessionKeyProvider {
  getKey(): Uint8Array {
    const hostObject = (global as any).__guardianHostObject;
    if (!hostObject) throw new Error('GuardianHostObject not installed');
    return hostObject.getSessionKey() as Uint8Array;
  }
}
```

#### 5.4.3 Data Flow

```
useGuardian mount
  │
  ▼
SessionKeyProvider.getKey() → sessionKey: Uint8Array
  │
  ▼
PolicyEngine constructed with (config, oodaController?, sessionKey)
  │
PolicyEngine.apply(event)
  │
  ▼
config.telemetry?.recordThreat(event, sessionKey)
```

The `sessionKey` is passed by value (Uint8Array is a typed array — it is a reference in JS, but the underlying buffer is not copied). The adapter receives a reference to the same buffer. This is intentional for performance; adapters must not mutate the buffer.

#### 5.4.4 Error Handling

`recordThreat` is called in a try/catch inside `PolicyEngine.apply()`. A throwing adapter is isolated: the exception is routed to `context.onFault()` but does not interrupt policy enforcement. This is the property tested in F-10 security test #3.

#### 5.4.5 Test Strategy (TDD)

**Red:**
- `PolicyEngine` calls `recordThreat(event, sessionKey)` with the exact key from the provider.
- An adapter that throws in `recordThreat` does not prevent `onKill` from being called.
- `SessionKeyProvider` throws a meaningful error when the HostObject is absent (test environment guards).

**Green:** Update `TelemetryAdapter` interface, add `SessionKeyProvider`, pass key through `PolicyEngine`.

**Refactor:** Consider whether `sessionKey` belongs in `EngineContext` (shared with engines) vs. being PolicyEngine-specific. Decision: it remains PolicyEngine-specific because engines do not call `recordThreat` — only `PolicyEngine` does. Context is engine-facing; `sessionKey` is telemetry-facing.

#### 5.4.6 Backwards Compatibility

`TelemetryAdapter.recordThreat` gains a required second parameter. This is a **breaking change for existing custom adapter implementations**. Migration path: existing adapters add `_sessionKey: Uint8Array` (unused parameter) to their `recordThreat` signature. A migration guide in `docs/08-migration-v1.1.md` covers this. The built-in `InMemoryTelemetryAdapter` (if any) and collector adapter are updated as part of this feature.

---

### F-05 InstallationSourceDetector

**File:** `packages/engine-community/src/detectors/InstallationSourceDetector.ts` (new)

#### 5.5.1 Domain Model

An app installed from an unofficial store (not the App Store or Google Play) or via ADB sideload has bypassed the store's security review. Detecting this provides evidence that the binary may be tampered, repackaged, or pirated.

```
Entity:
  InstallationSourceDetector — implements Detector
    threatId: 'unofficialStore'
    severity: 'high'

Value Objects:
  InstallerInfo — { packageName: string | null }  (Android)
  EntitlementInfo — { distributionType: 'appStore' | 'enterprise' | 'development' | 'unknown' } (iOS)
```

#### 5.5.2 Interface Contracts

```typescript
// packages/engine-community/src/detectors/InstallationSourceDetector.ts

export interface InstallationSourceConfig {
  /**
   * Android: installer package names considered official.
   * Default: ['com.android.vending', 'com.google.android.feedback']
   */
  readonly allowedInstallers?: readonly string[];
}

export class InstallationSourceDetector implements Detector {
  readonly threatId = 'unofficialStore' as const;
  readonly severity = 'high' as const;

  constructor(config?: InstallationSourceConfig);

  run(): Promise<DetectorResult>;
}
```

#### 5.5.3 Data Flow

**Android path:**

```
run()
  │
  ▼
NativeModules.GuardianRN.getInstallerPackageName()
  → string | null
  │
  ├─ null → detected: true, confidence: 0.6, evidence: { source: 'unknown' }
  ├─ in allowedInstallers → detected: false
  └─ not in allowedInstallers → detected: true, confidence: 0.9,
                                 evidence: { installerPackage: value }
```

**iOS path:**

```
run()
  │
  ▼
NativeModules.GuardianRN.getProvisioningProfileEntitlements()
  → { distributionType: string }
  │
  ├─ 'appStore' → detected: false
  ├─ 'enterprise' → detected: false (enterprise distribution is legitimate)
  ├─ 'development' → detected: true, confidence: 0.5,
  │                   evidence: { distributionType: 'development' }
  └─ 'unknown' → detected: true, confidence: 0.7,
                  evidence: { distributionType: 'unknown' }
```

#### 5.5.4 Error Handling

If `NativeModules.GuardianRN.getInstallerPackageName()` throws or returns an unexpected type, `run()` rejects. `CommunityEngine.runScan()` catches this via `Promise.allSettled` and routes to `onFault()`. The detector does not emit a threat if it cannot determine the installation source — this is a conservative fail-open approach (better to miss a detection than to generate false positives on devices where the native module call fails).

#### 5.5.5 Test Strategy (TDD)

**Red:**
- Returns `detected: false` for `'com.android.vending'`.
- Returns `detected: true, confidence: 0.9` for an unknown installer package name.
- Returns `detected: true, confidence: 0.6` for a null installer (sideloaded via ADB).
- Returns `detected: false` for iOS `'appStore'` distribution type.
- `run()` resolves with `detected: false` when `NativeModules.GuardianRN` is undefined (graceful degradation in test environments).

**Green:** Implement `InstallationSourceDetector` with mock-friendly `NativeModules` access.

**Refactor:** Extract `isOfficialInstaller(packageName, allowlist)` as a pure function for easier unit testing without mocking native modules.

#### 5.5.6 Backwards Compatibility

New detector added to `CommunityEngine`'s default detector list. The `unofficialStore` ThreatId and its default policy (`'restrict'`) already exist. No existing tests are broken. The scan's `activeChecks` health tick will include `'unofficialStore'` — this is an additive change.

---

### F-06 Session Expiry

**File:** `packages/guardian-rn/src/hooks/useGuardian.ts` (modification)

#### 5.6.1 Domain Model

Long-running sessions are a security risk: a session established before a device was rooted or jailbroken will not expire on its own. Mandating a maximum session age forces re-attestation and limits the window of exposure if a session key is compromised.

```
Value Object:
  SessionExpiryConfig — { sessionMaxAgeMs: number }

Synthetic ThreatEvent emitted on expiry:
  { threatId: 'sessionExpiry', severity: 'critical', confidence: 1.0,
    evidence: {}, ts: Date.now(), engineId: 'guardian-rn/session' }

Note: 'sessionExpiry' is NOT a ThreatId in the generated schema.
See ADR-0016 for the decision on whether to add it to the schema.
```

#### 5.6.2 Interface Contracts

`GuardianConfig` addition:

```typescript
export interface GuardianConfig {
  // ... existing fields
  /**
   * Maximum session age in ms. When elapsed, the SDK calls
   * config.actions.onLockout with a synthetic sessionExpiry event
   * and tears down all subscriptions.
   * Optional. If absent, sessions do not expire.
   */
  readonly sessionMaxAgeMs?: number;
}
```

The `sessionExpiry` synthetic event type requires a schema addition. Two options are evaluated in ADR-0016; the accepted decision is to add `'sessionExpiry'` to `ThreatId` and schema as a first-class virtual threat, with `DEFAULT_POLICIES['sessionExpiry'] = 'lockout'`.

#### 5.6.3 Data Flow

```
useGuardian mounts
  │
  ├─ config.sessionMaxAgeMs present?
  │     YES:
  │       sessionExpiryTimer = setTimeout(onExpiry, sessionMaxAgeMs)
  │     NO: skip
  │
useGuardian useEffect cleanup:
  clearTimeout(sessionExpiryTimer)

onExpiry():
  policyEngine?.apply({
    threatId: 'sessionExpiry',
    severity: 'critical',
    confidence: 1.0,
    evidence: {},
    ts: Date.now(),
    engineId: 'guardian-rn/session',
  })
  // PolicyEngine routes this through DEFAULT_POLICIES['sessionExpiry'] = 'lockout'
  // → calls config.actions.onLockout(syntheticEvent)
  //
  // Then tear down:
  for (const sub of subscriptions) sub.unsubscribe()
  for (const engine of configRef.current.engines) void engine.stop()
  policyEngine?.cancelPendingKills()
```

The teardown in `onExpiry` mirrors the existing useEffect cleanup. Both paths call the same cleanup logic, so it is extracted to a `teardown()` function.

#### 5.6.4 Error Handling

The `setTimeout` callback is wrapped in try/catch. If `policyEngine.apply()` throws (which it should not — `apply()` is itself exception-safe), the teardown still executes. Engines are stopped regardless of policy application success.

#### 5.6.5 Test Strategy (TDD)

**Red:**
- `onLockout` is called with a `sessionExpiry` event after `sessionMaxAgeMs` elapses (Jest fake timers).
- All engine `stop()` methods are called after expiry.
- All subscriptions are unsubscribed after expiry.
- The timer is cleared on unmount when expiry has not yet occurred.
- When `sessionMaxAgeMs` is absent, no timer is created and no expiry event fires.

**Green:** Add timer in `useGuardian`, extract teardown function, add `sessionExpiry` to schema and generated types.

**Refactor:** Ensure teardown is idempotent — safe to call from both the cleanup function and the expiry callback.

#### 5.6.6 Backwards Compatibility

`sessionMaxAgeMs` is optional. Existing integrations are unaffected. The `sessionExpiry` ThreatId addition to the schema is additive; codegen will add it to the generated union type and the default policies map. Existing policy overrides that do not include `sessionExpiry` continue to work — the default policy applies.

---

### F-07 BehavioralBaselineDetector

**File:** `packages/engine-community/src/BehavioralBaselineDetector.ts` (new)

#### 5.7.1 Domain Model

A single high-confidence threat detection may be a transient false positive. A sudden increase in the frequency of any threat signal — even below kill threshold — is a strong indicator of an active attack or instrumentation session. The `BehavioralBaselineDetector` observes the `EventBus` (not native sensors directly) and emits a synthetic high-confidence event when a spike is detected.

This detector is architecturally special: it is an `Engine`, not a `Detector`. It does not run on a poll interval but reacts to events from `EventBus`. It emits its own threat events via its `onThreat` observable.

```
Aggregate:
  BehavioralBaselineDetector — implements Engine
    Internal State:
      FrequencyMap — Map<ThreatId, CircularBuffer<number>>
      where each entry is a 5-min sliding window of event timestamps

Value Objects:
  BaselineConfig — { windowMs, spikeMultiplier, minimumEventsForBaseline }
  FrequencyMeasurement — { threatId, countInWindow, baseline, ratio }
```

#### 5.7.2 Component Diagram

```
EventBus.onThreat()
     │ (all threat events, pre-policy)
     ▼
┌────────────────────────────────────────────────────────────────┐
│  BehavioralBaselineDetector                                    │
│                                                                │
│  FrequencyMap<ThreatId, timestamp[]>                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ on each event:                                           │ │
│  │   1. push timestamp into sliding window for threatId     │ │
│  │   2. evict timestamps older than windowMs                │ │
│  │   3. compute current frequency (count / windowMs)        │ │
│  │   4. compare against stored baseline                     │ │
│  │   5. if ratio > spikeMultiplier AND count >= minEvents:  │ │
│  │        emit synthetic ThreatEvent on threatSubject       │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
     │ onThreat (synthetic: { threatId: sourceId + '_spike', ... })
     ▼
EventBus / PolicyEngine
```

#### 5.7.3 Interface Contracts

```typescript
// packages/engine-community/src/BehavioralBaselineDetector.ts

export interface BaselineConfig {
  /**
   * Sliding window duration in ms. Default: 300_000 (5 minutes).
   */
  readonly windowMs?: number;
  /**
   * How many times higher than baseline before a spike is reported.
   * Default: 3.0
   */
  readonly spikeMultiplier?: number;
  /**
   * Minimum number of events within windowMs before a spike can be reported.
   * Prevents spikes from a cold start. Default: 5.
   */
  readonly minimumEventsForBaseline?: number;
}

export class BehavioralBaselineDetector implements Engine {
  readonly id = 'behavioral-baseline@1.1.0' as const;
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;

  constructor(eventBus: EventBus, config?: BaselineConfig);

  /**
   * Subscribes to eventBus.onThreat and begins frequency tracking.
   * Baseline is established from the first windowMs of observations.
   */
  start(context: EngineContext): Promise<void>;

  /**
   * Unsubscribes from EventBus. Clears frequency map.
   */
  stop(): Promise<void>;
}
```

The synthetic `ThreatEvent` emitted on spike detection:

```typescript
{
  threatId: originalThreatId,   // same threatId as the spiking signal
  severity: 'high',
  confidence: 0.85,             // fixed; represents "spike detected, not confirmed compromise"
  evidence: {
    windowMs: String(windowMs),
    countInWindow: String(count),
    baseline: String(baseline),
    ratio: String(ratio.toFixed(2)),
  },
  ts: Date.now(),
  engineId: 'behavioral-baseline@1.1.0',
}
```

Emitting the same `threatId` (rather than a new `'behavioralSpike'` threatId) means the existing policy for that threat applies. A spike in `hooks` events goes through the `hooks` policy — this is intentional.

#### 5.7.4 Baseline Establishment

The first `windowMs` of operation is a learning period. The baseline is established as the average event frequency observed in the first complete window. Until the first window completes, no spike events are emitted (the `minimumEventsForBaseline` check prevents premature firing, but the window-completion check is the primary guard).

Baseline updates: after the first window, the baseline is updated as an exponentially weighted moving average with `alpha = 0.1`. This prevents the baseline from drifting too rapidly if an attack begins gradually.

#### 5.7.5 Security Consideration

An attacker who knows about the `BehavioralBaselineDetector` could attempt to slowly ramp up activity to shift the baseline before launching a full attack. The EWMA baseline update with a small alpha (0.1) makes this slow: moving the baseline by 2x takes approximately 7 full windows (~35 minutes) of consistently elevated activity, which is a significant operational burden.

#### 5.7.6 Error Handling

The `EventBus.onThreat` subscription callback is wrapped in try/catch. Any exception in frequency tracking (e.g., corrupt timestamp) is swallowed and routed to `context.onFault()`. The detector does not stop functioning after a single event processing error.

The detector must not create a feedback loop: when it emits a synthetic event, that event re-enters the EventBus, which would trigger the detector's own subscriber and potentially increment the frequency for the same `threatId`. To prevent this, events with `engineId === 'behavioral-baseline@1.1.0'` are excluded from frequency tracking.

#### 5.7.7 Test Strategy (TDD)

**Red:**
- No event emitted during the first window (learning period).
- Event emitted when frequency exceeds `baseline × spikeMultiplier` after the learning period.
- No event emitted when frequency is below the spike threshold.
- Events from `'behavioral-baseline@1.1.0'` engine do not increment the frequency counter (no feedback loop).
- `stop()` removes the EventBus subscription.
- `minimumEventsForBaseline` prevents emission when fewer than `minEvents` are observed.

**Green:** Implement `BehavioralBaselineDetector` with sliding window and EWMA baseline.

**Refactor:** Extract `FrequencyWindow` as a standalone testable class.

#### 5.7.8 Backwards Compatibility

`BehavioralBaselineDetector` is not added to `CommunityEngine`'s default detector list automatically. It is an opt-in `Engine` added by the adopter to `config.engines`. This prevents unexpected behavioural changes for existing adopters. Documentation recommends adding it for high-security applications.

---

### F-08 PolicyStore

**File:** `packages/guardian-rn/src/policy/PolicyStore.ts` (new)

#### 5.8.1 Domain Model

Static local policies cannot respond to newly discovered threats without a release update. `PolicyStore` enables remote policy delivery: on mount, it attempts to fetch a fresh policy set from a configured endpoint, persists it to encrypted storage for offline resilience, and merges it with local defaults.

```
Aggregate:
  PolicyStore — manages the lifecycle of the policy document
    load() — the main entry point; returns a merged policy record
    hydrate(raw: string) — parses and validates fetched JSON

Value Objects:
  PolicyDocument — { version: string, policies: Partial<Record<ThreatId, ResponsePolicy>>,
                     expiresAt?: number }
  PolicyEndpointConfig — { url: string, timeoutMs?: number, headers?: Record<string, string> }
```

#### 5.8.2 Interface Contracts

```typescript
// packages/guardian-rn/src/policy/PolicyStore.ts

export interface PolicyEndpointConfig {
  readonly url: string;
  /** Request timeout in ms. Default: 5_000. */
  readonly timeoutMs?: number;
  /** Additional headers (e.g., Authorization). */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface PolicyDocument {
  readonly version: string;
  readonly policies: Partial<Record<ThreatId, ResponsePolicy>>;
  /** Unix epoch ms. If present and in the past, treat as stale and attempt refresh. */
  readonly expiresAt?: number;
}

export class PolicyStore {
  constructor(
    endpointConfig: PolicyEndpointConfig,
    storage: EncryptedStoragePort,
    defaults?: Partial<Record<ThreatId, ResponsePolicy>>,
  );

  /**
   * Attempts remote fetch. On success: persists to storage, returns merged policies.
   * On fetch failure: loads from storage. On storage miss: returns defaults.
   * Never rejects — always resolves to a usable policy record.
   */
  load(): Promise<Partial<Record<ThreatId, ResponsePolicy>>>;
}
```

`GuardianConfig` addition:

```typescript
export interface GuardianConfig {
  // ... existing fields
  /**
   * If present, PolicyStore is created and used to resolve policies on mount.
   * Requires config.storage to be set (PolicyStore needs EncryptedStoragePort).
   */
  readonly policyEndpoint?: PolicyEndpointConfig;
  /** Required when policyEndpoint is set. */
  readonly storage?: EncryptedStoragePort;
}
```

#### 5.8.3 Data Flow

```
useGuardian mounts
  │
  ├─ config.policyEndpoint present?
  │     YES:
  │       policyStore = new PolicyStore(config.policyEndpoint, config.storage, DEFAULT_POLICIES)
  │       resolvedPolicies = await policyStore.load()
  │     NO:
  │       resolvedPolicies = { ...DEFAULT_POLICIES, ...config.policies }
  │
  ▼
PolicyEngine constructed with resolvedPolicies
```

`PolicyStore.load()` internal flow:

```
load()
  │
  ├─ check if cached document exists in storage AND is not expired
  │     → if valid: use cached policies, attempt background refresh
  │
  ├─ fetch(url, { signal: AbortController(timeoutMs) })
  │     ├─ SUCCESS (2xx):
  │     │     validate(response) → PolicyDocument
  │     │     storage.set('guardian:policies', JSON.stringify(document))
  │     │     return merge(DEFAULT_POLICIES, document.policies)
  │     │
  │     └─ FAILURE (timeout / network error / non-2xx / validation error):
  │           raw = await storage.get('guardian:policies')
  │           if (raw) return merge(DEFAULT_POLICIES, JSON.parse(raw).policies)
  │           return DEFAULT_POLICIES
```

#### 5.8.4 Policy Merge Semantics

Remote policies override defaults; caller-supplied `config.policies` override remote policies. Merge order:

```
DEFAULT_POLICIES
  ← merged with remote PolicyDocument.policies  (remote wins over default)
  ← merged with config.policies                 (caller always wins)
```

This ensures that adopters can always hard-code a policy that cannot be overridden remotely.

#### 5.8.5 Error Handling

- Network timeout: `AbortController` fires after `timeoutMs`. The `fetch` promise rejects; the catch block loads from storage.
- Invalid JSON from remote: `JSON.parse` throws; caught; falls back to storage.
- Schema validation failure (unknown ThreatId, unknown ResponsePolicy): validated field-by-field; unknown values are omitted rather than causing a total failure.
- Storage read error: caught; returns `DEFAULT_POLICIES`.
- All failure modes resolve (never reject) and produce a usable policy set.

#### 5.8.6 Test Strategy (TDD)

**Red:**
- Returns remote policies on successful fetch.
- Persists fetched policies to storage.
- Falls back to storage on network failure.
- Falls back to `DEFAULT_POLICIES` when both network and storage fail.
- Remote policies do not override `config.policies`.
- Fetch respects `timeoutMs` (mock `fetch` that never resolves + fake timers).
- Expired cached document triggers a remote refresh.

**Green:** Implement `PolicyStore` with injected `fetch` (for testability).

**Refactor:** Extract `validatePolicyDocument(raw: unknown): PolicyDocument` as a pure function.

#### 5.8.7 Backwards Compatibility

`policyEndpoint` is optional. All existing behaviour is preserved when it is absent. `PolicyEngine`'s constructor is not changed — policies are resolved before `PolicyEngine` is constructed, and `PolicyEngine` receives the merged record directly.

---

### F-09 ManagedProfileDetector

**File:** `packages/engine-community/src/detectors/ManagedProfileDetector.ts` (new)

#### 5.9.1 Domain Model

Devices enrolled in Mobile Device Management (MDM) or Android Work Profiles may have restricted capabilities or may be subject to organisational policy that conflicts with the app's security model. Rather than blocking MDM-enrolled devices (which could affect legitimate enterprise deployments), the SDK surfaces the managed state as context so the host application can apply its own logic.

This detector does NOT emit a threat event. It sets a field on `EngineContext`.

```
Value Object:
  ManagedProfileInfo — { isManagedProfile: boolean, mdmEnrolled: boolean }

Side effect: sets EngineContext.managedProfile = ManagedProfileInfo
```

#### 5.9.2 EngineContext Extension

`EngineContext` gains a mutable context bag:

```typescript
export interface EngineContext {
  readonly config: GuardianConfig;
  readonly sessionId: string;
  readonly platform: 'android' | 'ios';
  onFault(error: Error): void;
  /**
   * Context bag populated by detectors during start/run.
   * Keys are feature-specific; values are read-only objects.
   * Added in v1.1.0 for ManagedProfileDetector.
   */
  readonly contextBag: Record<string, unknown>;
}
```

`ManagedProfileDetector` writes to `context.contextBag['managedProfile']`. The host application accesses this via `useGuardian`'s returned `EngineContext` (if exposed — see note below).

Note: `useGuardian` does not currently return the context. Options:
1. `useGuardian` returns `{ context: EngineContext }`.
2. A new `useManagedProfile(): ManagedProfileInfo | null` hook reads from the context bag.

The accepted decision (ADR-0018) is option 2: a dedicated `useManagedProfile()` hook, backed by a React state that `ManagedProfileDetector` updates via a callback.

#### 5.9.3 Interface Contracts

```typescript
// packages/engine-community/src/detectors/ManagedProfileDetector.ts

export interface ManagedProfileInfo {
  readonly isManagedProfile: boolean; // Android: DevicePolicyManager.isInManagedProfile()
  readonly mdmEnrolled: boolean;      // iOS: MDM profile detected
}

export class ManagedProfileDetector implements Detector {
  readonly threatId = 'managedProfile' as const;  // not emitted as a threat
  readonly severity = 'low' as const;

  run(): Promise<DetectorResult>;
  // Always returns { detected: false, confidence: 0, evidence: {} }
  // Side effect: calls the onManagedProfileDetected callback if enrolled

  constructor(onManagedProfileDetected: (info: ManagedProfileInfo) => void);
}
```

Wait — `Detector.run()` returns a `DetectorResult` with no side-channel for context. The cleanest solution is to use the callback approach above: `ManagedProfileDetector` is constructed with a callback, which is invoked with the `ManagedProfileInfo` before `run()` resolves. The callback updates a React state held by a companion `useManagedProfile()` hook.

`useManagedProfile()` hook:

```typescript
// packages/guardian-rn/src/hooks/useManagedProfile.ts

export function useManagedProfile(
  config: GuardianConfig,
): ManagedProfileInfo | null;
```

This hook accepts the config to access the engine list and attaches itself to the `ManagedProfileDetector` instance (found by type or by a well-known engine ID) via its callback mechanism.

#### 5.9.4 Data Flow

```
CommunityEngine.runScan()
  │
  ▼
ManagedProfileDetector.run()
  │
  ├─ Android: NativeModules.GuardianRN.isInManagedProfile() → boolean
  ├─ iOS:     NativeModules.GuardianRN.isMDMEnrolled() → boolean
  │
  ├─ onManagedProfileDetected({ isManagedProfile, mdmEnrolled })
  │     → updates React state in useManagedProfile()
  │
  └─ return { detected: false, confidence: 0, evidence: {} }
     // Never emits a ThreatEvent
```

#### 5.9.5 Error Handling

If the native module call throws, `run()` rejects with the error, which `Promise.allSettled` catches. The `onManagedProfileDetected` callback is not called. The `useManagedProfile()` state remains `null`. No threat event is emitted.

#### 5.9.6 Test Strategy (TDD)

**Red:**
- `run()` calls `onManagedProfileDetected({ isManagedProfile: true, mdmEnrolled: false })` on Android when native returns true.
- `run()` returns `{ detected: false, confidence: 0, evidence: {} }` always.
- If native module throws, `run()` rejects and `onManagedProfileDetected` is not called.
- `useManagedProfile()` starts as `null` and updates when the callback fires.

**Green:** Implement detector with injected native module accessor (for test injection).

**Refactor:** The callback pattern could be generalised to a `ContextualDetector` interface if other future detectors need the same pattern.

#### 5.9.7 Backwards Compatibility

New detector, not added to `CommunityEngine`'s default list. Opt-in. `EngineContext.contextBag` is additive and has no effect on existing engines.

The `managedProfile` ThreatId is NOT added to the schema (this detector never emits a threat). No codegen changes are required.

---

### F-10 Security Tests

**File:** `packages/guardian-rn/src/__tests__/security.test.ts` (new)

#### 5.10.1 Purpose

Four test scenarios that verify the security properties of the SDK's threat boundary. These are regression tests for attack vectors, not functional tests. They must run in CI on every PR.

#### 5.10.2 Test Scenarios

**Scenario 1: Forged engineId rejection**

An attacker injects a synthetic `GuardianEnvelope` with a valid payload structure but an HMAC computed with a different key. The `EventBus.processEnvelope()` must reject it.

```typescript
it('rejects an envelope signed with a wrong key', () => {
  const bus = new EventBus(sessionKey, sessionId);
  const spy = jest.fn();
  bus.onThreat(spy);
  bus.onFault(faultSpy);

  const forgedEnvelope = buildEnvelope(payload, wrongKey, sessionId, seq = 1);
  bus.processEnvelope(forgedEnvelope, 'community@1.0.0');

  expect(spy).not.toHaveBeenCalled();
  expect(faultSpy).toHaveBeenCalledWith(
    'community@1.0.0',
    expect.objectContaining({ message: expect.stringContaining('HMAC_MISMATCH') }),
  );
});
```

**Scenario 2: Confidence just below kill threshold does not start timer**

A `hooks` event at confidence `0.899` (below the default kill threshold of `0.9`) must not schedule a kill timer, even with the default `hooks → 'kill'` policy.

```typescript
it('does not schedule kill timer for confidence just below threshold', () => {
  jest.useFakeTimers();
  const terminateSpy = jest.fn();
  const policy = new PolicyEngine({
    ...config,
    terminator: { terminate: terminateSpy },
    killPolicy: { enabled: true, graceMs: 5000 },
  });

  policy.apply({
    threatId: 'hooks',
    confidence: 0.899,
    severity: 'critical',
    evidence: {},
    ts: Date.now(),
    engineId: 'test',
  });

  jest.runAllTimers();
  expect(terminateSpy).not.toHaveBeenCalled();
});
```

**Scenario 3: Telemetry adapter throw isolation**

A throwing `recordThreat` implementation must not prevent the `onKill` action from being called.

```typescript
it('isolates a throwing telemetry adapter from kill action', () => {
  const killSpy = jest.fn();
  const policy = new PolicyEngine({
    ...config,
    telemetry: {
      recordThreat: () => { throw new Error('adapter failure'); },
      recordHealthTick: jest.fn(),
      flush: jest.fn(),
    },
    actions: { onKill: killSpy },
  }, undefined, mockSessionKey);

  policy.apply({ threatId: 'hooks', confidence: 1.0, severity: 'critical',
                 evidence: {}, ts: Date.now(), engineId: 'test' });

  expect(killSpy).toHaveBeenCalled();
});
```

**Scenario 4: Sequence replay rejection**

An event with a replayed sequence number must be dropped by `EventBus.processEnvelope()`.

```typescript
it('drops a replayed sequence number', () => {
  const bus = new EventBus(sessionKey, sessionId);
  const spy = jest.fn();
  bus.onThreat(spy);

  const envelope = buildEnvelope(payload, sessionKey, sessionId, seq = 5);
  bus.processEnvelope(envelope, 'community@1.0.0');
  bus.processEnvelope(envelope, 'community@1.0.0'); // same seq, replay

  expect(spy).toHaveBeenCalledTimes(1); // first delivery only
});
```

#### 5.10.3 Test Infrastructure

A `buildEnvelope(payload, key, sessionId, seq)` helper is extracted to `src/__tests__/helpers/envelopeBuilder.ts`. It is used by this test file and the existing `HmacEnvelope.test.ts`.

#### 5.10.4 Backwards Compatibility

New test file; no production code changes.

---

### F-11 Scan Benchmarks

**File:** `packages/perf/scan-benchmark.test.ts` (new)

#### 5.11.1 Purpose

Establish a performance regression gate for the detector scan path. The benchmark verifies that 100 consecutive full scans — each with all detectors resolving in approximately 10 ms — complete with p95 latency under 200 ms. This catches accidental synchronous blocking or excessive overhead introduced in the scan path.

#### 5.11.2 Benchmark Design

```typescript
// packages/perf/scan-benchmark.test.ts

describe('CommunityEngine scan benchmark', () => {
  it('p95 scan latency < 200ms with 10ms mock detectors', async () => {
    const mockDetectors: Detector[] = Array.from({ length: 6 }, (_, i) => ({
      threatId: THREAT_IDS[i],
      severity: 'low' as const,
      run: () =>
        new Promise<DetectorResult>((resolve) =>
          setTimeout(() => resolve({ detected: false, confidence: 0, evidence: {} }), 10),
        ),
    }));

    const engine = new CommunityEngine(mockDetectors);
    const ctx = buildTestContext();
    await engine.start(ctx);

    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await (engine as any).runScan(); // white-box access to private method
      durations.push(performance.now() - start);
    }

    await engine.stop();

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)];

    expect(p95).toBeLessThan(200);
  });
});
```

The 6 mock detectors each resolve after 10 ms, running in parallel via `Promise.allSettled`. The theoretical minimum per scan is ~10 ms. A p95 of 200 ms allows 190 ms of overhead — this is intentionally generous for CI environments (virtualized, slow).

The test also includes a throttle-transition benchmark:

```typescript
it('throttle mode transition does not increase p99 by more than 20ms', async () => {
  // ... measure p99 before and after throttle('background') transition
});
```

#### 5.11.3 Runner Configuration

The `packages/perf/` directory uses its own Jest config (`jest.config.perf.ts`) with a longer `testTimeout` (60 000 ms) and no coverage collection. It runs as a separate CI step:

```yaml
# .github/workflows/perf.yml
- name: Scan benchmarks
  run: npx jest --config packages/perf/jest.config.perf.ts
```

Performance regressions fail the CI step but do not block merges (advisory gate in v1.1.0; mandatory gate in v1.2.0).

#### 5.11.4 Backwards Compatibility

New package, new test. No production code changes.

---

### F-12 ThreatId Obfuscation

**Files:**
- `packages/guardian-rn/src/core/ObfuscationLayer.ts` (new)
- `packages/guardian-rn/src/config/GuardianConfig.ts` (modification)
- `packages/guardian-rn/src/hooks/useGuardian.ts` (modification)

#### 5.12.1 Domain Model

Static analysis of a compiled JavaScript bundle can reveal the string literals `'hooks'`, `'root'`, `'jailbreak'` etc. An attacker who can locate the policy enforcement code and suppress events bearing known ThreatId strings can disable individual detections. Replacing ThreatIds with per-session random integers makes static string searches ineffective and increases the cost of dynamic instrumentation.

```
Aggregate:
  ObfuscationLayer — holds the per-session mapping
    encode(threatId: ThreatId) → number
    decode(code: number) → ThreatId | undefined

Value Objects:
  ObfuscationMap — Map<ThreatId, number>  — held only in memory, never serialised
  ObfuscatedThreatEvent — same shape as ThreatEvent but threatId field is number
```

#### 5.12.2 Trust Boundary

The obfuscation layer sits between the `EventBus` output and the `config.actions` callbacks. Internally (PolicyEngine, OODAController, BehavioralBaselineDetector) the SDK always uses real `ThreatId` strings — obfuscation is only applied when handing events to the host application. This maintains internal integrity while denying the host application (and any code that patches it) the plaintext threat ID.

```
EventBus.onThreat(realThreatEvent)
  │
  ▼
ObfuscationLayer.encode(realEvent) → ObfuscatedThreatEvent (threatId: number)
  │
  ▼
config.actions.onRestrict(obfuscatedEvent)
              .onLockout(obfuscatedEvent)
              .onKill(obfuscatedEvent)
```

#### 5.12.3 Interface Contracts

`GuardianConfig` addition:

```typescript
export interface GuardianConfig {
  // ... existing fields
  /**
   * If true, ThreatEvent.threatId is replaced with a per-session random integer
   * before being passed to config.actions callbacks.
   * The mapping is never serialised or logged.
   * Default: false.
   */
  readonly obfuscateThreatIds?: boolean;
}
```

`ObfuscatedThreatEvent`:

```typescript
export interface ObfuscatedThreatEvent
  extends Omit<ThreatEvent, 'threatId'> {
  /** Per-session random integer. Use GuardianSession.decodeThreatId() to resolve. */
  readonly threatId: number;
}
```

`ObfuscationLayer`:

```typescript
// packages/guardian-rn/src/core/ObfuscationLayer.ts

export class ObfuscationLayer {
  private readonly map: Map<ThreatId, number> = new Map();

  constructor() {
    for (const id of ALL_THREAT_IDS) {
      this.map.set(id, randomInt(1, 2 ** 31 - 1));
    }
  }

  encode(event: ThreatEvent): ObfuscatedThreatEvent {
    const code = this.map.get(event.threatId);
    if (code === undefined) return event as unknown as ObfuscatedThreatEvent; // fallback
    return { ...event, threatId: code };
  }

  /** Exposed via GuardianSession for adopters who need to decode IDs. */
  decode(code: number): ThreatId | undefined {
    for (const [id, c] of this.map.entries()) {
      if (c === code) return id;
    }
    return undefined;
  }
}
```

`randomInt` uses `crypto.getRandomValues` (React Native's `expo-crypto` or `react-native-get-random-values` polyfill).

`ALL_THREAT_IDS` is imported from the generated `ThreatId.ts` — specifically, a companion `ALL_THREAT_IDS: readonly ThreatId[]` array that codegen emits alongside the union type.

#### 5.12.4 Data Flow

```
useGuardian mounts
  │
  ├─ config.obfuscateThreatIds?
  │     YES: create ObfuscationLayer instance (one per session)
  │     NO:  obfuscationLayer = null
  │
ThreatEvent arrives at policyEngine.apply()
  │
  PolicyEngine processes with real ThreatId (unchanged internally)
  │
  At action dispatch point:
  ├─ obfuscationLayer present?
  │     YES: pass obfuscationLayer.encode(event) to action callbacks
  │     NO:  pass raw event to action callbacks
```

#### 5.12.5 BehavioralBaselineDetector Interaction

`BehavioralBaselineDetector` subscribes to `EventBus.onThreat()`, which provides real `ThreatId` strings (obfuscation is applied downstream of EventBus). This is correct — the baseline detector must work with real IDs.

#### 5.12.6 Error Handling

If `ObfuscationLayer.encode()` cannot find the mapping (unknown ThreatId not in schema), it returns the event with the real ThreatId as a fallback. This is a conservative choice: failing open (revealing the ThreatId) is better than failing closed (not delivering the event to the host application at all).

#### 5.12.7 Test Strategy (TDD)

**Red:**
- When `obfuscateThreatIds: true`, actions receive `threatId` as a number.
- The number is stable within a session (same event twice → same number).
- The number differs between sessions (new `ObfuscationLayer` instance → different mapping).
- `decode(encode(event).threatId)` returns the original ThreatId.
- When `obfuscateThreatIds: false` (default), actions receive the original string ThreatId.
- `PolicyEngine` internally uses the real ThreatId regardless of obfuscation setting.

**Green:** Implement `ObfuscationLayer`, wire into `useGuardian`.

**Refactor:** Ensure `ObfuscationLayer` is constructed once per `useGuardian` mount and not recreated on re-renders.

#### 5.12.8 Backwards Compatibility

`obfuscateThreatIds` defaults to `false`. All existing integrations receive unobfuscated events. New integrations that opt in must update their action callbacks to handle `number` threatId — this is a deliberate adoption friction that ensures integrations are consciously choosing obfuscation.

---

### F-13 DeviceAuthDetector

**File:** `packages/engine-community/src/detectors/DeviceAuthDetector.ts` (new)

#### 5.13.1 Domain Model

A device without a passcode set or with no biometric authentication available is significantly easier to compromise through physical access. Detecting the absence of these controls is a standard RASP check for financial applications.

```
Entity:
  DeviceAuthDetector — implements Detector
    threatId: (varies — see below)
    severity: 'high' (passcodeMissing) | 'medium' (biometricMissing)
```

Note: a single `run()` call may need to emit two different ThreatId signals (`passcodeMissing` and `biometricMissing`). The `Detector` interface as currently defined returns a single `DetectorResult`. Two design options:

1. Two separate detector classes: `PasscodeMissingDetector` and `BiometricMissingDetector`.
2. A single `DeviceAuthDetector` that returns the higher-priority result and relies on a second scan to report the lower-priority one.

The accepted decision (ADR-0022) is option 1: two classes, both registered in `CommunityEngine`'s default list. Each is independently testable and independently configurable.

#### 5.13.2 Interface Contracts

```typescript
// packages/engine-community/src/detectors/DeviceAuthDetector.ts

export interface DeviceAuthStatus {
  readonly passcodeSet: boolean;
  readonly biometricAvailable: boolean;
}

export class PasscodeMissingDetector implements Detector {
  readonly threatId = 'passcodeMissing' as const;
  readonly severity = 'high' as const;
  run(): Promise<DetectorResult>;
}

export class BiometricMissingDetector implements Detector {
  readonly threatId = 'biometricMissing' as const;
  readonly severity = 'medium' as const;
  run(): Promise<DetectorResult>;
}
```

Both classes call `NativeModules.GuardianRN.getDeviceAuthStatus()` which returns a `DeviceAuthStatus` object:

```typescript
// NativeModules contract (implemented in Kotlin/Swift)
getDeviceAuthStatus(): Promise<DeviceAuthStatus>
```

**PasscodeMissingDetector:**

```typescript
run(): Promise<DetectorResult> {
  const status = await NativeModules.GuardianRN.getDeviceAuthStatus();
  return {
    detected: !status.passcodeSet,
    confidence: 1.0,
    evidence: { passcodeSet: String(status.passcodeSet) },
  };
}
```

**BiometricMissingDetector:**

```typescript
run(): Promise<DetectorResult> {
  const status = await NativeModules.GuardianRN.getDeviceAuthStatus();
  return {
    detected: !status.biometricAvailable,
    confidence: 0.7,
    evidence: { biometricAvailable: String(status.biometricAvailable) },
  };
}
```

The native implementation:

- **Android:** `KeyguardManager.isDeviceSecure()` for `passcodeSet`; `BiometricManager.canAuthenticate()` for `biometricAvailable`.
- **iOS:** `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)` for `passcodeSet`; `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` for `biometricAvailable`.

#### 5.13.3 Data Flow

```
CommunityEngine.runScan()
  │ (via Promise.allSettled)
  ├─ PasscodeMissingDetector.run()
  │     → NativeModules.GuardianRN.getDeviceAuthStatus()
  │     → { detected: !passcodeSet, confidence: 1.0 }
  │
  └─ BiometricMissingDetector.run()
        → NativeModules.GuardianRN.getDeviceAuthStatus()  (second call — cached by OS)
        → { detected: !biometricAvailable, confidence: 0.7 }
```

Both detectors call `getDeviceAuthStatus()` independently. This results in two native calls per scan cycle, but the OS-level result is typically cached (no hardware re-evaluation). If this proves to be a performance concern (measured in F-11 benchmarks), the two detectors can be replaced with a single `DeviceAuthDetector` that emits via a callback mechanism. This is deferred to v1.2.0.

#### 5.13.4 Error Handling

If `getDeviceAuthStatus()` throws, `run()` rejects. `CommunityEngine.runScan()` catches via `Promise.allSettled`. No threat event is emitted on error. This is fail-open: inability to check auth status does not trigger a false positive.

#### 5.13.5 Test Strategy (TDD)

**Red:**
- `PasscodeMissingDetector` returns `detected: true, confidence: 1.0` when `passcodeSet: false`.
- `PasscodeMissingDetector` returns `detected: false` when `passcodeSet: true`.
- `BiometricMissingDetector` returns `detected: true, confidence: 0.7` when `biometricAvailable: false`.
- `BiometricMissingDetector` returns `detected: false` when `biometricAvailable: true`.
- Both return `detected: false` when `NativeModules.GuardianRN` is undefined (test environment fallback).
- Rejection from `getDeviceAuthStatus()` propagates as a rejected promise.

**Green:** Implement both classes with injectable native module accessor.

**Refactor:** Introduce `getNativeDeviceAuthStatus(nativeModules)` as a shared async helper.

#### 5.13.6 Backwards Compatibility

`passcodeMissing` and `biometricMissing` ThreatIds already exist in the schema. Default policies (`passcodeMissing: 'restrict'`, `biometricMissing: 'telemetry'`) are already in `DEFAULT_POLICIES`. Adding the new detectors to `CommunityEngine`'s default list is an additive change. Adopters who do not want these checks can supply a custom detector list to `CommunityEngine`'s constructor.

---

## 6. ADR Entries

ADR numbering continues from ADR-0010 (the last existing ADR covering Grafana multi-tenant isolation).

---

### ADR-0011: OODAController Threshold Escalation Strategy

**Status:** Accepted

**Context:** When a kill-level threat is detected, correlated threats become more likely. The policy engine needs a mechanism to lower thresholds for those correlated threats during the observation window. Two approaches were considered: (A) modify `GuardianConfig.confidenceThresholds` in place; (B) introduce a separate controller that computes effective thresholds without mutating config.

**Decision:** Option B — `OODAController` computes effective thresholds transiently for each `apply()` call. Config is never mutated.

**Consequences:** Config immutability is preserved (a critical invariant). The escalation state lives entirely in `OODAController`, making it independently testable. The cost is an additional function call in the hot path of `PolicyEngine.apply()`.

---

### ADR-0012: EventBus Fast-Path — Synchronous vs Queued Delivery

**Status:** Accepted

**Context:** Kill-level events must bypass dedup and rate-cap. Two delivery options: (A) synchronous inline dispatch; (B) a priority queue processed asynchronously.

**Decision:** Option A — synchronous inline dispatch. The JS runtime is single-threaded; there is no parallelism concern. Synchronous delivery minimises latency and avoids the complexity of a priority queue.

**Consequences:** Fast-path subscriber handlers block the EventBus processing loop for their duration. Handlers that perform expensive operations (network calls, storage I/O) in a threat callback will increase observed latency. This is documented as a pitfall in the SDK guide.

---

### ADR-0013: Engine.throttle as Optional vs Required

**Status:** Accepted

**Context:** `Engine` is a public interface with existing third-party implementations. Adding a required `throttle` method would break all existing implementors. Two options: (A) make `throttle` optional (`throttle?(mode): void`); (B) introduce a separate `ThrottlableEngine extends Engine` interface.

**Decision:** Option A — optional method on the existing `Engine` interface. TypeScript structural typing means `engine.throttle?.()` safely no-ops when the method is absent.

**Consequences:** Engines that do not implement throttle silently run at their fixed interval in the background. This is acceptable — the engine contract only guarantees `start/stop` semantics. Engines that need background optimisation opt in.

---

### ADR-0014: Signed Telemetry — Key Exposure Surface

**Status:** Accepted

**Context:** Passing the session key to `TelemetryAdapter.recordThreat()` expands the key's exposure surface. If an adapter stores or logs the key, it could be extracted. Three options: (A) pass key directly; (B) pass a signing function `sign(payload: Uint8Array): string`; (C) pass a `TelemetrySigningPort` that wraps signing.

**Decision:** Option B — pass a `signPayload: (payload: Uint8Array) => string` function. Adapters can sign without ever holding the raw key material. The closure over the key is held by the SDK.

**Amendment to feature design:** The interface contract for `recordThreat` is updated:

```typescript
recordThreat(
  event: ThreatEvent,
  signPayload: (payload: Uint8Array) => string,
): void;
```

**Consequences:** Adapters cannot use the key for any purpose other than signing (they never see the raw bytes). This is a stronger security posture. Adapters that do not need signing ignore the second parameter.

---

### ADR-0015: PolicyStore Fetch Failure — Silent Fallback vs Observable Error

**Status:** Accepted

**Context:** When `PolicyStore` cannot fetch remote policies, it falls back silently to cached or default policies. An alternative is to surface the failure to `context.onFault()` so operators can observe it.

**Decision:** Fetch failure is surfaced to `context.onFault()` with a structured `PolicyFetchError` (carrying URL and HTTP status code if available), but the fallback still proceeds. `useGuardian` continues normally with fallback policies. The fault is observable but not fatal.

**Consequences:** Operators using the telemetry adapter will see fetch failures in their dashboards. The application does not lock out users when the policy endpoint is unreachable (a CDN outage should not cause all sessions to fail open to defaults without notice, but it also should not block users).

---

### ADR-0016: sessionExpiry as a ThreatId vs a Lifecycle Event

**Status:** Accepted

**Context:** Session expiry is not a security threat in the traditional sense — it is a policy-enforced session boundary. Adding `'sessionExpiry'` to the schema's `ThreatId` union means it flows through the same `PolicyEngine` machinery. An alternative is a separate lifecycle callback on `GuardianConfig` (e.g., `onSessionExpired`).

**Decision:** `'sessionExpiry'` is added to the `ThreatId` schema and flows through `PolicyEngine`. Rationale: it is delivered via the same `config.actions.onLockout` mechanism as other lockout-level threats; treating it consistently reduces the cognitive surface of the API. The `SessionExpiry` ThreatId is documented as "virtual" — it is never emitted by a detector, only by the session lifecycle manager.

**Consequences:** Codegen adds `'sessionExpiry'` to all generated type enums (TS, Kotlin, Swift). Adopters who pattern-match on ThreatId exhaustively will receive a compile-time error prompting them to handle the new case — this is the desired behaviour.

---

### ADR-0017: BehavioralBaselineDetector — Engine vs Detector Interface

**Status:** Accepted

**Context:** `BehavioralBaselineDetector` needs to subscribe to `EventBus`, not to native sensors. This does not fit the `Detector` (pull-based, `run() → DetectorResult`) contract. Two options: (A) implement `Engine` interface; (B) introduce a new `ReactiveDetector` interface.

**Decision:** Option A — implement `Engine`. The `Engine` interface is the right abstraction: `start()` sets up subscriptions, `stop()` tears them down, and `onThreat` emits events. This reuses the existing pluggability mechanism without adding a third interface concept.

**Consequences:** `BehavioralBaselineDetector` appears in `config.engines`, not in `CommunityEngine`'s detector list. This is a natural fit: it is an independent engine that happens to observe the same event bus.

---

### ADR-0018: ManagedProfileDetector Context Surfacing

**Status:** Accepted

**Context:** `Detector.run()` returns a `DetectorResult` — there is no channel for side-data. `ManagedProfileDetector` needs to surface `ManagedProfileInfo` to the host application without emitting a threat event. Options: (A) extend `EngineContext` with a mutable `contextBag`; (B) constructor-injected callback; (C) separate `useManagedProfile()` hook backed by React state.

**Decision:** Option C — `useManagedProfile(config)` hook. The hook creates a `useState` slot for `ManagedProfileInfo | null` and provides a `setManagedProfile` callback to the `ManagedProfileDetector` constructor. This is idiomatic React and avoids adding mutable state to `EngineContext`.

**Consequences:** The host application must call `useManagedProfile(config)` to access managed profile state, in addition to `useGuardian(config)`. The detector must be constructed by `useManagedProfile`, not directly in `config.engines`, which requires coordination between the two hooks. Documentation must be explicit about this coupling.

---

### ADR-0019: ThreatId Obfuscation Scope — Internal vs External

**Status:** Accepted

**Context:** Obfuscation could be applied either (A) at the EventBus level (all internal SDK code sees numeric IDs) or (B) only at the action dispatch boundary (SDK internals use string IDs; host application receives numeric IDs).

**Decision:** Option B — obfuscation is applied only at the action dispatch boundary. Internal SDK code always uses string `ThreatId` values for clarity, correctness, and compatibility with existing tools (PolicyEngine, OODAController, BehavioralBaselineDetector all work with string IDs). The obfuscation layer is a narrow adapter at the outermost edge of the SDK.

**Consequences:** An attacker who can read SDK-internal variables at runtime sees real ThreatId strings. This is accepted: obfuscation targets static analysis and bundle scanning, not a fully compromised runtime.

---

### ADR-0020: ObfuscationLayer randomInt Source

**Status:** Accepted

**Context:** `crypto.randomInt` is not available in React Native without a polyfill. Options: (A) use `Math.random()` (not cryptographically secure); (B) use `crypto.getRandomValues` via polyfill; (C) call native module to generate mapping.

**Decision:** Option B — `crypto.getRandomValues` via `react-native-get-random-values`. This polyfill is already a peer dependency of many RN cryptography packages and can be documented as a peer dependency of `guardian-rn`. The mapping only needs to be unguessable to a static analyser, not to a CSPRNG adversary, but using a proper CSPRNG is always better.

**Consequences:** `react-native-get-random-values` becomes a peer dependency. Expo users get it via `expo-random` or `expo-crypto`. This is documented in the migration guide.

---

### ADR-0021: PolicyStore Remote Schema Versioning

**Status:** Accepted

**Context:** The remote `PolicyDocument` includes a `version` field. The SDK must decide what to do when the remote version is newer than the SDK version. Options: (A) accept all valid policies regardless of version; (B) reject documents with a major version higher than the SDK supports.

**Decision:** Option A for v1.1.0 — validate individual policy fields (valid ThreatId key, valid ResponsePolicy value); ignore unknown fields; accept any `version` string. Version-gated rejection is deferred to v1.2.0 when a formal policy schema versioning protocol is established.

**Consequences:** A remote document with unknown ThreatIds is accepted with those entries silently omitted. This is safe — unknown threats default to `'telemetry'` via `DEFAULT_POLICIES` fallback.

---

### ADR-0022: DeviceAuthDetector — One Class vs Two

**Status:** Accepted

**Context:** `getDeviceAuthStatus()` returns both `passcodeSet` and `biometricAvailable`. Representing this with one `DeviceAuthDetector` that has a single `threatId` would require either (A) always returning the higher-severity result or (B) extending the `Detector` interface to return multiple results. Two separate detector classes are option (C).

**Decision:** Option C — two separate detector classes (`PasscodeMissingDetector`, `BiometricMissingDetector`). The `Detector` interface is stable and its single-result contract is a key simplicity property. The cost of two native calls per scan cycle is acceptable; if it is measured to be a problem in F-11 benchmarks, optimisation is deferred to v1.2.0.

**Consequences:** `CommunityEngine`'s default detector list grows by two. The scan `activeChecks` health tick includes both ThreatIds. `Promise.allSettled` handles both independently, so one failing does not prevent the other from reporting.

---

### ADR-0023: Scan Benchmark Advisory vs Mandatory Gate

**Status:** Accepted

**Context:** Performance benchmarks are inherently environment-sensitive. A strict mandatory gate (failing PRs) would cause false failures on slow CI runners. Two options: (A) advisory gate (logged, not failing) in v1.1.0, mandatory in v1.2.0; (B) mandatory from day one with a generous threshold.

**Decision:** Option A — advisory in v1.1.0. The p95 < 200 ms threshold is recorded as a baseline. If a PR regresses beyond it, a warning annotation appears on the PR. The threshold becomes a mandatory gate in v1.2.0 after baseline data from the real CI environment establishes the natural variance.

**Consequences:** Performance regressions in v1.1.0 may ship undetected. This risk is accepted: v1.1.0 adds no known performance-intensive code in the scan path, and the p95 < 200 ms threshold is 20x the theoretical minimum for the benchmark, providing substantial headroom.

---

## 7. Backwards Compatibility Summary

| Feature | Breaking Change | Migration Required |
|---|---|---|
| F-01 OODAController | No — `config.ooda` is optional | None |
| F-02 EventBus Fast-Path | No — `fastPathThreshold` is optional, default is 0.9 | None |
| F-03 Engine.throttle | No — optional method; existing engines compile and run | None |
| F-04 Signed Telemetry | YES — `TelemetryAdapter.recordThreat` gains a second parameter | Add `_signPayload` parameter to existing adapters |
| F-05 InstallationSourceDetector | No — additive detector | None |
| F-06 Session Expiry | No — `sessionMaxAgeMs` is optional; `'sessionExpiry'` ThreatId is additive | Exhaustive switch on ThreatId needs new case |
| F-07 BehavioralBaselineDetector | No — opt-in Engine | None |
| F-08 PolicyStore | No — `policyEndpoint` is optional | None |
| F-09 ManagedProfileDetector | No — opt-in detector | None |
| F-10 Security Tests | No — new test file only | None |
| F-11 Scan Benchmarks | No — new package only | None |
| F-12 ThreatId Obfuscation | No — `obfuscateThreatIds` defaults to false | None |
| F-13 DeviceAuthDetector | No — additive detectors; ThreatIds already in schema | None |

The single breaking change is F-04 (`TelemetryAdapter.recordThreat`). Adopters who implement a custom `TelemetryAdapter` must add the second parameter. The existing call signature in `PolicyEngine.apply()` currently passes no second argument — the compiler will flag this once the interface is updated, making the migration mechanical. The built-in no-op telemetry adapter and the collector adapter are updated as part of the feature.

---

## 8. Open Questions and Risks

### 8.1 BehavioralBaselineDetector Learning Period

The 5-minute learning window means the detector provides no protection in the first 5 minutes of every session. An attacker who can time their attack to the first 5 minutes of an app session can exploit this. Mitigations considered:

- Load a pre-computed baseline from the last session (via `EncryptedStoragePort`). Deferred to v1.2.0.
- Use a shorter window with a higher default multiplier. Increases false positive rate.
- Accept this limitation in v1.1.0 and document it.

**Decision:** Accept the limitation; document it explicitly. The detector adds value for attacks that develop over time (gradual instrumentation ramp-up) which is its primary use case.

### 8.2 PolicyStore URL Trust

The `policyEndpoint.url` is supplied by the host application. A misconfigured URL pointing to an attacker-controlled server could deliver policies that degrade security (e.g., setting all policies to `'telemetry'`). Mitigations:

- The SDK could enforce that remote policies cannot lower the security level of `config.policies` (caller-supplied overrides always win — this is the current design).
- The SDK could enforce HTTPS-only URLs. This is added as a validation in `PolicyStore.load()` for v1.1.0.
- Certificate pinning is left to the adopter.

### 8.3 ObfuscationLayer and React Native Hot Reload

In development mode with hot reload enabled, `useGuardian` may remount, generating a new `ObfuscationLayer` with a new mapping. If the host application caches the previous mapping (e.g., for logging purposes), it will become stale. This is a development-mode-only concern and is documented in the SDK guide.

### 8.4 NativeModules Availability in New Architecture

F-05, F-09, and F-13 all rely on `NativeModules.GuardianRN.XXX()` for new native method calls. Under the New Architecture (Bridgeless mode), `NativeModules` access patterns may differ from the legacy bridge. The v1.1.0 native implementation must verify compatibility with Bridgeless RN (0.74+ default configuration) and update the TurboModule spec (`NativeGuardianRN.ts`) with the new method signatures. This is tracked as a native implementation task outside this document's scope.

### 8.5 sessionExpiry Timer Accuracy

`setTimeout` in React Native is subject to JS thread starvation. On heavily loaded devices, the expiry callback may fire significantly after `sessionMaxAgeMs`. This is documented as a known limitation: `sessionMaxAgeMs` is a minimum age, not an exact cutoff. Applications requiring precise expiry should supplement with a backend-enforced session TTL.

---

*Document end.*

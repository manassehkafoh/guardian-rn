# Engines

guardian-rn uses a pluggable engine architecture (ADR-0004).
Each engine implements the `Engine` interface and is registered with `useGuardian` via `GuardianConfig.engines`.

---

## Built-in engines

### `@guardian-rn/engine-community`

Open-source community engine. Zero licensing cost.

| Detector | ThreatId | Platform | Method |
|---|---|---|---|
| RootDetector | `root` | Android | Su binaries, known root paths |
| DebuggerDetector | `debugger` | Android | `TracerPid` + `isDebuggerConnected()` |
| EmulatorDetector | `emulator` | Android | Build fingerprint + model heuristics |
| HookDetector | `hooks` | Android | Known hook package presence |
| JailbreakDetector | `jailbreak` | iOS | Cydia paths + sandbox escape + dyld injection |
| DebuggerDetector | `debugger` | iOS | `sysctl(KERN_PROC)` P_TRACED flag |
| SimulatorDetector | `simulator` | iOS | Compile-time `#if targetEnvironment(simulator)` + env var |
| HookDetector | `hooks` | iOS | Dyld image name scan |

All detectors return a `confidence: Float` in [0, 1]. Events below 0.5 are suppressed before reaching the EventBus.

### Talsec adapter (stub)

`@guardian-rn/engine-talsec` — full implementation in Phase 7 beta.
Wraps the proprietary Talsec runtime as a guardian-rn `Engine`.

---

## Writing a custom engine

```ts
import type { Engine, EngineContext, EngineHealthTick } from '@guardian/rn';
import type { Observable } from '@guardian/rn';

class MyEngine implements Engine {
  readonly id = 'myorg-engine@1.0.0';

  // Use SimpleSubject or an RxJS Subject
  readonly onThreat: Observable<ThreatEvent>;
  readonly onHealthTick: Observable<EngineHealthTick>;

  async start(ctx: EngineContext): Promise<void> {
    // Initialise your native module here
    // Emit a health tick within 60 000 ms
  }

  async stop(): Promise<void> {
    // Idempotent — may be called multiple times
  }
}
```

### Invariants that must hold

1. `start()` resolves **before** any event is emitted.
2. `stop()` is idempotent — calling it twice must not throw.
3. `onHealthTick` must emit at least once per **60 000 ms** while running.
4. Events emitted after `stop()` resolves are silently dropped by EventBus.
5. The `engineId` field in every `ThreatEvent` must equal `this.id`.

---

## Engine health monitoring

The `onHealthTick` stream is wired to `TelemetryAdapter.recordHealthTick()` by `useGuardian`.
If a tick is not received within 75 000 ms, guardian-rn emits an `engineFault` threat event with
`confidence: 1.0` and `evidence: { engineId, reason: 'health_timeout' }`.

Health timeout detection is implemented in Phase 7.

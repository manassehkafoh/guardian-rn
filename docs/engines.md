# Engines

guardian-rn uses a pluggable engine architecture (ADR-0004).
Each engine implements the `Engine` interface and is registered with `useGuardian` via `GuardianConfig.engines`.

An **engine** is the unit of detection responsibility. It wraps one or more low-level detectors, manages their scan lifecycle, and surfaces results as two typed Observable streams: `onThreat` (security events) and `onHealthTick` (liveness signals). The SDK core — `useGuardian`, `PolicyEngine`, `EventBus` — knows nothing about how detectors work internally; it only consumes these two streams. This separation means you can add, remove, or swap an entire detection strategy without touching any SDK internals.

---

## Built-in engines

### `@guardian-rn/engine-community`

Open-source community engine. Zero licensing cost.

The community engine (`CommunityEngine`) is the default detection layer included in every guardian-rn installation. It runs a fixed set of open-source detectors on a periodic scan cycle, aggregates their results, and emits `ThreatEvent`s only when a detector's confidence score meets the minimum threshold.

#### Detector reference

| Detector | ThreatId | Platform | Detection method | What it looks for |
|---|---|---|---|---|
| `RootDetector` | `root` | Android | Su binary scan + known root paths | Checks for the presence of `su` executables in system directories (`/system/bin/su`, `/system/xbin/su`, `/sbin/su`, etc.), known root-management app packages (Magisk, KernelSU, SuperSU), and whether the system partition has been remounted read-write — all strong indicators that the Android OS privilege model has been broken |
| `DebuggerDetector` | `debugger` | Android | `/proc/self/status` `TracerPid` field + `android.os.Debug.isDebuggerConnected()` | Reads the Linux `TracerPid` field in the process's status file; a non-zero value means another process has attached via `ptrace`, which is the mechanism used by every Android debugger (JDWP, GDB, LLDB). The `isDebuggerConnected()` check covers the Java-layer JDWP path that can be active without a native `ptrace` attachment |
| `EmulatorDetector` | `emulator` | Android | `Build.FINGERPRINT`, `Build.MODEL`, `Build.MANUFACTURER` heuristics | Real devices have unique hardware fingerprints. Emulators (Android Emulator, Genymotion, BlueStacks) populate these fields with known strings (`generic`, `unknown`, `google_sdk`, `Emulator`, `Android SDK built for x86`). The detector scores confidence proportionally to how many of these heuristics match |
| `HookDetector` | `hooks` | Android | Package presence scan for known hook frameworks | Scans the list of installed packages for frameworks that intercept method calls at runtime: Frida (via its gadget APK / server process), Xposed Framework, LSPosed, EdXposed, and similar. Hook frameworks are the primary tool for bypassing in-app security checks, forging API responses, and extracting keys |
| `JailbreakDetector` | `jailbreak` | iOS | Cydia path existence + sandbox escape attempt + dyld injection check | Three independent signals: (1) checks for Cydia and other jailbreak-ecosystem app paths (`/Applications/Cydia.app`, `/private/var/lib/cydia`, `/etc/apt`); (2) attempts to write outside the app sandbox to `/private/jailbreak_test` — on a stock iOS device this fails; on a jailbroken one it may succeed; (3) checks whether any unexpected dynamic libraries have been injected into the process via `dyld` — injection is the core mechanism of iOS tweaks (Substrate, Orion, Theos) |
| `DebuggerDetector` | `debugger` | iOS | `sysctl(KERN_PROC, KERN_PROC_PID)` → `P_TRACED` flag | Calls the `sysctl` syscall with `CTL_KERN / KERN_PROC / KERN_PROC_PID` for the current process PID and inspects the `kp_proc.p_flag` field. The `P_TRACED` bit is set by the kernel whenever a debugger has attached via `ptrace` — this covers LLDB (Xcode debugger), GDB, and tools like `debugserver` |
| `SimulatorDetector` | `simulator` | iOS | Compile-time `#if targetEnvironment(simulator)` + `SIMULATOR_DEVICE_NAME` env var | Two complementary checks: (1) a compile-time Swift preprocessor directive that resolves to `true` only in simulator builds — a release binary compiled for a real device will never trigger this branch; (2) a runtime check for the `SIMULATOR_DEVICE_NAME` environment variable injected by Xcode when running inside the iOS Simulator, which catches the rare case where the binary was compiled for device but is somehow running in a simulated environment |
| `HookDetector` | `hooks` | iOS | `dyld` loaded-image name scan | Iterates over all dynamic libraries currently loaded into the process using `_dyld_image_count` / `_dyld_get_image_name` and checks each path against a list of known hook-framework library names (Substrate, CydiaSubstrate, Substitute, libhooker, FridaGadget). Any match indicates that a runtime hooking layer is present — the primary mechanism for iOS runtime manipulation |

#### How confidence scoring works

Each detector returns a result of the form `{ detected: boolean, confidence: number }` where `confidence` is a float in the range `[0, 1]`. The value reflects how certain the detector is about its finding:

- `0.0` — no signal at all; the check ran cleanly and nothing suspicious was observed
- `0.3–0.49` — weak or ambiguous signal (e.g. one out of five root path checks matched; could be a custom ROM)
- `0.5–0.69` — moderate confidence; multiple independent signals agree
- `0.7–0.89` — high confidence; strong evidence from several independent methods
- `0.9–1.0` — near-certain; all available signals converge on a positive detection

Events with `confidence < 0.5` are suppressed inside `CommunityEngine` before they ever reach the `EventBus`. This threshold keeps false-positive noise out of the policy layer. The PolicyEngine then applies its own thresholds on the events that do arrive:

| Confidence range | PolicyEngine action |
|---|---|
| `0.5 – 0.69` | `onRestrict` — degrade non-critical features, record telemetry |
| `0.7 – 0.89` | `onLockout` — block the session, require re-authentication |
| `≥ 0.9` | `onKill` — start grace-period timer, then terminate the process |

#### Scan cycle and concurrency

`CommunityEngine` runs all detectors in parallel using `Promise.allSettled`. This means:

- A slow or hanging detector does not block the results of fast detectors — each detector's timeout is independent
- A detector that throws an unhandled exception is caught as a `rejected` settlement; the engine calls `ctx.onFault(error)` and continues processing the remaining results — one broken detector never crashes the whole scan
- The full round-trip time for a scan cycle is bounded by the *slowest* detector rather than the sum of all detector latencies

After each scan, detectors that met the confidence threshold emit `ThreatEvent`s through the engine's internal `SimpleSubject`. The `useGuardian` hook has already subscribed the `PolicyEngine` to this stream by the time the first scan runs.

---

### Talsec adapter (stub)

`@guardian-rn/engine-talsec` — full implementation in Phase 7 beta.

This package is a thin guardian-rn `Engine` wrapper around the proprietary Talsec/freeRASP native SDK (the same binary used by `freerasp-react-native`). Once complete, it gives teams that want the broader Talsec detection coverage (malware scanning, AppiCrypt app-attestation, screen-recording on Android 14/15+) access to that capability through the standard guardian-rn engine interface — without requiring a separate SDK integration.

The adapter maps Talsec's 22 threat event types to the canonical guardian-rn `ThreatId` enumeration using the same `fromFreeRaspListeners` logic that powers the CompatLayer. This means teams can run `CommunityEngine` and `TalsecEngine` side-by-side and both feed into the single `PolicyEngine` instance.

---

## Writing a custom engine

The `Engine` interface is the only contract you need to satisfy. There is no registration mechanism to call, no base class to extend, and no SDK-internal import to take on beyond the interface types themselves.

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

#### What each field and method does

**`id: string`**
A globally unique identifier for this engine in the format `<scope>-<name>@<semver>`. This value is stamped onto every `ThreatEvent` emitted by the engine as `event.engineId`. It appears in health ticks, telemetry payloads, and fault records. It is also used by `EngineRegistry` to prevent duplicate registration — if two engines share the same `id`, the registry will reject the second one at startup.

**`onThreat: Observable<ThreatEvent>`**
The stream of security events. Each emission represents a detector concluding that a threat condition was observed with sufficient confidence to warrant a policy response. The `PolicyEngine` is subscribed to this stream by `useGuardian` between `start()` resolving and `stop()` being called. You should back this with a `SimpleSubject` (guardian-rn's lightweight built-in) or an RxJS `Subject` — both implement the same `Observable` interface.

**`onHealthTick: Observable<EngineHealthTick>`**
The liveness heartbeat stream. While the engine is running, it must emit on this stream at least once every 60 000 ms. This is the mechanism by which the SDK knows the engine is still alive and scanning. If 75 000 ms pass without a tick, guardian-rn treats the engine as faulted and emits an `engineFault` threat event with `confidence: 1.0`. `useGuardian` forwards every tick to `config.telemetry?.recordHealthTick()` — this is how health data reaches your observability backend (Datadog, Prometheus, MDAM platform, etc.).

**`start(ctx: EngineContext): Promise<void>`**
Called by `useGuardian` once, on component mount, after the `PolicyEngine` and all subscriptions are in place. The `ctx` object gives the engine everything it needs to operate:
- `ctx.config` — the full `GuardianConfig`, including your custom settings if you extend the config type
- `ctx.sessionId` — a UUID generated fresh for this mount; stamp it on all your telemetry so events from the same session can be correlated
- `ctx.platform` — `'android'` or `'ios'`; use this to skip checks that don't apply to the current platform
- `ctx.onFault(error)` — call this instead of `throw` when a detector encounters an unexpected error; it surfaces the error through the SDK's fault-handling path without crashing the engine or the component

The promise must resolve *before* you emit any events. This guarantees the `PolicyEngine` subscription is live before the first threat event arrives.

**`stop(): Promise<void>`**
Called on component unmount, or when `EngineRegistry.stopAll()` is invoked. Must be idempotent — the SDK may call it multiple times (e.g. React strict-mode double-invocation in development). After `stop()` resolves, any events you emit on `onThreat` will be silently dropped by the `EventBus` — do not rely on emitting after stop for any cleanup signalling.

---

## Engine invariants that must hold

These are not suggestions — violations will cause incorrect SDK behaviour.

**1. `start()` resolves before any event is emitted.**

If you emit a `ThreatEvent` before `start()` resolves, the `PolicyEngine` subscription may not yet be in place. The event will be lost silently. Initialise all detectors and schedule the first scan *inside* the `start()` body, but defer the first emission to a microtask or timer that fires *after* the promise resolves.

**2. `stop()` is idempotent — calling it twice must not throw.**

React's strict mode in development intentionally mounts, unmounts, and re-mounts components. `useGuardian`'s cleanup function calls `engine.stop()` on unmount. If your `stop()` throws on a second call, the component's cleanup will crash silently. Use a `running` boolean guard:

```ts
private running = false;

async stop(): Promise<void> {
  if (!this.running) return;  // already stopped — no-op
  this.running = false;
  clearInterval(this.scanTimer);
}
```

**3. `onHealthTick` must emit at least once per 60 000 ms while running.**

The guardian-rn health-timeout watchdog uses a 75 000 ms window (60 s nominal + 15 s tolerance) to account for JS event-loop jitter. If your engine's scan cycle is longer than 60 s, emit a dedicated heartbeat tick on a separate 30 s timer independent of the scan cycle. The tick payload should include `status: 'ok'` when no fault is active, or `status: 'fault'` with a `reason` string when a detector sub-system has failed but the engine is still running.

**4. Events emitted after `stop()` resolves are silently dropped by the EventBus.**

This is intentional — the `EventBus` unregisters the engine's subscription as part of the cleanup path. Do not use `onThreat` emission as a signal to the host app after stop. If you need to report a final status, do so through `ctx.onFault` or `onHealthTick` before `stop()` resolves.

**5. The `engineId` field in every `ThreatEvent` must equal `this.id`.**

The `EventBus` validates that `event.engineId` matches a registered engine ID. Mismatched IDs cause the event to be rejected by the HMAC verification pipeline (the engine ID is included in the canonical JSON payload that the HMAC is computed over). Always set `engineId: this.id` when constructing `ThreatEvent` objects.

---

## Engine health monitoring

The `onHealthTick` stream is wired to `TelemetryAdapter.recordHealthTick()` by `useGuardian`.
If a tick is not received within 75 000 ms, guardian-rn emits an `engineFault` threat event with
`confidence: 1.0` and `evidence: { engineId, reason: 'health_timeout' }`.

Health timeout detection is implemented in Phase 7.

### What a health tick contains

```ts
interface EngineHealthTick {
  engineId: string;        // matches Engine.id
  ts: number;              // epoch milliseconds
  sessionId: string;       // matches the sessionId from EngineContext
  status: 'ok' | 'fault';
  detectorResults?: Array<{
    detectorId: string;
    lastRunMs: number;     // how long the last scan took
    lastConfidence: number;
    status: 'ok' | 'fault';
  }>;
  reason?: string;         // populated when status === 'fault'
}
```

### How health monitoring works end-to-end

```
CommunityEngine scan cycle completes
          │
          ▼
  onHealthTick.emit({ engineId, ts, sessionId, status: 'ok', detectorResults })
          │
          ▼
  useGuardian subscription fires
          │
          ▼
  configRef.current.telemetry?.recordHealthTick(tick)
          │
          ├──► Datadog custom metric: guardian.engine.health {engineId, status}
          ├──► MDAM compliance feed: structured JSON POST
          └──► internal watchdog: reset(75 000 ms timeout)

  If timeout fires before next tick:
          │
          ▼
  EventBus.publish(ThreatEvent {
    threatId: 'engineFault',
    engineId,
    confidence: 1.0,
    evidence: { reason: 'health_timeout' }
  })
          │
          ▼
  PolicyEngine.apply() → onKill (confidence 1.0 exceeds kill threshold 0.9)
```

The `confidence: 1.0` assignment is intentional — a silent engine is treated with maximum certainty because the silence itself is evidence of tampering or crash. An attacker who kills the monitoring loop to operate undetected triggers the same kill policy as an attacker who is actively detected.

### Recommended health tick intervals

| Engine type | Recommended tick interval | Rationale |
|---|---|---|
| Lightweight (JS-only detectors) | Every scan cycle, 15–30 s | Scan and tick are the same event |
| Heavyweight (native module calls) | 30 s tick; 60 s scan | Decouple heartbeat from slow scan so liveness is not contingent on scan completion |
| Network-dependent engine | 20 s tick; variable scan | Network latency makes scan time unpredictable; heartbeat must be independent |
| Background-suspended engine | Emit tick immediately on `start()`; then ≤60 s | On iOS, background execution time is limited; ensure a tick lands before the app may be suspended |

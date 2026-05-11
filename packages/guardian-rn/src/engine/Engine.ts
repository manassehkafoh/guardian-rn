import type { Observable } from '../types/Observable.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine context — supplied by useGuardian to every engine at start()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The execution context passed to Engine.start(). Contains everything an
 * engine needs to operate without taking on a direct dependency on the SDK
 * internals — keeping the Engine interface portable and testable.
 *
 * The context is constructed fresh on each useGuardian mount, which means
 * each React component re-mount produces a new sessionId and a new session key.
 */
export interface EngineContext {
  /**
   * The full GuardianConfig passed to useGuardian(). Engines can read
   * tenantId, policies, and any custom fields they extend the config with.
   * Engines must not mutate this object.
   */
  readonly config: GuardianConfig;

  /**
   * UUIDv4 generated fresh on each useGuardian mount. All ThreatEvents and
   * health ticks from this engine should carry this sessionId so downstream
   * consumers can correlate events from the same logical session.
   */
  readonly sessionId: string;

  /**
   * 'android' or 'ios'. Engines use this to skip checks that don't apply to
   * the running platform — e.g. JailbreakDetector skips on Android, and
   * RootDetector skips on iOS.
   */
  readonly platform: 'android' | 'ios';

  /**
   * True when the app process is running inside an Android managed work profile
   * administered by an MDM (e.g. Microsoft Intune, JAMF, Samsung KNOX).
   *
   * Engines can use this to contextualise detections — for example, root
   * detection in a managed profile may indicate the MDM itself has elevated
   * privileges, which is expected behaviour rather than a threat.
   *
   * Always false on iOS (iOS has no equivalent of the Android work profile model).
   */
  readonly managedProfile: boolean;

  /**
   * Report an unrecoverable error from a detector sub-system. Calling this
   * instead of throwing keeps the engine running — the SDK surfaces the fault
   * through the health monitoring path without crashing the component.
   *
   * Use for errors that are recoverable across scan cycles (a detector's
   * native module returned an unexpected error) rather than for errors that
   * indicate the engine itself is broken (those warrant stop() + re-mount).
   */
  onFault(error: Error): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health tick — emitted by engines to prove liveness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A liveness heartbeat emitted by each engine at regular intervals.
 *
 * The SDK's health watchdog expects at least one tick every 60 000 ms.
 * If 75 000 ms pass without a tick, guardian-rn synthesises an `engineFault`
 * threat event with confidence 1.0 — which under DEFAULT_POLICIES flows
 * through as a telemetry event, but tenants may escalate it via config.
 *
 * The 75 000 ms tolerance (60 s + 15 s) accounts for JS event-loop jitter
 * and occasional GC pauses.
 */
export interface EngineHealthTick {
  /** Must match Engine.id — validated by the telemetry layer. */
  readonly engineId: string;

  /** Device-clock Unix epoch milliseconds at the time of emission. */
  readonly ts: number;

  /**
   * Matches EngineContext.sessionId. Used by the backend to correlate
   * health ticks with threat events from the same session.
   */
  readonly sessionId: string;

  /**
   * 'ok' — the engine is running normally.
   * 'fault' — one or more detectors have faulted but the engine is still alive.
   *   When 'fault', populate `reason` with a human-readable description.
   */
  readonly status: 'ok' | 'fault';

  /**
   * List of threat IDs being actively checked during this scan cycle.
   * Useful for confirming that a detector is actually running after deployment.
   */
  readonly activeChecks?: readonly string[];

  /**
   * Per-detector diagnostic snapshot. Optional — include when you want
   * granular visibility into individual detector performance and health.
   *
   * `lastRunMs`: how long the detector's last run() call took (wall clock).
   * `lastConfidence`: the raw confidence value the detector returned.
   * `status`: whether the detector completed cleanly or threw.
   */
  readonly detectorResults?: ReadonlyArray<{
    readonly detectorId: string;
    readonly lastRunMs: number;
    readonly lastConfidence: number;
    readonly status: 'ok' | 'fault';
  }>;

  /**
   * Human-readable fault description. Only set when status === 'fault'.
   * Written to telemetry as-is — do not include PII or secret material.
   */
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine interface — the only contract the SDK cares about
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pluggable detection engine contract. Per ADR-0004.
 *
 * An engine is the unit of detection responsibility. It wraps one or more
 * low-level detectors, manages their scan lifecycle, and surfaces results
 * through two Observable streams. The SDK core never imports any concrete
 * engine class — it only ever holds Engine references.
 *
 * ── Ordering invariants ────────────────────────────────────────────────────
 *
 * 1. start() resolves BEFORE any event is emitted on onThreat.
 *    The PolicyEngine subscription is wired by useGuardian after start()
 *    resolves. Emitting before that point silently loses the event.
 *
 * 2. stop() is idempotent. React's strict mode mounts and unmounts
 *    components twice in development. A second stop() call must be a no-op.
 *
 * 3. Events emitted AFTER stop() resolves are silently dropped by the SDK.
 *    Do not use onThreat emission for post-stop signalling.
 *
 * 4. onHealthTick must emit at least once per 60 000 ms while running.
 *    A 75 000 ms silence triggers an engineFault event with confidence 1.0.
 *
 * 5. Every ThreatEvent emitted must carry engineId === this.id.
 *    The HMAC verification pipeline includes engineId in the canonical
 *    payload; a mismatch causes the event to be rejected by EventBus.
 */
export interface Engine {
  /**
   * Globally unique identifier in the format `<scope>-<name>@<semver>`.
   * e.g. "community@1.0.0", "myorg-engine@2.3.1"
   *
   * Stamped on every ThreatEvent and EngineHealthTick emitted by this engine.
   * Used by EngineRegistry to prevent duplicate registration.
   */
  readonly id: string;

  /**
   * Initialise the engine and begin the scan lifecycle.
   *
   * This is the entry point for all native module setup, timer creation,
   * and subscription wiring. The returned Promise must resolve only after
   * all internal state is ready — including subscribing to any upstream
   * Observables — so that the first emitted event will not be lost.
   */
  start(context: EngineContext): Promise<void>;

  /**
   * Stop all scanning activity and release resources.
   *
   * Must be idempotent: a second call after the engine has already stopped
   * must return without error and without side effects. Typically implemented
   * with a `running` boolean guard.
   *
   * The SDK calls stop() on component unmount and when EngineRegistry.stopAll()
   * is invoked. Any subscriptions, intervals, or native listeners created in
   * start() must be cleaned up here.
   */
  stop(): Promise<void>;

  /**
   * Stream of security threat events. Each emission represents a detector
   * concluding that a threat condition was observed with sufficient confidence.
   *
   * Back this with a SimpleSubject (built-in) or an RxJS Subject — both
   * implement the Observable interface. Never share a subject between two
   * Engine instances.
   */
  readonly onThreat: Observable<ThreatEvent>;

  /**
   * Stream of liveness heartbeats. The SDK's health watchdog subscribes
   * here to track whether the engine is still scanning. Emit at least once
   * per 60 000 ms; the recommended interval is 30 000 ms for lightweight
   * engines and a separate 30 s heartbeat timer for heavyweight ones.
   */
  readonly onHealthTick: Observable<EngineHealthTick>;

  /**
   * Optional battery-aware scan throttle.
   *
   * Called by useGuardian whenever the React Native AppState changes:
   *   - 'foreground': app is visible and interactive — scan at full rate.
   *   - 'background': app is backgrounded — reduce scan frequency to
   *     conserve CPU and battery life.
   *
   * Engines that implement this should quadruple (or more) their scan
   * interval in background mode while keeping the health tick on its
   * independent 30 s timer so the watchdog is not triggered.
   *
   * Engines that omit this method remain fully valid and always scan
   * at their configured interval regardless of app state.
   */
  throttle?(mode: 'foreground' | 'background'): void;
}

import type { Engine, EngineContext, EngineHealthTick } from '@guardian/rn/src/engine/Engine.js';
import type { ThreatEvent } from '@guardian/rn/src/events/ThreatEvent.js';
import type { Observable, Observer, Subscription } from '@guardian/rn/src/types/Observable.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_ID = 'community-behavioral@1.0.0';

/**
 * Default rolling window: 60 seconds. Threats within this window are counted
 * toward the anomaly threshold. A 60 s window balances sensitivity (catching
 * multi-stage attacks) against specificity (avoiding false positives from
 * unrelated detections that happen to cluster in time).
 */
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Default anomaly threshold: 5 distinct threats in the window triggers an
 * alert. Human users rarely trigger more than 1–2 detectors in a session;
 * automated attack tooling (Frida scripts, automated scanners) typically
 * triggers many detectors in rapid succession.
 *
 * Lower this for high-security contexts; raise it if your user population
 * legitimately runs in environments that trigger multiple detections
 * (e.g. developer devices in a BYOD COPE scheme).
 */
const DEFAULT_ANOMALY_THRESHOLD = 5;

const HEALTH_INTERVAL_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Observable implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal hot Subject implementation. Shared with CommunityEngine to avoid
 * an external RxJS dependency while keeping the Observable contract intact.
 */
class SimpleSubject<T> implements Observable<T> {
  private readonly observers = new Set<Observer<T>>();

  subscribe(observer: Observer<T>): Subscription {
    this.observers.add(observer);
    return { unsubscribe: () => this.observers.delete(observer) };
  }

  emit(value: T): void {
    for (const obs of this.observers) obs.next(value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration interface
// ─────────────────────────────────────────────────────────────────────────────

export interface BehavioralBaselineConfig {
  /** Rolling window for counting distinct threat events. Default: 60 000 ms. */
  readonly windowMs?: number;

  /**
   * Number of distinct threat events within the window that triggers a
   * `behavioralAnomaly` emission. Default: 5.
   *
   * Each event counted here is a *distinct* ThreatEvent as seen by this
   * engine. Multiple emissions of the same threatId from a single scan cycle
   * are collapsed by the EventBus dedup window before they reach this engine,
   * so in practice each entry in the window represents a different scan cycle
   * or a different threat type.
   */
  readonly anomalyThreshold?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BehavioralBaselineEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dynamic behavioral baseline detector — implements the Engine interface
 * rather than the Detector interface. Per ADR-0016.
 *
 * ── Why Engine, not Detector? ─────────────────────────────────────────────
 *
 * The Detector interface (run() → DetectorResult) models a single-shot check
 * that returns a result when polled. BehavioralBaselineEngine must observe
 * the *live stream* of threat events to compute its rolling frequency baseline.
 * It cannot do this as a Detector because Detectors have no access to the
 * event stream — they only see their own execution context.
 *
 * By implementing Engine, BehavioralBaselineEngine can call observeEngine()
 * to subscribe directly to another engine's onThreat Observable, giving it
 * full visibility into the running threat stream without coupling to the
 * internals of CommunityEngine or any other engine.
 *
 * ── What it detects ───────────────────────────────────────────────────────
 *
 * Automated attack tooling (Frida scripts, vulnerability scanners) tends to
 * trigger many detectors in rapid succession — a pattern no legitimate user
 * exhibits during normal app usage. When the count of distinct threat events
 * within the rolling window reaches anomalyThreshold, this engine emits a
 * `behavioralAnomaly` event.
 *
 * The emitted event's confidence scales linearly with the event count:
 *   confidence = min(1.0, eventCount / anomalyThreshold)
 *
 * This means:
 *   – At exactly anomalyThreshold events: confidence = 1.0
 *   – At 2× anomalyThreshold events:     confidence = 1.0 (capped)
 *
 * ── How to wire it up ─────────────────────────────────────────────────────
 *
 *   const community  = new CommunityEngine();
 *   const behavioral = new BehavioralBaselineEngine();
 *   behavioral.observeEngine(community);   // subscribe to community's stream
 *
 *   useGuardian({
 *     engines: [community, behavioral],    // both registered as engines
 *     ...
 *   });
 *
 * Note: observeEngine() must be called BEFORE start() to avoid a race where
 * the first threat events from community arrive before the subscription is live.
 */
export class BehavioralBaselineEngine implements Engine {
  readonly id = ENGINE_ID;

  private readonly threatSubject = new SimpleSubject<ThreatEvent>();
  private readonly healthSubject = new SimpleSubject<EngineHealthTick>();
  readonly onThreat:     Observable<ThreatEvent>    = this.threatSubject;
  readonly onHealthTick: Observable<EngineHealthTick> = this.healthSubject;

  private readonly windowMs: number;
  private readonly anomalyThreshold: number;

  /**
   * Timestamps of threat events received within the current window.
   * Entries outside windowMs are pruned lazily on each record() call.
   */
  private eventTimestamps: number[] = [];

  /** Guard against emitting after stop() — satisfies Engine invariant #3. */
  private running = false;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private context: EngineContext | null = null;

  /**
   * Subscription to the upstream engine's onThreat stream.
   * Set by observeEngine(); cleared by stop().
   */
  private upstreamSub: Subscription | null = null;

  constructor(cfg: BehavioralBaselineConfig = {}) {
    this.windowMs         = cfg.windowMs         ?? DEFAULT_WINDOW_MS;
    this.anomalyThreshold = cfg.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD;
  }

  /**
   * Subscribe to another engine's threat stream.
   *
   * This is how BehavioralBaselineEngine observes the system's live threat
   * activity. Call this once before passing the engine to useGuardian().
   *
   * Calling this again replaces any existing subscription — useful if the
   * upstream engine is replaced at runtime, though this is uncommon.
   *
   * @param sourceEngine  Any object with an onThreat Observable. Typically a
   *                      CommunityEngine instance, but can be any engine.
   */
  observeEngine(sourceEngine: { onThreat: Observable<ThreatEvent> }): void {
    this.upstreamSub?.unsubscribe();
    this.upstreamSub = sourceEngine.onThreat.subscribe({
      next: (event) => this.record(event),
    });
  }

  async start(context: EngineContext): Promise<void> {
    if (this.running) return; // idempotent — satisfies Engine invariant #2
    this.context = context;
    this.running = true;

    // Start the health tick timer immediately. This engine has no scan cycle
    // of its own — it reacts to events rather than polling — so the timer
    // is the only thing keeping the health watchdog satisfied.
    this.healthTimer = setInterval(() => this.emitHealthTick(), HEALTH_INTERVAL_MS);

    // Emit an initial tick immediately so the watchdog does not wait up to
    // HEALTH_INTERVAL_MS before receiving the first confirmation of liveness.
    this.emitHealthTick();
  }

  async stop(): Promise<void> {
    if (!this.running) return; // idempotent — satisfies Engine invariant #2
    this.running = false;

    // Unsubscribe from the upstream engine first. Any events that arrive
    // after this point will not call record() and cannot trigger emissions.
    this.upstreamSub?.unsubscribe();
    this.upstreamSub = null;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.context = null;
  }

  /**
   * Number of events currently within the rolling window.
   * Exposed for testing; also useful for diagnostics dashboards.
   */
  get windowEventCount(): number {
    this.prune(Date.now());
    return this.eventTimestamps.length;
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Process an incoming threat event from the upstream engine.
   *
   * Records the event timestamp in the rolling window, prunes stale entries,
   * and emits a `behavioralAnomaly` event if the threshold is reached.
   *
   * Called synchronously from the upstream engine's onThreat subscription —
   * must not block or throw. All state mutations are guarded by the
   * `running` check to prevent post-stop activity.
   */
  private record(event: ThreatEvent): void {
    if (!this.running) return;

    // Use the event's own timestamp so that replayed or time-shifted events
    // are placed correctly in the window. Falls back to Date.now() only if
    // the engine emitted a zero or undefined ts (which should not happen in
    // a correctly implemented engine, but ts is a runtime value).
    const now = event.ts ?? Date.now();
    this.eventTimestamps.push(now);
    this.prune(now);

    // Emit behavioralAnomaly when the event count reaches the threshold.
    //
    // Confidence formula: min(1.0, count / threshold).
    //   – At exactly threshold:   confidence = 1.0
    //   – Below threshold:        confidence < 1.0 (this branch never fires below threshold)
    //   – Above threshold:        confidence = 1.0 (capped)
    //
    // The evidence payload carries the full diagnostic context so the
    // backend can distinguish between a threshold-exact anomaly (5/5) and
    // a heavily elevated one (e.g. 12/5, confidence 1.0 after cap).
    if (this.eventTimestamps.length >= this.anomalyThreshold) {
      this.threatSubject.emit({
        threatId:   'behavioralAnomaly',
        severity:   'high',
        confidence: Math.min(1.0, this.eventTimestamps.length / this.anomalyThreshold),
        evidence: {
          windowMs:     String(this.windowMs),
          eventCount:   String(this.eventTimestamps.length),
          threshold:    String(this.anomalyThreshold),
          triggeredBy:  event.threatId, // the event that pushed the count over the edge
        },
        ts:       now,
        engineId: ENGINE_ID,
      });
    }
  }

  /**
   * Remove timestamps that have aged out of the rolling window.
   * Uses filter() for simplicity — the array stays small in practice
   * (bounded by scan rate and window duration).
   */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);
  }

  private emitHealthTick(): void {
    this.healthSubject.emit({
      engineId:  ENGINE_ID,
      ts:        Date.now(),
      sessionId: this.context?.sessionId ?? '',
      status:    'ok',
      // No detectorResults — this engine has no detectors of its own;
      // it derives its state purely from the upstream threat stream.
    });
  }
}

import { verifyEnvelope } from '../core/HmacEnvelope.js';
import { SequenceTracker } from '../core/SequenceTracker.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { Engine, EngineHealthTick } from '../engine/Engine.js';
import type { BusConfig } from '../config/GuardianConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conservative defaults that protect the policy layer from noisy or
 * misbehaving engines without affecting normal operation.
 *
 * dedupWindowMs=100: Collapses a burst of the same threatId within 100 ms
 *   to a single event. This handles the common case where a scan completes
 *   and re-emits on the very next interval before the previous event has been
 *   processed. Tight enough not to suppress re-detections across scan cycles.
 *
 * rateCapPerSecond=50: Allows up to 50 distinct events per second per engine.
 *   A typical CommunityEngine emits ≤ 10 events per scan. 50 is a generous
 *   ceiling that only triggers if an engine enters an infinite emit loop.
 *
 * fastPathEnabled=true: Kill-level events (confidence ≥ kill threshold) bypass
 *   both dedup and rate-cap. See routeThreat() for full rationale.
 */
const DEFAULT_BUS_CONFIG: BusConfig = {
  dedupWindowMs: 100,
  rateCapPerSecond: 50,
  fastPathEnabled: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler types
// ─────────────────────────────────────────────────────────────────────────────

export type ThreatHandler = (event: ThreatEvent) => void;
export type HealthHandler = (tick: EngineHealthTick) => void;
export type FaultHandler  = (engineId: string, error: Error) => void;

// ─────────────────────────────────────────────────────────────────────────────
// EventBus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central message bus for all threat and health events in the SDK.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────
 *
 * The EventBus sits between the engines and the PolicyEngine:
 *
 *   Engines → [HMAC verify] → [replay check] → [dedup] → [rate-cap] → PolicyEngine
 *                                                        ↑ bypassed by fast-path ↑
 *
 *   1. HMAC verification: envelopes from the native bridge are verified
 *      against the per-session key before any payload is trusted.
 *
 *   2. Replay / wrong-session detection: SequenceTracker rejects events
 *      with a sequence number that has already been seen, or events that
 *      carry a sessionId not matching the current session.
 *
 *   3. Deduplication: the same threatId within dedupWindowMs is collapsed
 *      to a single event. Prevents burst re-emission from fast scan cycles.
 *
 *   4. Rate-capping: an engine that emits more than rateCapPerSecond events
 *      in a sliding 1-second window is throttled. Dropped events are counted
 *      in EventBus.dropped.
 *
 *   5. Fast-path: events at or above the kill threshold skip steps 3 and 4.
 *      See routeThreat() for the security rationale.
 *
 * ── Thread safety ─────────────────────────────────────────────────────────
 *
 * JavaScript is single-threaded, so there are no concurrent write races.
 * All methods are synchronous and can be called freely from the JS event loop.
 *
 * Per ADR-0004.
 */
export class EventBus {
  private readonly config: BusConfig;
  private readonly sessionKey: Uint8Array;
  private readonly tracker: SequenceTracker;

  /**
   * Events at or above this confidence value are fast-pathed directly to
   * handlers, bypassing dedup and rate-cap. Defaults to DEFAULT_CONFIDENCE_THRESHOLDS.kill.
   * The constructor accepts this as a parameter so the value can be kept in
   * sync with the effective kill threshold (which may differ from the default
   * when GuardianConfig.confidenceThresholds.kill is overridden).
   */
  private readonly killThreshold: number;

  private threatHandlers = new Set<ThreatHandler>();
  private healthHandlers = new Set<HealthHandler>();
  private faultHandlers  = new Set<FaultHandler>();

  // Dedup state: maps threatId → timestamp of the last forwarded event.
  // Entries are never deleted; they expire implicitly when the timestamp
  // is older than dedupWindowMs.
  private readonly dedupMap = new Map<string, number>();

  // Rate-cap state: maps engineId → { count of events this second, window start time }.
  // The window resets when the current time has moved more than 1 000 ms past windowStart.
  private readonly rateMap = new Map<string, { count: number; windowStart: number }>();

  /** Total events dropped by rate-cap since construction. Accessible for monitoring. */
  private droppedCount = 0;

  /**
   * @param sessionKey  32-byte HMAC key for this session. Used to verify HMAC envelopes.
   * @param sessionId   UUID of the current session. Used by SequenceTracker to detect
   *                    cross-session replay attempts.
   * @param config      Optional partial override of bus defaults.
   * @param killThreshold Confidence value at or above which events take the fast-path.
   *                      Defaults to 0.9 (DEFAULT_CONFIDENCE_THRESHOLDS.kill).
   */
  constructor(
    sessionKey: Uint8Array,
    sessionId: string,
    config?: Partial<BusConfig>,
    killThreshold = 0.9,
  ) {
    this.sessionKey = sessionKey;
    this.tracker = new SequenceTracker(sessionId);
    this.config = { ...DEFAULT_BUS_CONFIG, ...config };
    this.killThreshold = killThreshold;
  }

  /**
   * Subscribe to an engine's onThreat and onHealthTick streams.
   * Returns an unsubscribe function; call it to detach the engine.
   *
   * Errors on the onThreat stream are routed to fault handlers rather than
   * propagating to the engine, which would cancel the Observable subscription.
   */
  attachEngine(engine: Engine): () => void {
    const threatSub = engine.onThreat.subscribe({
      next: (event) => this.routeThreat(event, engine.id),
      error: (err) => this.routeFault(engine.id, err instanceof Error ? err : new Error(String(err))),
    });

    const healthSub = engine.onHealthTick.subscribe({
      next: (tick) => this.routeHealth(tick),
    });

    return () => {
      threatSub.unsubscribe();
      healthSub.unsubscribe();
    };
  }

  /**
   * Process an HMAC-signed envelope received from the native bridge (JSI path).
   *
   * The envelope must have been signed with the session key provided at
   * construction. Any HMAC mismatch, sequence replay, or wrong-session event
   * is silently dropped (fault handlers are notified for mismatches).
   *
   * Events that pass verification enter the same routeThreat() pipeline as
   * events from JS-side engines — HMAC verification is the only difference.
   */
  processEnvelope(envelope: GuardianEnvelope, engineId: string): void {
    const result = verifyEnvelope(envelope, this.sessionKey);
    if (!result.ok) {
      // HMAC mismatch: either a tampered payload or an event from a different
      // session. Route to fault handlers so the host app can log/respond.
      this.routeFault(engineId, new Error(`HMAC_MISMATCH — seq ${envelope.seq}`));
      return;
    }

    const seqResult = this.tracker.check(envelope.seq, envelope.sessionId);
    if (seqResult === 'replay') return;       // exact replay — drop silently
    if (seqResult === 'wrong_session') return; // cross-session injection — drop silently
    // 'gap' and 'rollover' are tolerated: they indicate lost events or wrapping,
    // which is logged by the SequenceTracker but the current event is still forwarded.

    const event: ThreatEvent = {
      ...result.payload,
      engineId,
    };
    this.routeThreat(event, engineId);
  }

  /**
   * Register a handler for forwarded threat events.
   * Returns an unsubscribe function.
   */
  onThreat(handler: ThreatHandler): () => void {
    this.threatHandlers.add(handler);
    return () => this.threatHandlers.delete(handler);
  }

  /** Register a handler for engine health ticks. Returns an unsubscribe function. */
  onHealth(handler: HealthHandler): () => void {
    this.healthHandlers.add(handler);
    return () => this.healthHandlers.delete(handler);
  }

  /** Register a handler for engine faults (HMAC failures, stream errors). */
  onFault(handler: FaultHandler): () => void {
    this.faultHandlers.add(handler);
    return () => this.faultHandlers.delete(handler);
  }

  /** Total events dropped by the rate-cap since this bus was created. */
  get dropped(): number {
    return this.droppedCount;
  }

  // ── private routing ──────────────────────────────────────────────────────

  /**
   * Core routing method. Applies fast-path, rate-cap, and dedup in order,
   * then delivers to all registered threat handlers.
   *
   * ── Fast-path rationale ────────────────────────────────────────────────
   *
   * A kill-level event (confidence ≥ killThreshold) represents the highest-
   * priority security signal in the system. Two failure modes motivate the
   * fast-path:
   *
   *   1. Dedup could suppress the event: if an attacker is repeatedly
   *      triggering the same critical detection, the 100 ms dedup window
   *      would suppress all but the first. The PolicyEngine might miss the
   *      event if it was not yet subscribed during the first emission.
   *
   *   2. Rate-cap could drop it: a burst of lower-confidence events from the
   *      same engine could exhaust the rate cap, causing a subsequent critical
   *      event to be dropped — exactly the scenario a sophisticated attacker
   *      might engineer deliberately.
   *
   * The fast-path completely bypasses both controls for critical events.
   * This means a kill-level event ALWAYS reaches the PolicyEngine.
   *
   * Trade-off: a malicious engine could emit fabricated kill-level events
   * to flood the PolicyEngine. This is mitigated by HMAC verification and
   * sequence tracking upstream — only events from trusted engine sources
   * reach routeThreat(). Engines registered via useGuardian() are always
   * trusted by definition.
   */
  private routeThreat(event: ThreatEvent, engineId: string): void {
    if (this.config.fastPathEnabled && event.confidence >= this.killThreshold) {
      // Critical event: deliver unconditionally, skip all pipeline stages.
      this.threatHandlers.forEach((h) => h(event));
      return;
    }

    // Normal path: apply rate-cap then dedup.
    if (this.isRateCapped(engineId)) {
      this.droppedCount++;
      return;
    }
    if (this.isDuplicate(event.threatId)) return;

    this.markSeen(event.threatId);
    this.threatHandlers.forEach((h) => h(event));
  }

  private routeHealth(tick: EngineHealthTick): void {
    this.healthHandlers.forEach((h) => h(tick));
  }

  private routeFault(engineId: string, error: Error): void {
    this.faultHandlers.forEach((h) => h(engineId, error));
  }

  /**
   * Returns true if a threat with the same ID was forwarded within the
   * dedup window. Does not mutate state — call markSeen() to update.
   */
  private isDuplicate(threatId: string): boolean {
    const last = this.dedupMap.get(threatId);
    return last !== undefined && Date.now() - last < this.config.dedupWindowMs;
  }

  /** Record the current time as the last-seen timestamp for a threatId. */
  private markSeen(threatId: string): void {
    this.dedupMap.set(threatId, Date.now());
  }

  /**
   * Sliding-window rate limiter per engine.
   *
   * When the window (1 second) has elapsed since windowStart, reset the
   * counter. Otherwise increment and check against rateCapPerSecond.
   *
   * Returns true (event should be dropped) if the engine has exceeded its
   * per-second quota.
   */
  private isRateCapped(engineId: string): boolean {
    const now = Date.now();
    const state = this.rateMap.get(engineId) ?? { count: 0, windowStart: now };

    if (now - state.windowStart >= 1000) {
      // New 1-second window: reset counter.
      state.count = 1;
      state.windowStart = now;
      this.rateMap.set(engineId, state);
      return false;
    }

    state.count++;
    this.rateMap.set(engineId, state);
    return state.count > this.config.rateCapPerSecond;
  }
}

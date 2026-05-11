import type { AdaptiveThresholdConfig, ConfidenceThresholds } from '../config/GuardianConfig.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from './policy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conservative defaults chosen to avoid false escalation in typical production
 * sessions while still reacting to genuine attack bursts.
 *
 * windowMs=60 000 (1 minute) means a burst of threats within 60 s is treated
 * as a correlated attack. Setting this too short collapses individual detections
 * into false bursts; too long means a brief attack followed by silence still
 * keeps thresholds tightened for too long.
 *
 * escalationCount=3 requires at least three distinct threat events before
 * the OODA loop considers the situation escalated. A single noisy detector
 * emitting the same threat repeatedly is handled by EventBus dedup, not here.
 *
 * escalationFactor=0.9 tightens thresholds by 10 %. For the default
 * restrict/lockout/kill = 0.5/0.7/0.9, escalation produces 0.45/0.63/0.81.
 */
const DEFAULT_OODA: Required<AdaptiveThresholdConfig> = {
  windowMs: 60_000,
  escalationCount: 3,
  escalationFactor: 0.9,
};

// ─────────────────────────────────────────────────────────────────────────────
// OODAController
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements the Observe-Orient-Decide-Act (OODA) adaptive threshold loop.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * The core insight from the OODA model (Boyd, 1976) applied to security:
 * a defender who *reacts faster* to accumulating evidence wins. When the
 * frequency of observed threats rises, we should lower the confidence bar —
 * not because individual detections become more reliable, but because the
 * *prior probability* of a genuine attack has increased.
 *
 * In statistical terms: the posterior P(attack | n threats in window) rises
 * with n, so a lower likelihood threshold is justified for each new event.
 *
 * ── How it works ──────────────────────────────────────────────────────────
 *
 * OODAController maintains a rolling list of threat event timestamps within
 * the configured window. Each call to observe() adds the new timestamp,
 * prunes stale ones outside the window, and checks whether the count has
 * reached escalationCount.
 *
 *   Not escalated: returns base thresholds unchanged.
 *   Escalated:     multiplies each threshold by escalationFactor (e.g. 0.9).
 *
 * The PolicyEngine calls observe() for every event it processes and uses
 * the returned thresholds for that event's policy decision — so the threshold
 * change takes effect on the very event that triggers escalation.
 *
 * ── Hysteresis ────────────────────────────────────────────────────────────
 *
 * The system de-escalates automatically as old events age out of the window.
 * There is no separate cool-down timer — the window sliding is the hysteresis
 * mechanism. This avoids a race condition where a burst triggers escalation
 * but de-escalation fires prematurely because the timer was too short.
 *
 * Per ADR-0011.
 */
export class OODAController {
  private readonly cfg: Required<AdaptiveThresholdConfig>;
  private readonly base: ConfidenceThresholds;

  /**
   * Timestamps (epoch ms) of every threat event observed within the current
   * window. Entries older than `windowMs` are pruned lazily on each observe()
   * call — no background timer is needed.
   */
  private eventTimestamps: number[] = [];

  /**
   * Cached escalation state. Updated on every observe() and prune(). Cached
   * so effectiveThresholds() can return without re-scanning the array.
   */
  private escalated = false;

  constructor(
    cfg: AdaptiveThresholdConfig = {},
    base: Partial<ConfidenceThresholds> = {},
  ) {
    this.cfg = { ...DEFAULT_OODA, ...cfg };
    this.base = { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...base };
  }

  /**
   * Record a newly observed threat event and return the thresholds to use
   * for the policy decision that immediately follows.
   *
   * The caller should pass event.ts (the detector-side timestamp) rather
   * than Date.now() so that replayed or back-dated events are correctly
   * placed in the timeline. The default (Date.now()) is safe for real-time use.
   *
   * Returns the effective thresholds AFTER incorporating this event — if this
   * event is the one that triggers escalation, the caller receives the tighter
   * thresholds and can react immediately.
   */
  observe(ts: number = Date.now()): ConfidenceThresholds {
    this.eventTimestamps.push(ts);
    this.prune(ts);

    // Re-evaluate escalation state now that we have the new timestamp.
    // Escalation is sticky within the window: once count >= escalationCount,
    // we stay escalated until events age out.
    this.escalated = this.eventTimestamps.length >= this.cfg.escalationCount;

    return this.effectiveThresholds();
  }

  /**
   * Return the currently effective thresholds without recording a new event.
   * Used by callers that need to read the current state (e.g. telemetry) but
   * are not processing a new event themselves.
   */
  effectiveThresholds(): ConfidenceThresholds {
    if (!this.escalated) return this.base;

    // Apply the escalation factor uniformly to all three tiers.
    // The factor is applied multiplicatively rather than additively so that
    // the relative gap between tiers (restrict < lockout < kill) is preserved.
    const f = this.cfg.escalationFactor;
    return {
      restrict: this.base.restrict * f,
      lockout: this.base.lockout * f,
      kill: this.base.kill * f,
    };
  }

  /** True when the event count within the window has reached escalationCount. */
  get isEscalated(): boolean {
    return this.escalated;
  }

  /**
   * Number of events currently within the rolling window.
   * Exposed for testing and diagnostics; prunes stale events before returning.
   */
  get windowEventCount(): number {
    this.prune(Date.now());
    return this.eventTimestamps.length;
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Remove timestamps that have slid outside the rolling window.
   * Called on every observe() and from windowEventCount getter.
   *
   * Using filter() creates a new array each time. This is acceptable because
   * the array is typically small (bounded by scan rate × windowMs / 1000).
   * With default settings: 50 events/s × 60 s = 3 000 max entries — but in
   * practice the EventBus rate-cap (50 events/s per engine) and dedup window
   * (100 ms per threatId) mean real arrays stay well under 100 entries.
   */
  private prune(now: number): void {
    const cutoff = now - this.cfg.windowMs;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);

    // Re-check escalation state after pruning.
    // If pruning dropped us below the escalation count, clear the flag.
    // This is the de-escalation mechanism — no separate timer needed.
    if (this.eventTimestamps.length < this.cfg.escalationCount) {
      this.escalated = false;
    }
  }
}

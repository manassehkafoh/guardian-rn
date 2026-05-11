import type { AdaptiveThresholdConfig, ConfidenceThresholds } from '../config/GuardianConfig.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from './policy.js';

const DEFAULT_OODA: Required<AdaptiveThresholdConfig> = {
  windowMs: 60_000,
  escalationCount: 3,
  escalationFactor: 0.9,
};

/**
 * Implements the Observe-Orient-Decide-Act (OODA) adaptive threshold loop.
 *
 * Tracks threat event frequency over a rolling time window. When the count
 * exceeds the escalationCount threshold, it tightens the confidence gates
 * by multiplying each threshold by escalationFactor, forcing the PolicyEngine
 * to react sooner to subsequent events of the same or lower confidence.
 *
 * Per ADR-0011.
 */
export class OODAController {
  private readonly cfg: Required<AdaptiveThresholdConfig>;
  private readonly base: ConfidenceThresholds;
  private eventTimestamps: number[] = [];
  private escalated = false;

  constructor(
    cfg: AdaptiveThresholdConfig = {},
    base: Partial<ConfidenceThresholds> = {},
  ) {
    this.cfg = { ...DEFAULT_OODA, ...cfg };
    this.base = { ...DEFAULT_CONFIDENCE_THRESHOLDS, ...base };
  }

  /**
   * Record an observed threat event. Returns the effective thresholds to use
   * for the PolicyEngine decision immediately after this observation.
   */
  observe(ts: number = Date.now()): ConfidenceThresholds {
    this.eventTimestamps.push(ts);
    this.prune(ts);
    this.escalated = this.eventTimestamps.length >= this.cfg.escalationCount;
    return this.effectiveThresholds();
  }

  /** Current effective thresholds without recording a new event. */
  effectiveThresholds(): ConfidenceThresholds {
    if (!this.escalated) return this.base;
    const f = this.cfg.escalationFactor;
    return {
      restrict: this.base.restrict * f,
      lockout: this.base.lockout * f,
      kill: this.base.kill * f,
    };
  }

  get isEscalated(): boolean {
    return this.escalated;
  }

  /** Visible for testing. */
  get windowEventCount(): number {
    this.prune(Date.now());
    return this.eventTimestamps.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.cfg.windowMs;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);
    if (this.eventTimestamps.length < this.cfg.escalationCount) {
      this.escalated = false;
    }
  }
}

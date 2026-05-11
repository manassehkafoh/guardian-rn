import type { ThreatId } from '../generated/ThreatId.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { Engine } from '../engine/Engine.js';
import type { TelemetryAdapter } from '../telemetry/TelemetryAdapter.js';
import type { TerminatorPort } from '../policy/TerminatorPort.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kill policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls the hard-termination behaviour when a kill-policy threat fires.
 *
 * The grace period exists so the host app can:
 *   1. Flush pending analytics before the process ends.
 *   2. Show a user-facing error screen rather than an abrupt black screen.
 *
 * WARNING: set graceMs too high and an attacker that triggered the kill
 * condition may exfiltrate data during the grace window. 3 000 ms is a
 * reasonable upper bound for most consumer apps; lower it for high-security
 * contexts.
 */
export interface KillPolicyConfig {
  /** Whether the terminator runs at all. Default in schema: false (safe default). */
  readonly enabled: boolean;
  /**
   * Milliseconds between the kill decision and the actual process termination.
   * Minimum allowed by the schema: 1 000 ms (time to flush telemetry).
   */
  readonly graceMs: number;
  /**
   * Optional callback invoked synchronously before the grace timer starts.
   * Use this to display a "session terminated for security reasons" screen.
   * The callback must be fast — it runs on the JS thread.
   */
  readonly warningCallback?: (threatId: ThreatId) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps confidence levels to policy escalation tiers.
 *
 * The thresholds form a monotone ladder: restrict < lockout < kill.
 * Violating this ordering is not enforced at runtime but will produce
 * unintuitive behaviour (e.g. lockout firing before restrict).
 *
 * Default values (from DEFAULT_CONFIDENCE_THRESHOLDS in policy.ts):
 *   restrict: 0.5   — moderate confidence, degrade features
 *   lockout:  0.7   — high confidence, block the session
 *   kill:     0.9   — near-certain, terminate the process after grace period
 */
export interface ConfidenceThresholds {
  readonly restrict: number;
  readonly lockout: number;
  readonly kill: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event bus configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuning knobs for the EventBus deduplication and rate-limiting pipeline.
 *
 * These exist to prevent a single misbehaving engine from flooding the
 * PolicyEngine with duplicate events or denial-of-service via burst.
 * They are advisory — the fast-path bypasses both for critical events.
 */
export interface BusConfig {
  /**
   * Two events for the same threatId within this window are considered
   * duplicates; only the first is forwarded. 100 ms is tight enough to
   * collapse a burst from a single scan but loose enough to allow
   * re-detection after a genuine threat persists across scan cycles.
   */
  readonly dedupWindowMs: number;

  /**
   * Maximum threat events forwarded per engine per second. Events above
   * this cap are dropped and counted in EventBus.dropped. The cap protects
   * against an engine stuck in a tight emit loop overwhelming the policy layer.
   */
  readonly rateCapPerSecond: number;

  /**
   * When true, events whose confidence is at or above the kill threshold
   * bypass dedupWindowMs and rateCapPerSecond entirely (the "fast-path").
   *
   * Rationale: a kill-level event is the highest-priority signal in the
   * system. A 100 ms dedup delay or a rate-cap drop could allow an attacker
   * to exploit the window between detection and response. Critical events
   * must reach the PolicyEngine unconditionally.
   *
   * Only disable this if you have a specific reason to subject kill-level
   * events to the normal pipeline (e.g. testing dedup in isolation).
   *
   * Default: true.
   */
  readonly fastPathEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// OODA adaptive thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configures the OODA (Observe-Orient-Decide-Act) adaptive threshold loop.
 *
 * The core idea: when multiple threats are detected in quick succession,
 * the probability that at least one is a true positive increases. The OODA
 * controller exploits this by *lowering* the confidence gates during
 * elevated-threat periods, making the policy engine more sensitive.
 *
 * Example with defaults (windowMs=60 000, escalationCount=3, escalationFactor=0.9):
 *   – Threat 1 at t=0:  no escalation; thresholds stay at 0.5/0.7/0.9
 *   – Threat 2 at t=10s: no escalation (count=2 < 3)
 *   – Threat 3 at t=20s: ESCALATED (count=3 ≥ 3); thresholds become 0.45/0.63/0.81
 *   – Threat 4 at t=21s: uses tightened thresholds — restrict fires at 0.45+
 *   – At t=61s: threat 1 falls outside the 60 s window; count drops to 3 → still escalated
 *   – At t=80s: only threats 3 and 4 remain; count=2 < 3 → de-escalates
 *
 * Per ADR-0011.
 */
export interface AdaptiveThresholdConfig {
  /** Rolling window in ms over which threat frequency is sampled. Default: 60 000. */
  readonly windowMs?: number;
  /**
   * Number of threat events within windowMs that triggers escalation.
   * Setting this too low (e.g. 1) makes the system permanently escalated
   * in any active session. 3 is the recommended minimum.
   */
  readonly escalationCount?: number;
  /**
   * Multiplier applied to each confidence threshold when escalated.
   * Must be in the range (0, 1] — a value of 1.0 disables tightening.
   * Values below 0.7 risk false-positive lockouts in noisy environments.
   * Default: 0.9 (10% tighter gates).
   */
  readonly escalationFactor?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete configuration for a guardian-rn session.
 *
 * This object is passed to `useGuardian()` and remains immutable for the
 * lifetime of the React component. All fields are readonly to prevent
 * accidental mutation from outside the hook.
 *
 * The minimum viable config requires only `tenantId`, `engines`, and
 * `actions`. All other fields have safe defaults.
 *
 * Per ADR-0005.
 */
export interface GuardianConfig {
  /**
   * Your organisation's tenant identifier. Stamped on every outbound telemetry
   * record so the backend can route events to the correct tenant shard.
   * Must be a non-empty string — the SDK does not validate its format.
   */
  readonly tenantId: string;

  /**
   * The detection engines to run. Order is irrelevant — all engines start
   * concurrently. You must supply at least one engine or no threats will
   * ever be detected.
   *
   * Typical setup:
   *   engines: [new CommunityEngine(), new BehavioralBaselineEngine()]
   *
   * BehavioralBaselineEngine must also call .observeEngine(communityEngine)
   * before being passed here.
   */
  readonly engines: readonly Engine[];

  /**
   * Per-threat policy overrides. Keys are ThreatId values; values are
   * ResponsePolicy strings. Any threat not listed here falls back to
   * DEFAULT_POLICIES, and any threat not in DEFAULT_POLICIES defaults to
   * 'telemetry' (log-only, no action).
   *
   * Example — upgrade emulator detection to restrict for a financial app:
   *   policies: { emulator: 'restrict' }
   */
  readonly policies?: Partial<Record<ThreatId, ResponsePolicy>>;

  /**
   * Override the default confidence thresholds (0.5/0.7/0.9).
   * Only specify the thresholds you want to change; others inherit defaults.
   *
   * Raising thresholds reduces false positives but may miss real attacks.
   * Lowering them increases sensitivity but may generate user-facing friction.
   */
  readonly confidenceThresholds?: Partial<ConfidenceThresholds>;

  /**
   * Controls whether and how the SDK terminates the host app process when
   * a kill-policy threat is confirmed. Disabled by default so that the SDK
   * is safe to add without enabling destructive behaviour immediately.
   *
   * Enable only after validating kill policies in a staging environment.
   */
  readonly killPolicy?: KillPolicyConfig;

  /**
   * Tuning for the EventBus dedup/rate-cap pipeline and fast-path.
   * The defaults (100 ms dedup, 50 events/s cap, fast-path enabled) are
   * appropriate for most apps. Only override if you have profiling data
   * showing the defaults are causing issues.
   */
  readonly busConfig?: Partial<BusConfig>;

  /**
   * Optional telemetry sink. Implement this interface to forward threat
   * events and health ticks to your observability backend (Datadog, Splunk,
   * MDAM compliance feed, etc.).
   *
   * The SDK calls recordThreat() on every event regardless of policy outcome,
   * so you get full visibility even for telemetry-only threats.
   */
  readonly telemetry?: TelemetryAdapter;

  /**
   * Optional process terminator. Implement this to control exactly how the
   * app process ends — e.g. clearing sensitive in-memory state before exit,
   * or routing through a native module that performs a clean shutdown.
   *
   * If omitted and killPolicy.enabled is true, the SDK logs a warning but
   * does not terminate (terminator is the actuator; without it, kill events
   * are effectively downgraded to lockout in terms of observable effect).
   */
  readonly terminator?: TerminatorPort;

  /**
   * OODA adaptive threshold config. When provided, the PolicyEngine
   * automatically tightens confidence gates when threats are observed at
   * elevated frequency within the rolling window.
   *
   * Omit this field entirely to keep static thresholds (the default behaviour
   * prior to v1.1.0). Enable it for high-security contexts where automated
   * attack tooling is a realistic threat model.
   */
  readonly adaptiveThresholds?: AdaptiveThresholdConfig;

  /**
   * Maximum session age in milliseconds. When set, the SDK emits a
   * `sessionExpiry` threat event after this duration and applies its
   * policy (default: 'lockout'). The timer resets on each useGuardian mount.
   *
   * Use this to enforce limited-time access windows — for example:
   *   sessionMaxAgeMs: 8 * 60 * 60 * 1000  // 8-hour banking sessions
   *
   * Omit for sessions with no age limit.
   */
  readonly sessionMaxAgeMs?: number;

  /**
   * HTTPS URL of a remote policy endpoint. When set, PolicyStore fetches a
   * fresh PolicyMap JSON from this URL on startup and caches it encrypted.
   * If the fetch fails, the last cached map is used; if no cache exists,
   * DEFAULT_POLICIES apply.
   *
   * The endpoint must return Content-Type: application/json with a body
   * matching the PolicyMap shape: { [ThreatId]: ResponsePolicy }.
   *
   * Use this to update threat policies without shipping a new app version.
   */
  readonly policyEndpoint?: string;

  /**
   * When true, threatId values in outbound telemetry payloads are replaced
   * with opaque random tokens. The mapping is kept in memory for the session
   * duration and never leaves the device.
   *
   * This prevents network-layer observers (MitM proxies, compromised telemetry
   * endpoints) from learning which specific threats fired. The backend receives
   * opaque identifiers and must hold the mapping to interpret them.
   *
   * See ADR-0022 and docs/11-solution-design-v2.md §12 for the full design.
   */
  readonly obfuscateThreatIds?: boolean;

  /**
   * Callbacks invoked by the PolicyEngine for each escalation tier.
   * All callbacks are optional — omitting onKill does not prevent the kill
   * timer from running if killPolicy.enabled is true.
   *
   * Keep callbacks fast. They execute synchronously on the JS thread
   * during PolicyEngine.apply(). Heavy work (navigation, network calls)
   * should be deferred with setTimeout or dispatched to a background queue.
   */
  readonly actions: GuardianActions;
}

/**
 * Per-tier action callbacks.
 *
 * The index signature allows host apps to register handlers for specific
 * threatIds in addition to the three tier callbacks:
 *   actions: {
 *     onRestrict: (e) => degradeFeatures(e),
 *     root: (e) => showRootWarningDialog(e),   // custom per-threat handler
 *   }
 *
 * The SDK does not call these index-signature handlers automatically —
 * they are a convenience for host apps that want threat-specific routing
 * without re-implementing the switch in onRestrict/onLockout/onKill.
 */
export interface GuardianActions {
  /** Called when a 'restrict' policy fires and confidence ≥ restrict threshold. */
  onRestrict?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  /** Called when a 'lockout' policy fires and confidence ≥ lockout threshold. */
  onLockout?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  /** Called when a 'kill' policy fires and confidence ≥ kill threshold. */
  onKill?: (event: import('../events/ThreatEvent.js').ThreatEvent) => void;
  [threatId: string]: ((event: import('../events/ThreatEvent.js').ThreatEvent) => void) | undefined;
}
